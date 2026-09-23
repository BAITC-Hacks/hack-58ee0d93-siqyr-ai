"""Deterministic synthetic runner with the same interface as runner.py."""
import asyncio
from datetime import date, timedelta

from backend.app import config
from backend.app.demo import demo_meeting
from backend.shared.schemas import AssignmentDraft, Emit, Excerpt, Proposal, Result, RunInput, StepEvent


async def _step(emit: Emit, run_id: str, kind: str, agent: str, content: str, **data):
    await asyncio.sleep(max(0, config.settings.mock_delay) * (0.3 if kind == "tool_call" else 0.6))
    return await emit(StepEvent(run_id=run_id, type=kind, agent=agent, content=content, data=data))


def normalize_deadline(index: int, meeting_date: date) -> date:
    if index == 0:
        return meeting_date + timedelta(days=(4 - meeting_date.weekday()) % 7 or 7)
    if index == 1:
        return meeting_date + timedelta(days=1)
    # Explicit month/day phrases refer to the meeting year, even if already overdue.
    return date(meeting_date.year, 9, 30) if index == 2 else date(meeting_date.year, 10, 5)


async def propose(run_input: RunInput, emit: Emit) -> Proposal:
    rid = run_input.run_id
    if not run_input.segments or not any(s.text.strip() for s in run_input.segments):
        await _step(emit, rid, "error", "orchestrator", "Транскрипт пуст: подготовить протокол невозможно.")
        raise ValueError("Транскрипт пуст.")
    fixture = demo_meeting()
    await _step(emit, rid, "agent_start", "orchestrator", "Начинаю подготовку протокола синтетического совещания.")
    await _step(emit, rid, "handoff", "orchestrator", "Передаю реплики для сопоставления участников.", to="speaker_mapper")
    await _step(emit, rid, "agent_start", "speaker_mapper", "Сопоставляю голоса со списком участников.")
    participants = run_input.participants
    speakers = {
        speaker: participants[i].name if i < len(participants) else name
        for i, (speaker, name) in enumerate(fixture["speakers"].items())
    }
    names = {name: speakers[speaker] for speaker, name in fixture["speakers"].items()}
    await _step(emit, rid, "tool_result", "speaker_mapper", "Определены три участника совещания.", speakers=speakers)
    await _step(emit, rid, "handoff", "orchestrator", "Передаю транскрипт для выделения поручений.", to="assignment_extractor")
    await _step(emit, rid, "agent_start", "assignment_extractor", "Выделяю исполнителей, задачи и сроки на русском и казахском.")
    assignments = []
    for i, item in enumerate(fixture["expected"]["assignments"]):
        await _step(emit, rid, "tool_call", "assignment_extractor", f"Уточняю срок: {item['deadline_text']}.",
                    tool="normalize_deadline", arguments={"text": item["deadline_text"], "meeting_date": run_input.meeting_date.isoformat()})
        deadline = normalize_deadline(i, run_input.meeting_date)
        await _step(emit, rid, "tool_result", "assignment_extractor", f"Срок приведён к дате {deadline.isoformat()}.",
                    tool="normalize_deadline", deadline=deadline.isoformat())
        assignments.append(AssignmentDraft.model_validate({**item, "assignee": names[item["assignee"]], "deadline": deadline}))
    await _step(emit, rid, "handoff", "orchestrator", "Передаю результаты для краткого протокола.", to="summarizer")
    await _step(emit, rid, "agent_start", "summarizer", "Формирую резюме и фиксирую принятые решения.")
    next_wednesday = run_input.meeting_date + timedelta(days=(2 - run_input.meeting_date.weekday()) % 7 or 7)
    return Proposal(
        run_id=rid, speakers=speakers, segments=run_input.segments, assignments=assignments,
        summary="Участники обсудили запуск портала обращений, подготовку отчёта за сентябрь, передачу данных колл-центра, тестирование и презентацию для министерства.",
        decisions=[f"Следующее совещание — в следующую среду ({next_wednesday.isoformat()})"],
    )


async def execute(proposal: Proposal, emit: Emit) -> Result:
    await _step(emit, proposal.run_id, "handoff", "orchestrator", "Протокол утверждён; передаю поручения для подготовки выдержек.", to="notifier")
    await _step(emit, proposal.run_id, "agent_start", "notifier", "Готовлю персональные выдержки для ответственных.")
    grouped: dict[str, list[str]] = {}
    for item in proposal.assignments:
        grouped.setdefault(item.assignee, []).append(f"{item.task}. Срок: {item.deadline or 'не указан'}.")
    excerpts = [Excerpt(recipient=name, message="Ваши поручения по утверждённому протоколу:\n" + "\n".join(tasks)) for name, tasks in grouped.items()]
    await _step(emit, proposal.run_id, "tool_result", "notifier", f"Подготовлены выдержки для {len(excerpts)} ответственных.", recipients=list(grouped))
    return Result(run_id=proposal.run_id, excerpts=excerpts)
