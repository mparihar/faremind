from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from database import get_pool, close_pool
from config import get_settings
from routers import events, send, resend, status

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(
    title="FareMind Notification Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router,  prefix="/notifications", tags=["events"])
app.include_router(send.router,    prefix="/notifications", tags=["send"])
app.include_router(resend.router,  prefix="/notifications", tags=["resend"])
app.include_router(status.router,  prefix="/notifications", tags=["status"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "faremind-notifications"}
