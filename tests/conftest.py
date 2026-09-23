from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from backend.app import config
from backend.app.main import create_app


@pytest.fixture
def client_factory(tmp_path, monkeypatch):
    for key, value in {"AGENT_MODE": "mock", "STT_MODE": "mock", "MOCK_DELAY": "0",
                       "DATA_DIR": str(tmp_path), "REMINDER_INTERVAL_SEC": "0", "SEED": "0",
                       "DEMO_MODE": "live", "REPLAY_RUN_ID": "", "DEMO_TODAY": "2026-09-23",
                       "LLM_PROVIDER": "local", "LLM_BASE_URL": "", "LLM_ALLOWED_HOSTS": "", "LLM_API_KEY": "",
                       "MODEL_MAIN": "gpt-6-luna", "MODEL_FAST": "gpt-6-luna",
                       "RATE_LIMIT_PER_MIN": "100", "PDF_FONT_PATH": ""}.items():
        monkeypatch.setenv(key, value)
    # .env разработчика может указывать на живую Jira: тесты ходят только в httpx.MockTransport.
    for key in ("JIRA_URL", "JIRA_EMAIL", "JIRA_TOKEN", "JIRA_PROJECT", "JIRA_BOARD_ID", "JIRA_USERS", "JIRA_ALLOW_CLOUD", "PUBLIC_APP_URL"):
        monkeypatch.setenv(key, "")
    monkeypatch.setenv("AUTH_MODE", "disabled")
    with ExitStack() as stack:
        def make(**overrides):
            settings = config.Settings(**overrides)
            monkeypatch.setattr(config, "settings", settings)
            client = stack.enter_context(TestClient(create_app(settings)))
            client.settings = settings
            return client
        yield make


@pytest.fixture
def client(client_factory):
    return client_factory()
