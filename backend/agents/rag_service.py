"""Private AI process for meeting RAG. Bind only to a Unix socket, never a public port."""
from __future__ import annotations

import math
import threading
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from openai import OpenAIError
from pydantic import BaseModel, Field

from backend.app.config import Settings
from backend.app.db import Database
from backend.app.llm import LLM
from backend.app.readiness import LOOPBACK


class EmbeddingsRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=100)


class RerankRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    texts: list[str] = Field(min_length=1, max_length=32)


class AnswerRequest(BaseModel):
    messages: list[dict[str, str]] = Field(min_length=2, max_length=10)


class LocalModels:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.embedding = None
        self.reranker = None
        self.lock = threading.RLock()

    def load(self) -> None:
        with self.lock:
            if self.embedding is not None and self.reranker is not None:
                return
            if not self.settings.rag_embedding_dir.is_dir() or not self.settings.rag_reranker_dir.is_dir():
                raise RuntimeError("Модели RAG не установлены. Запустите scripts/download_rag_models.py.")
            try:
                from sentence_transformers import CrossEncoder, SentenceTransformer
            except ImportError as exc:
                raise RuntimeError("Установите backend/requirements-rag.txt для AI-сервиса.") from exc
            self.embedding = SentenceTransformer(str(self.settings.rag_embedding_dir), device=self.settings.rag_device, local_files_only=True)
            self.reranker = CrossEncoder(str(self.settings.rag_reranker_dir), device=self.settings.rag_device, local_files_only=True)

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.load()
        with self.lock:
            vectors = self.embedding.encode(texts, batch_size=8, normalize_embeddings=True, show_progress_bar=False)
            result = [[float(value) for value in vector] for vector in vectors]
            if any(not vector or any(not math.isfinite(value) for value in vector) for vector in result):
                raise RuntimeError("Модель embeddings вернула некорректный вектор.")
            return result

    def score(self, question: str, texts: list[str]) -> list[float]:
        self.load()
        with self.lock:
            scores = [float(value) for value in self.reranker.predict([(question, text) for text in texts], batch_size=4)]
            if any(not math.isfinite(value) for value in scores):
                raise RuntimeError("Модель rerank вернула некорректные оценки.")
            return scores


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings)
        app.state.llm = LLM(db, settings)
        app.state.models = LocalModels(settings)
        try:
            yield
        finally:
            await app.state.llm.close()
            db.close()

    app = FastAPI(title="Siqyr private RAG AI", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.get("/internal/health")
    def health():
        return {"models_present": settings.rag_embedding_dir.is_dir() and settings.rag_reranker_dir.is_dir(),
                "llm_local": settings.llm_provider == "local" and urlsplit(settings.llm_base_url).hostname in LOOPBACK}

    @app.post("/internal/embeddings")
    def embeddings(body: EmbeddingsRequest):
        try:
            return {"vectors": app.state.models.embed(body.texts)}
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from None

    @app.post("/internal/rerank")
    def rerank(body: RerankRequest):
        try:
            return {"scores": app.state.models.score(body.question, body.texts)}
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from None

    @app.post("/internal/answer")
    async def answer(body: AnswerRequest):
        if settings.llm_provider != "local" or urlsplit(settings.llm_base_url).hostname not in LOOPBACK:
            raise HTTPException(503, "AI-сервис принимает только локальный LLM_BASE_URL.")
        try:
            result = await app.state.llm.complete(body.messages, use_cache=False)
            return {"content": result.content}
        except (RuntimeError, OpenAIError) as exc:
            raise HTTPException(503, f"Локальная LLM недоступна: {type(exc).__name__}") from None

    return app


app = create_app()
