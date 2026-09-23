import json
import time

import httpx
import pytest

JIRA = {"jira_url": "https://jira.example.kz", "jira_token": "pat", "jira_project": "SCRUM", "jira_board_id": "1",
        "jira_users": json.dumps({"Дана Примерова": "dana"}, ensure_ascii=False)}


class FakeJira:
    """Jira REST v2 + Agile: priority нет на экране создания, как бывает в team-managed проекте."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.issues: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/issuetypes"):
            return httpx.Response(200, json={"issueTypes": [{"id": "10003", "name": "Subtask"}, {"id": "10002", "name": "Task"}]})
        if path == "/rest/api/2/user/assignable/search":
            query = request.url.params.get("username") or request.url.params.get("query")
            users = {"dana": [{"name": "dana", "accountId": "acc-dana"}], "Айгерим Тестова": [{"name": "a1"}, {"name": "a2"}]}
            return httpx.Response(200, json=users.get(query, []))
        if path == "/rest/api/2/issue":
            fields = json.loads(request.content)["fields"]
            if "priority" in fields:
                return httpx.Response(400, json={"errorMessages": [], "errors": {"priority": "Field 'priority' cannot be set."}})
            self.issues.append(fields)
            return httpx.Response(201, json={"id": str(len(self.issues)), "key": f"SCRUM-{len(self.issues)}"})
        if path.endswith("/attachments"):
            return httpx.Response(200, json=[])
        if path == "/rest/agile/1.0/board/1/sprint":
            return httpx.Response(200, json={"values": [{"id": 7, "name": "SCRUM Sprint 1"}]})
        if path == "/rest/agile/1.0/sprint/7/issue":
            return httpx.Response(204)
        return httpx.Response(404)


def approved_run(client, exclude: int | None = None, early: int | None = None) -> str:
    response = client.post("/api/runs", data={"sample": "demo", "meeting_date": "2026-09-23"})
    run_id = response.json()["run_id"]
    end = time.monotonic() + 15
    while (detail := client.get(f"/api/runs/{run_id}").json())["run"]["status"] != "awaiting_approval":
        assert time.monotonic() < end, detail["steps"]
        time.sleep(0.01)
    if early is not None:
        assert client.post(f"/api/runs/{run_id}/jira").status_code == early  # до утверждения — нельзя
    proposal = detail["proposal"]
    if exclude is not None:
        proposal["assignments"][exclude]["review_status"] = "excluded"
    assert client.post(f"/api/runs/{run_id}/approve", json={"approved": True, "proposal": proposal}).status_code == 200
    while client.get(f"/api/runs/{run_id}").json()["run"]["status"] != "done":
        assert time.monotonic() < end
        time.sleep(0.01)
    return run_id


def test_push_approved_assignments(client_factory):
    client = client_factory(**JIRA)
    fake = FakeJira()
    client.app.state.jira_transport = httpx.MockTransport(fake)
    run_id = approved_run(client, exclude=1, early=409)

    body = client.post(f"/api/runs/{run_id}/jira").json()
    assert body["created"] == ["SCRUM-1", "SCRUM-2", "SCRUM-3"]  # исключённое поручение не отправлено
    assert body["sprint"] == "SCRUM Sprint 1"
    assert [i["position"] for i in body["issues"]] == [0, 2, 3]
    assert body["issues"][0]["url"] == "https://jira.example.kz/browse/SCRUM-1"
    assert all(r.headers["Authorization"] == "Bearer pat" for r in fake.requests)

    erlan, dana, aigerim = fake.issues
    assert erlan["issuetype"] == {"id": "10002"} and erlan["project"] == {"key": "SCRUM"}
    assert erlan["duedate"] == "2026-09-25" and "priority" not in erlan
    assert "жұмаға дейін" in erlan["description"] and "Источник в записи совещания" in erlan["description"]
    assert "assignee" not in erlan and "siqyr-owner-check" in erlan["labels"]  # в Jira не найден — не угадываем
    assert dana["assignee"] == {"name": "dana"} and "siqyr-owner-check" not in dana["labels"]  # через JIRA_USERS
    assert "assignee" not in aigerim  # два кандидата — не назначаем
    assert [i["assigned"] for i in body["issues"]] == [False, True, False]
    attachments = [r for r in fake.requests if r.url.path.endswith("/attachments")]
    assert len(attachments) in (0, 3) and all(r.headers["X-Atlassian-Token"] == "no-check" for r in attachments)

    again = client.post(f"/api/runs/{run_id}/jira").json()  # повторное нажатие не создаёт дублей
    assert again["created"] == [] and again["issues"] == body["issues"] and len(fake.issues) == 3
    links = client.get(f"/api/runs/{run_id}/jira").json()
    assert links["configured"] is True and links["project"] == "SCRUM" and len(links["issues"]) == 3


@pytest.mark.parametrize("overrides, status", [
    ({}, 503),  # не настроена
    ({**JIRA, "jira_url": "https://syqir.atlassian.net"}, 503),  # Cloud без явного разрешения
])
def test_push_refused(client_factory, overrides, status):
    client = client_factory(**overrides)
    client.app.state.jira_transport = httpx.MockTransport(lambda request: pytest.fail(f"unexpected Jira call {request.url}"))
    run_id = approved_run(client)
    response = client.post(f"/api/runs/{run_id}/jira")
    assert response.status_code == status and response.json()["detail"]


def test_cloud_uses_basic_auth_and_account_id(client_factory):
    client = client_factory(**{**JIRA, "jira_url": "https://syqir.atlassian.net", "jira_email": "demo@example.com", "jira_allow_cloud": True})
    fake = FakeJira()
    client.app.state.jira_transport = httpx.MockTransport(fake)
    run_id = approved_run(client)
    assert len(client.post(f"/api/runs/{run_id}/jira").json()["created"]) == 4
    assert fake.requests[0].headers["Authorization"].startswith("Basic ")
    assert {"accountId": "acc-dana"} in [i.get("assignee") for i in fake.issues]
    searches = [r for r in fake.requests if r.url.path.endswith("/assignable/search")]
    assert searches and all("query" in r.url.params for r in searches)


def test_jira_errors_are_reported(client_factory):
    client = client_factory(**JIRA)
    client.app.state.jira_transport = httpx.MockTransport(lambda request: httpx.Response(401))
    run_id = approved_run(client)
    response = client.post(f"/api/runs/{run_id}/jira")
    assert response.status_code == 502 and "учётные данные" in response.json()["detail"]
    assert client.get(f"/api/runs/{run_id}/jira").json()["issues"] == []
