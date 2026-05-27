import os
import secrets
import datetime
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
import asyncpg
import httpx
from dotenv import load_dotenv

load_dotenv(dotenv_path="../backend/.env")

app = FastAPI(title="FareMind Auth Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
BREVO_API_KEY = os.getenv("SENDGRID_API_KEY") # Placeholder for Brevo/SendGrid key

class CheckUserRequest(BaseModel):
    email: EmailStr

class SendOTPRequest(BaseModel):
    email: EmailStr

class RegisterUserRequest(BaseModel):
    email: EmailStr
    first_name: str
    middle_name: str | None = None
    last_name: str
    phone: str | None = None

class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp: str

async def get_db_pool():
    if not hasattr(app.state, "pool"):
        app.state.pool = await asyncpg.create_pool(DATABASE_URL)
    return app.state.pool

@app.on_event("startup")
async def startup():
    try:
        await get_db_pool()
    except Exception as e:
        print(f"Warning: Database connection failed on startup. Will retry on demand. Error: {e}")

@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "pool"):
        await app.state.pool.close()

async def send_email_brevo(to_email: str, otp: str):
    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "api-key": str(BREVO_API_KEY),
        "accept": "application/json",
        "content-type": "application/json"
    }
    payload = {
        "sender": {"name": "FareMind", "email": "noreply@faremind.com"},
        "to": [{"email": to_email}],
        "subject": "FareMind Login Verification Code",
        "htmlContent": f"<p>Your OTP is: <strong>{otp}</strong></p><p>Valid for 5 minutes.</p><p>If not requested, ignore this email.</p>"
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=headers)
            print(f"Brevo email response: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"Failed to send email: {e}")

@app.post("/auth/check-user")
async def check_user(req: CheckUserRequest):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval("SELECT 1 FROM users WHERE email = $1", req.email)
        return {"exists": bool(val)}

@app.post("/auth/send-otp")
async def send_otp(req: SendOTPRequest):
    otp = "".join([str(secrets.randbelow(10)) for _ in range(6)])
    otp_hash = pwd_context.hash(otp)
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        recent_count = await conn.fetchval(
            "SELECT count(*) FROM otp_codes WHERE email = $1 AND created_at > $2",
            req.email, datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)
        )
        if recent_count >= 3:
            raise HTTPException(status_code=429, detail="Too many OTP requests. Please wait.")
            
        await conn.execute(
            "INSERT INTO otp_codes (id, email, otp_hash, expires_at) VALUES ($1, $2, $3, $4)",
            "cuid_" + secrets.token_hex(8), req.email, otp_hash, expires_at
        )
        
    await send_email_brevo(req.email, otp)
    print(f"DEV ONLY: OTP for {req.email} is {otp}")
    return {"success": True, "message": "OTP sent"}

@app.post("/auth/resend-otp")
async def resend_otp(req: SendOTPRequest):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute("UPDATE otp_codes SET is_used = true WHERE email = $1 AND is_used = false", req.email)
    return await send_otp(req)

@app.post("/auth/register")
async def register(req: RegisterUserRequest):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM users WHERE email = $1", req.email)
        if exists:
            raise HTTPException(status_code=400, detail="User already exists")
            
        await conn.execute(
            """
            INSERT INTO users (id, email, password_hash, first_name, last_name, phone)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            "cuid_" + secrets.token_hex(8), req.email, "otp_only", req.first_name, req.last_name, req.phone
        )
    return await send_otp(SendOTPRequest(email=req.email))

@app.post("/auth/verify-otp")
async def verify_otp(req: VerifyOTPRequest):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, otp_hash, expires_at, attempts 
            FROM otp_codes 
            WHERE email = $1 AND is_used = false 
            ORDER BY created_at DESC LIMIT 1
            """, req.email
        )
        if not row:
            raise HTTPException(status_code=400, detail="No active OTP found")
            
        if row["attempts"] >= 5:
            await conn.execute("UPDATE otp_codes SET is_used = true WHERE id = $1", row["id"])
            raise HTTPException(status_code=400, detail="Max attempts reached. Request a new OTP.")
            
        if row["expires_at"].replace(tzinfo=datetime.timezone.utc) < datetime.datetime.now(datetime.timezone.utc):
            await conn.execute("UPDATE otp_codes SET is_used = true WHERE id = $1", row["id"])
            raise HTTPException(status_code=400, detail="OTP expired")
            
        if not pwd_context.verify(req.otp, row["otp_hash"]):
            await conn.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", row["id"])
            raise HTTPException(status_code=400, detail="Invalid OTP")
            
        await conn.execute("UPDATE otp_codes SET is_used = true WHERE id = $1", row["id"])
        
        user = await conn.fetchrow("SELECT id, email, first_name, last_name FROM users WHERE email = $1", req.email)
        if not user:
            raise HTTPException(status_code=400, detail="User not found")
            
        await conn.execute("UPDATE users SET last_login_at = $1 WHERE id = $2", datetime.datetime.now(datetime.timezone.utc), user["id"])
        
        token = secrets.token_hex(32)
        await conn.execute(
            "INSERT INTO sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)",
            "cuid_" + secrets.token_hex(8), user["id"], token, datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
        )
        
    return {
        "success": True, 
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": f"{user['first_name']} {user['last_name']}"
        },
        "sessionToken": token
    }
