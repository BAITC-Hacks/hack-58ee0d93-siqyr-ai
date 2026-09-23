"""Optional user-owned profile data, separate from corporate identity records."""
from datetime import datetime, timezone

from sqlalchemy import Column, JSON, LargeBinary
from sqlmodel import Field, SQLModel


class UserProfile(SQLModel, table=True):
    __tablename__ = "user_profiles"
    user_id: str = Field(primary_key=True, foreign_key="users.id")
    language: str = "ru"
    theme: str = "system"
    notifications_enabled: bool = True
    avatar: bytes | None = Field(default=None, sa_column=Column(LargeBinary))
    token_version: int = 0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def token_version(session, user_id: str) -> int:
    profile = session.get(UserProfile, user_id)
    return profile.token_version if profile else 0


def bump_token_version(session, user_id: str) -> None:
    profile = session.get(UserProfile, user_id)
    if profile is None:
        profile = UserProfile(user_id=user_id)
    profile.token_version += 1
    session.add(profile)
