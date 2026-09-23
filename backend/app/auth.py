"""Identity providers and department authorization. No external claims grant roles."""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError

log = logging.getLogger("siqyr.auth")
from sqlmodel import select

from .config import Settings
from .db import Database
from .models import ExternalIdentity, Membership, User
from .profile_models import token_version

ROLES = {"viewer", "editor", "secretary", "department_admin"}
WRITE_ROLES = {"editor", "secretary", "department_admin"}


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Пароль должен содержать не менее 12 символов.")
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(candidate, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


@dataclass(frozen=True)
class Principal:
    user: User
    memberships: dict[str, str]

    def can(self, department_id: str, action: str = "read") -> bool:
        if self.user.is_system_admin:
            return True
        role = self.memberships.get(department_id)
        if action == "read":
            return role in ROLES
        if action == "write":
            return role in WRITE_ROLES
        if action == "approve":
            return role in {"secretary", "department_admin"}
        if action == "admin":
            return role == "department_admin"
        return False

    def require(self, department_id: str, action: str = "read") -> None:
        if not self.can(department_id, action):
            raise HTTPException(403, "Нет доступа к этому департаменту или действию.")


class Auth:
    def __init__(self, settings: Settings, db: Database):
        self.settings, self.db = settings, db
        if settings.auth_mode not in {"local", "keycloak", "hybrid", "disabled"}:
            raise RuntimeError("AUTH_MODE должен быть local, keycloak, hybrid или disabled.")
        if settings.auth_mode == "disabled":
            log.warning("AUTH_MODE=disabled: вход отключён, все запросы идут от демо-администратора. Только для демо.")
        if settings.auth_mode != "disabled" and len(settings.jwt_secret) < 32:
            raise RuntimeError("Для авторизации задайте JWT_SECRET длиной не менее 32 символов.")
        if settings.auth_mode in {"keycloak", "hybrid"}:
            if not settings.keycloak_issuer.startswith("https://") or not settings.keycloak_audience:
                raise RuntimeError("Для Keycloak задайте HTTPS KEYCLOAK_ISSUER и KEYCLOAK_AUDIENCE.")
            self.jwks = PyJWKClient(settings.keycloak_issuer.rstrip("/") + "/protocol/openid-connect/certs")
        else:
            self.jwks = None
        if settings.bootstrap_admin_user or settings.bootstrap_admin_password:
            if not settings.bootstrap_admin_user or not settings.bootstrap_admin_password:
                raise RuntimeError("BOOTSTRAP_ADMIN_USER и BOOTSTRAP_ADMIN_PASSWORD задаются вместе.")
            with db.session() as session:
                existing = session.exec(select(User).where(User.username == settings.bootstrap_admin_user)).first()
                if existing is None:
                    session.add(User(username=settings.bootstrap_admin_user,
                                     password_hash=hash_password(settings.bootstrap_admin_password),
                                     display_name=settings.bootstrap_admin_user, is_system_admin=True))
                    session.commit()

    def principal(self, user: User) -> Principal:
        with self.db.session() as session:
            memberships = session.exec(select(Membership).where(Membership.user_id == user.id)).all()
        return Principal(user, {m.department_id: m.role for m in memberships})

    def login(self, username: str, password: str) -> tuple[str, Principal]:
        if self.settings.auth_mode not in {"local", "hybrid"}:
            raise HTTPException(404, "Вход по паролю отключён.")
        with self.db.session() as session:
            user = session.exec(select(User).where(User.username == username)).first()
        if user is None or not user.active or not verify_password(password, user.password_hash):
            raise HTTPException(401, "Неверный логин или пароль.")
        return self.issue(user), self.principal(user)

    def issue(self, user: User) -> str:
        now = datetime.now(timezone.utc)
        with self.db.session() as session:
            version = token_version(session, user.id)
        return jwt.encode({"sub": user.id, "iss": self.settings.jwt_issuer, "aud": "siqyr-api",
                           "iat": now, "exp": now + timedelta(minutes=self.settings.jwt_ttl_minutes),
                           "ver": version},
                          self.settings.jwt_secret, algorithm="HS256")

    def identify(self, authorization: str | None) -> Principal:
        if self.settings.auth_mode == "disabled":
            return Principal(User(id="demo", username="demo", display_name="Демо-режим (без входа)", is_system_admin=True), {})
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Требуется токен доступа.", headers={"WWW-Authenticate": "Bearer"})
        token = authorization[7:]
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") == "HS256":
                payload = jwt.decode(token, self.settings.jwt_secret, algorithms=["HS256"],
                                     issuer=self.settings.jwt_issuer, audience="siqyr-api", options={"require": ["sub", "iss", "aud", "exp"]})
                with self.db.session() as session:
                    user = session.get(User, payload["sub"])
                    if user is not None and payload.get("ver", 0) != token_version(session, user.id):
                        raise HTTPException(401, "Токен отозван после смены пароля.")
            elif header.get("alg") == "RS256" and self.jwks is not None:
                signing_key = self.jwks.get_signing_key_from_jwt(token)
                payload = jwt.decode(token, signing_key.key, algorithms=["RS256"],
                                     issuer=self.settings.keycloak_issuer.rstrip("/"), audience=self.settings.keycloak_audience,
                                     options={"require": ["sub", "iss", "aud", "exp"]})
                with self.db.session() as session:
                    identity = session.exec(select(ExternalIdentity).where(
                        ExternalIdentity.provider == "keycloak", ExternalIdentity.subject == payload["sub"])).first()
                    user = session.get(User, identity.user_id) if identity else None
            else:
                user = None
            if user is None or not user.active:
                raise HTTPException(401, "Пользователь не зарегистрирован или отключён.")
            return self.principal(user)
        except HTTPException:
            raise
        except Exception as exc:
            # PyJWKClient may fail on a temporary IdP outage; do not accept an unverified token.
            raise HTTPException(401, "Недействительный токен доступа.") from exc

    def by_external_identity(self, provider: str, subject: str) -> User | None:
        with self.db.session() as session:
            identity = session.exec(select(ExternalIdentity).where(
                ExternalIdentity.provider == provider, ExternalIdentity.subject == subject)).first()
            return session.get(User, identity.user_id) if identity else None
