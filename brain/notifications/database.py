import asyncpg
from typing import Optional
from config import get_settings

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def fetch_all(query: str, *args):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *args)
        return [dict(r) for r in rows]


async def fetch_one(query: str, *args):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, *args)
        return dict(row) if row else None


async def execute(query: str, *args):
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.execute(query, *args)


async def fetch_admin_emails() -> list[str]:
    """Return emails of all active SUPER_ADMIN and OPS_ADMIN users."""
    rows = await fetch_all(
        "SELECT email FROM admin_users WHERE role IN ('SUPER_ADMIN','OPS_ADMIN') AND is_active = TRUE"
    )
    return [r["email"] for r in rows]
