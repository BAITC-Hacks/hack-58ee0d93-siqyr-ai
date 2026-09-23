"""Тестовые учётки для локального демо: по одной на каждую роль.

    python scripts/seed_test_users.py [--password ПАРОЛЬ] [--reset-password]
    python scripts/seed_test_users.py --disable

Пишет прямо в SQLite из DATA_DIR (.env), API можно не останавливать.
Пароль общий для всех учёток: --password, иначе TEST_USERS_PASSWORD, иначе генерируется
и печатается один раз. Повторный запуск досоздаёт недостающее, включает отключённые учётки
и не меняет пароли без --reset-password.
--disable отключает все учётки test.*: выданные им токены сразу перестают работать.
Входить по паролю можно при AUTH_MODE=local или hybrid. Не запускайте на контуре заказчика.
"""
import argparse
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import select  # noqa: E402

from backend.app.auth import hash_password  # noqa: E402
from backend.app.config import Settings  # noqa: E402
from backend.app.db import Database  # noqa: E402
from backend.app.models import Department, Membership, User  # noqa: E402
from backend.app.profile_models import bump_token_version  # noqa: E402

PREFIX = "test."
# Интерфейс создаёт совещания в департаменте default, поэтому основные роли живут там.
# test.legal состоит только в legal и не должен видеть совещания default.
DEPARTMENTS = {"legal": "Юридический департамент (тест)"}
USERS = [
    # username, display_name, is_system_admin, {department_id: role}
    ("test.admin", "Тест: системный администратор", True, {}),
    ("test.dept_admin", "Тест: администратор департамента", False, {"default": "department_admin"}),
    ("test.secretary", "Тест: секретарь", False, {"default": "secretary"}),
    ("test.editor", "Тест: редактор", False, {"default": "editor"}),
    ("test.viewer", "Тест: наблюдатель", False, {"default": "viewer"}),
    ("test.legal", "Тест: секретарь юридического департамента", False, {"legal": "secretary"}),
]


def seed(db: Database, password: str, reset_password: bool = False) -> list[tuple[str, str, str]]:
    """Создаёт недостающие департаменты, учётки и роли. Возвращает [(username, роли, статус)]."""
    report = []
    with db.session() as session:
        for department_id, name in DEPARTMENTS.items():
            if session.get(Department, department_id) is None:
                session.add(Department(id=department_id, organization_id="default", name=name))
        session.flush()
        for username, display_name, is_system_admin, roles in USERS:
            user = session.exec(select(User).where(User.username == username)).first()
            if user is None:
                user = User(username=username, display_name=display_name,
                            password_hash=hash_password(password), is_system_admin=is_system_admin)
                session.add(user)
                session.flush()
                status = "создана"
            else:
                status = "уже есть"
                if reset_password:
                    user.password_hash = hash_password(password)
                    bump_token_version(session, user.id)
                    status = "пароль сброшен"
                if not user.active:
                    user.active = True
                    status += ", включена"
                user.is_system_admin = is_system_admin
                session.add(user)
            for department_id, role in roles.items():
                membership = session.exec(select(Membership).where(
                    Membership.user_id == user.id, Membership.department_id == department_id)).first()
                if membership is None:
                    membership = Membership(user_id=user.id, department_id=department_id, role=role)
                membership.role = role
                session.add(membership)
            summary = "system_admin" if is_system_admin else ", ".join(f"{role}@{dep}" for dep, role in roles.items())
            report.append((username, summary, status))
        session.commit()
    return report


def disable(db: Database) -> list[str]:
    """Отключает все учётки test.*; identify() отклоняет их токены при следующем запросе."""
    with db.session() as session:
        users = session.exec(select(User).where(User.username.startswith(PREFIX), User.active == True)).all()  # noqa: E712
        for user in users:
            user.active = False
            session.add(user)
        session.commit()
        return [user.username for user in users]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--password", default=os.environ.get("TEST_USERS_PASSWORD", ""))
    parser.add_argument("--reset-password", action="store_true")
    parser.add_argument("--disable", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    db = Database(settings)
    try:
        if args.disable:
            disabled = disable(db)
            print(f"Отключены: {', '.join(disabled)}" if disabled else "Активных учёток test.* нет.")
            return 0
        password = args.password or secrets.token_urlsafe(12)
        if len(password) < 12:
            print("Пароль должен содержать не менее 12 символов.", file=sys.stderr)
            return 1
        report = seed(db, password, args.reset_password)
    finally:
        db.close()
    print(f"База: {settings.db_path}")
    for username, roles, status in report:
        print(f"  {username:16} {roles:28} {status}")
    if any(status.startswith(("создана", "пароль сброшен")) for _, _, status in report):
        print(f"Пароль для созданных и сброшенных учёток: {password}")
    else:
        print("Пароли не менялись. Новый пароль: --reset-password.")
    if settings.auth_mode not in {"local", "hybrid"}:
        print(f"Внимание: AUTH_MODE={settings.auth_mode}, вход по паролю выключен. Для входа задайте в .env "
              "AUTH_MODE=local и JWT_SECRET длиной от 32 символов, затем перезапустите API.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
