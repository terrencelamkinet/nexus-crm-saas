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
            tenant_id = request.state.tenant_id
            if tenant_id:
                conn = await session.connection()
                await conn.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
                uid = request.state.user_id
                if uid:
                    await conn.execute(text(f"SET app.user_id = '{uid}'"))
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
