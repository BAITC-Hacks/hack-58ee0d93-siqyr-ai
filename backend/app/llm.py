"""Shared OpenAI-compatible completion client, metering, and SQLite cache.

Chat schema: https://developers.openai.com/api/reference/python/resources/chat/subresources/completions/methods/create
No model-specific optional parameters are sent unless explicitly supplied.
"""
import hashlib
import json
import logging
from dataclasses import dataclass

from openai import AsyncOpenAI
from sqlalchemy.dialects.sqlite import insert

from .config import Settings
from .db import Database
from .models import Cache

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Completion:
    content: str
    tokens: int
    cost_usd: float
    cached: bool = False


class LLM:
    def __init__(self, db: Database, settings: Settings):
        self.db, self.settings = db, settings
        self.client: AsyncOpenAI | None = None

    async def complete(self, messages: list[dict], *, model: str | None = None, use_cache: bool = True, **kwargs) -> Completion:
        if kwargs.get("stream"):
            raise ValueError("complete() поддерживает только полные ответы.")
        model = model or self.settings.model_main
        request = {"model": model, "messages": messages, **kwargs}
        key = "llm:" + hashlib.sha256(json.dumps(
            {"endpoint": self.settings.llm_base_url, **request}, sort_keys=True, ensure_ascii=False,
        ).encode()).hexdigest()
        if use_cache:
            with self.db.session() as session:
                cached = session.get(Cache, key)
                if cached:
                    logger.info("llm model=%s cached=true tokens=0 cost_usd=0", model)
                    return Completion(content=cached.value["content"], tokens=0, cost_usd=0, cached=True)
        if self.client is None:
            if not self.settings.llm_api_key and not self.settings.llm_base_url:
                raise RuntimeError("Задайте LLM_API_KEY / OPENAI_API_KEY или локальный LLM_BASE_URL.")
            self.client = AsyncOpenAI(
                api_key=self.settings.llm_api_key or "local",
                base_url=self.settings.llm_base_url or "https://api.openai.com/v1",
            )
        response = await self.client.chat.completions.create(**request)
        content = response.choices[0].message.content or ""
        usage = response.usage
        tokens = usage.total_tokens if usage else 0
        cost = (usage.prompt_tokens * self.settings.price_in_per_1m + usage.completion_tokens * self.settings.price_out_per_1m) / 1_000_000 if usage else 0
        logger.info("llm model=%s cached=false tokens=%s cost_usd=%.8f", model, tokens, cost)
        if use_cache:
            with self.db.session() as session:
                session.execute(insert(Cache).values(key=key, value={"content": content, "tokens": tokens, "cost_usd": cost}).on_conflict_do_nothing(index_elements=["key"]))
                session.commit()
        return Completion(content, tokens, cost)

    async def close(self):
        if self.client is not None:
            await self.client.close()


_service: LLM | None = None


def configure(service: LLM | None):
    global _service
    _service = service


async def complete(messages: list[dict], **kwargs) -> Completion:
    if _service is None:
        raise RuntimeError("LLM-клиент доступен после запуска API.")
    return await _service.complete(messages, **kwargs)
