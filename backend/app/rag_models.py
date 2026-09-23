"""Persistent, user-scoped search index and chat history."""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel

from .models import identifier, utcnow


class RagDocument(SQLModel, table=True):
    __tablename__ = "rag_documents"
    __table_args__ = (UniqueConstraint("owner_id", "kind", "source_id"),)
    id: str = Field(default_factory=identifier, primary_key=True)
    owner_id: str = Field(index=True)
    kind: str  # browser | run
    source_id: str
    department_id: str | None = None
    title: str
    status: str
    fingerprint: str
    embedding_model: str
    updated_at: datetime = Field(default_factory=utcnow)


class RagChunk(SQLModel, table=True):
    __tablename__ = "rag_chunks"
    id: str = Field(default_factory=identifier, primary_key=True)
    document_id: str = Field(foreign_key="rag_documents.id", index=True)
    ordinal: int
    text: str
    vector: list[float] = Field(sa_column=Column(JSON, nullable=False))
    segment_index: int | None = None
    start_seconds: float | None = None


class RagConversation(SQLModel, table=True):
    __tablename__ = "rag_conversations"
    id: str = Field(default_factory=identifier, primary_key=True)
    owner_id: str = Field(index=True)
    title: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class RagMessage(SQLModel, table=True):
    __tablename__ = "rag_messages"
    id: str = Field(default_factory=identifier, primary_key=True)
    conversation_id: str = Field(foreign_key="rag_conversations.id", index=True)
    role: str
    text: str
    sources: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=utcnow)
