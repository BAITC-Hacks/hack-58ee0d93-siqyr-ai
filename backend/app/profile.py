"""Self-service profile, preferences, avatar and password endpoints."""
from __future__ import annotations

import hashlib
import io
from datetime import datetime, timezone
from typing import Callable, Literal

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .auth import Principal, hash_password, verify_password
from .config import Settings
from .models import Department, User
from .profile_models import UserProfile, bump_token_version

MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    language: Literal["ru", "kk", "en"] | None = None
    theme: Literal["system", "light", "dark"] | None = None
    notifications_enabled: StrictBool | None = None


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str
    new_password: str


def _avatar_webp(data: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Допустимы только JPEG, PNG и WebP.")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("Изображение слишком большое: максимум 16 мегапикселей.")
            source.load()
            image = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (256, 256), method=Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="WEBP", quality=85, method=4)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Файл не является допустимым изображением.") from exc


def register_profile_routes(app: FastAPI, settings: Settings, principal: Callable):
    def profile_view(actor: Principal) -> dict:
        with app.state.runtime.db.session() as session:
            profile = session.get(UserProfile, actor.user.id) if settings.auth_mode != "disabled" else None
            departments = []
            for department_id, role in actor.memberships.items():
                department = session.get(Department, department_id)
                if department:
                    departments.append({**department.model_dump(), "role": role})
        return {"id": actor.user.id, "username": actor.user.username,
                "display_name": actor.user.display_name, "is_system_admin": actor.user.is_system_admin,
                "departments": departments,
                "settings": {"language": profile.language if profile else "ru",
                             "theme": profile.theme if profile else "system",
                             "notifications_enabled": profile.notifications_enabled if profile else True},
                "avatar_url": "/api/profile/avatar" if profile and profile.avatar else None,
                "updated_at": profile.updated_at.isoformat() if profile else None}

    @app.get("/api/profile")
    def get_profile(actor: Principal = Depends(principal)):
        return profile_view(actor)

    @app.patch("/api/profile")
    def update_profile(body: ProfileUpdate, actor: Principal = Depends(principal)):
        if not body.model_fields_set or all(value is None for value in body.model_dump().values()):
            raise HTTPException(400, "Укажите поле профиля для изменения.")
        if settings.auth_mode == "disabled":
            raise HTTPException(403, "В демо-режиме профиль не сохраняется.")
        with app.state.runtime.db.session() as session:
            user = session.get(User, actor.user.id)
            profile = session.get(UserProfile, actor.user.id) or UserProfile(user_id=actor.user.id)
            if body.display_name is not None:
                user.display_name = body.display_name.strip()
                if not user.display_name:
                    raise HTTPException(400, "Имя не может быть пустым.")
                session.add(user)
            for key in ("language", "theme", "notifications_enabled"):
                value = getattr(body, key)
                if value is not None:
                    setattr(profile, key, value)
            profile.updated_at = datetime.now(timezone.utc)
            session.add(profile)
            session.commit()
        return profile_view(app.state.auth.principal(user))

    @app.post("/api/profile/password")
    def change_password(body: PasswordChange, actor: Principal = Depends(principal)):
        if settings.auth_mode not in {"local", "hybrid"}:
            raise HTTPException(403, "Локальная смена пароля отключена.")
        try:
            new_hash = hash_password(body.new_password)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        with app.state.runtime.db.session() as session:
            user = session.get(User, actor.user.id)
            if user is None or not verify_password(body.current_password, user.password_hash):
                raise HTTPException(401, "Неверный текущий пароль.")
            user.password_hash = new_hash
            session.add(user)
            bump_token_version(session, user.id)
            session.commit()
        token = app.state.auth.issue(user)
        return {"access_token": token, "token_type": "bearer", "expires_in": settings.jwt_ttl_minutes * 60}

    @app.put("/api/profile/avatar")
    async def upload_avatar(file: UploadFile = File(...), actor: Principal = Depends(principal)):
        if settings.auth_mode == "disabled":
            raise HTTPException(403, "В демо-режиме профиль не сохраняется.")
        data = await file.read(MAX_AVATAR_BYTES + 1)
        await file.close()
        if len(data) > MAX_AVATAR_BYTES:
            raise HTTPException(413, "Аватар должен быть не больше 2 МБ.")
        try:
            avatar = _avatar_webp(data)
        except ValueError as exc:
            raise HTTPException(415, str(exc)) from None
        with app.state.runtime.db.session() as session:
            profile = session.get(UserProfile, actor.user.id) or UserProfile(user_id=actor.user.id)
            profile.avatar = avatar
            profile.updated_at = datetime.now(timezone.utc)
            session.add(profile)
            session.commit()
        return {"avatar_url": "/api/profile/avatar", "content_type": "image/webp"}

    @app.get("/api/profile/avatar")
    def get_avatar(actor: Principal = Depends(principal)):
        with app.state.runtime.db.session() as session:
            profile = session.get(UserProfile, actor.user.id) if settings.auth_mode != "disabled" else None
            avatar = profile.avatar if profile else None
        if not avatar:
            raise HTTPException(404, "Аватар не загружен.")
        return Response(avatar, media_type="image/webp", headers={
            "ETag": '"' + hashlib.sha256(avatar).hexdigest() + '"',
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @app.delete("/api/profile/avatar", status_code=204)
    def delete_avatar(actor: Principal = Depends(principal)):
        if settings.auth_mode == "disabled":
            raise HTTPException(403, "В демо-режиме профиль не сохраняется.")
        with app.state.runtime.db.session() as session:
            profile = session.get(UserProfile, actor.user.id)
            if profile and profile.avatar:
                profile.avatar = None
                profile.updated_at = datetime.now(timezone.utc)
                session.add(profile)
                session.commit()
