from collections.abc import AsyncGenerator

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    # Root fix for asyncpg prepared-statement cache type-collision bug
    # ("invalid input syntax for type uuid: \"\"") — disables server-side
    # statement caching entirely. Each execution re-prepares with correct
    # param types. Negligible overhead vs. correctness at 50k scale.
    connect_args={"prepared_statement_cache_size": 0},
    pool_pre_ping=True,          # drop stale pooled connections (pg restart / pgbouncer)
    pool_size=10,                # per-process pool — with N workers × PgBouncer this
    max_overflow=20,             # stays well within PgBouncer's server pool
    pool_recycle=1800,           # 30min recycle — avoids long-idle conn kill
)
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
                # Resolve workspace_id if middleware didn't already provide one
                if not wid:
                    wid_row = await conn.execute(
                        text(
                            """
                            SELECT id FROM nexus_auth.workspaces
                            WHERE tenant_id = :tid
                            ORDER BY created_at ASC
                            LIMIT 1
                            """
                        ),
                        {"tid": str(tid)},
                    )
                    wid = wid_row.scalar_one_or_none()
                    if wid:
                        request.state.workspace_id = wid
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
                # Set single team_id from first team (or default) for RLS V2 team-scope checks
                if tids:
                    first_team = str(tids).split(",")[0].strip().strip("['").strip("']")
                    if first_team:
                        await conn.execute(
                            text("SELECT set_config('app.team_id', :tid, true)"),
                            {"tid": first_team},
                       )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
