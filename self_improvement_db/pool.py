"""
db/pool.py — shared asyncpg connection pool for all self-improvement services.
"""
import os
import asyncpg

_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL not set — cannot connect to Postgres/Supabase.")
        _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10)
    return _pool

async def close_pool():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
