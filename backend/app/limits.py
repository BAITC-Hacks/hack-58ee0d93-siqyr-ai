"""Reject excessive requests before multipart parsing starts."""
import time
from collections import deque
from fastapi import HTTPException
from starlette.responses import JSONResponse
from .config import Settings


class RequestLimits:
    def __init__(self, app, settings: Settings):
        self.app, self.settings = app, settings
        self.hits: dict[str, deque] = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/runs":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        ip = headers.get(b"x-forwarded-for", b"").decode().split(",")[0].strip()
        ip = ip or (scope.get("client") or ("unknown",))[0]
        now = time.monotonic()
        for key in list(self.hits):
            while self.hits[key] and self.hits[key][0] <= now - 60:
                self.hits[key].popleft()
            if not self.hits[key]:
                del self.hits[key]
        hits = self.hits.setdefault(ip, deque())
        if self.settings.rate_limit_per_min > 0:
            if len(hits) >= self.settings.rate_limit_per_min:
                response = JSONResponse({"detail": "Слишком много запусков. Повторите через минуту."}, 429, headers={"Retry-After": "60"})
                return await response(scope, receive, send)
            hits.append(now)
        # Bounded multipart overhead; the route enforces the exact file limit.
        body_limit = self.settings.max_upload_mb * 1024 * 1024 + 1024 * 1024
        total = 0

        async def limited_receive():
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > body_limit:
                    raise HTTPException(413, f"Файл слишком большой. Максимум: {self.settings.max_upload_mb} МБ.")
            return message

        await self.app(scope, limited_receive, send)
