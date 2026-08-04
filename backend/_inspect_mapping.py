import asyncio
import base64
import json
import sys

from sqlalchemy import text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402


async def main():
    async with engine.connect() as conn:
        r = await conn.execute(
            text("SELECT tenant_id, user_id, bot_username, chat_id, status FROM nexus_crm.nexus_telegram_mappings")
        )
        for row in r:
            print("mapping:", dict(row._mapping))
        r = await conn.execute(
            text("SELECT id, tenant_id FROM nexus_auth.users WHERE email='terrence_lam@kinetix.com.hk'")
        )
        for row in r:
            print("user row:", dict(row._mapping))


asyncio.run(main())
