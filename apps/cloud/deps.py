"""FastAPI dependencies."""

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """A database session for one request: ``session: AsyncSession = Depends(get_session)``."""
    async for session in request.app.state.db.session():
        yield session
