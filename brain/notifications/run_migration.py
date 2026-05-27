import asyncio
import asyncpg

DB_URL = "postgresql://postgres:NFwjsoJvcGQHYypcpFULMSNTmkxbwACx@mainline.proxy.rlwy.net:10526/railway"

async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        with open("migrations/001_notification_tables.sql", "r", encoding="utf-8") as f:
            sql = f.read()
        await conn.execute(sql)
        print("Migration complete!")
        
        # Verify tables exist
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'notification%'"
        )
        for t in tables:
            print(f"  ✓ {t['tablename']}")
    finally:
        await conn.close()

asyncio.run(main())
