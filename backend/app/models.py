"""Persistence models; the wire contract remains in backend.shared.schemas."""
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def identifier() -> str:
    return uuid4().hex


class Run(SQLModel, table=True):
    __tablename__ = "runs"
    id: str = Field(default_factory=identifier, primary_key=True)
    department_id: str = Field(default="default", index=True)
    title: str
    meeting_date: date
    lang: str = "rukk"
    status: str = Field(default="queued", index=True)
    synthetic: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    audio_path: str | None = None
    participants: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    segments: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    proposal: dict | None = Field(default=None, sa_column=Column(JSON))
    result: dict | None = Field(default=None, sa_column=Column(JSON))


class Step(SQLModel, table=True):
    __tablename__ = "steps"
    run_id: str = Field(primary_key=True, foreign_key="runs.id")
    seq: int = Field(primary_key=True)
    payload: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))


class Assignment(SQLModel, table=True):
    __tablename__ = "assignments"
    id: str = Field(default_factory=identifier, primary_key=True)
    run_id: str = Field(foreign_key="runs.id", index=True)
    assignee: str = Field(index=True)
    task: str
    deadline: date | None = None
    deadline_text: str | None = None
    priority: str = "normal"
    category: str | None = None
    done: bool = False


class Notification(SQLModel, table=True):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("assignment_id", "kind", "day"),)
    id: str = Field(default_factory=identifier, primary_key=True)
    kind: str
    recipient: str = Field(index=True)
    message: str
    assignment_id: str | None = Field(default=None, foreign_key="assignments.id")
    day: date
    created_at: datetime = Field(default_factory=utcnow)


class Cache(SQLModel, table=True):
    __tablename__ = "cache"
    key: str = Field(primary_key=True)
    value: dict = Field(sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utcnow)


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"
    id: str = Field(primary_key=True)
    name: str


class Department(SQLModel, table=True):
    __tablename__ = "departments"
    id: str = Field(primary_key=True)
    organization_id: str = Field(foreign_key="organizations.id", index=True)
    name: str
    parent_id: str | None = Field(default=None, foreign_key="departments.id")


class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(default_factory=identifier, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str | None = None
    display_name: str
    active: bool = True
    is_system_admin: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Membership(SQLModel, table=True):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "department_id"),)
    id: str = Field(default_factory=identifier, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    department_id: str = Field(foreign_key="departments.id", index=True)
    role: str  # viewer | editor | secretary | department_admin


class ExternalIdentity(SQLModel, table=True):
    __tablename__ = "external_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)
    id: str = Field(default_factory=identifier, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    provider: str  # keycloak | ecp
    subject: str  # OIDC sub or verified certificate identity


class EcpChallenge(SQLModel, table=True):
    __tablename__ = "ecp_challenges"
    id: str = Field(default_factory=identifier, primary_key=True)
    payload: str
    expires_at: datetime
    consumed: bool = False
