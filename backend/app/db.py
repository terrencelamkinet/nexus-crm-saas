from collections.abc import AsyncGenerator

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_tenant_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            tid = request.state.tenant_id
            uid = request.state.user_id
            wid = getattr(request.state, "workspace_id", "")
            tids = getattr(request.state, "team_ids", "")

            if tid:
                conn = await session.connection()
                # transaction-scoped set_config (3rd arg=true): 
                # ensures no cross-tenant leak when conn returns to pool
                await conn.execute(
                    text("SELECT set_config('app.tenant_id', :tid, true)"),
                    {"tid": str(tid)},
                )
                if uid:
                    await conn.execute(
                        text("SELECT set_config('app.user_id', :uid, true)"),
                        {"uid": str(uid)},
                    )
                if wid:
                    await conn.execute(
                        text("SELECT set_config('app.workspace_id', :wid, true)"),
                        {"wid": str(wid)},
                    )
                if tids:
                    await conn.execute(
                        text("SELECT set_config('app.team_ids', :tids, true)"),
                        {"tids": str(tids)},
                    )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
