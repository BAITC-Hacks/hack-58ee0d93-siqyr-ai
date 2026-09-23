"""New, fully fictional RU/KK/mixed regressions; no hosted calls or evaluation fixtures."""
import asyncio
import json
from datetime import date
from types import SimpleNamespace

import pytest

from backend.agents import runner
from backend.shared.schemas import AssignmentDraft, Participant, Proposal, RunInput, Segment


def source(*texts, names=(), labels=None):
    return RunInput(run_id="synthetic-quality", title="Вымышленная проверка", meeting_date=None,
                    meeting_date_verified=False, participants=[Participant(name=name) for name in names],
                    segments=[Segment(start=i * 10, end=i * 10 + 9, speaker=(labels or ["SPEAKER_00"] * len(texts))[i], text=text)
                              for i, text in enumerate(texts)])


def item(task, *, owner=None, deadline=None, deadline_text=None, evidence=()):
    return dict(task=task, assignee=owner, deadline=deadline, deadline_text=deadline_text,
                source_segments=list(dict.fromkeys(index for index, _, _ in evidence)),
                evidence=[dict(segment_index=index, quote=quote, field=field) for index, quote, field in evidence])


def parse(raw, *items):
    return runner._parse(json.dumps(dict(summary="Обсудили вымышленные задачи.", decisions=[], speakers={}, assignments=items), ensure_ascii=False), raw)


def test_evidence_is_raw_with_server_times_and_roundtrips():
    raw = source("Демоай,  подготовь   эскиз.", names=["Демоай"])
    original = raw.model_dump()
    result = parse(raw, item("Подготовить эскиз", owner="Демоай", evidence=[
        (0, "подготовь эскиз", "task"), (0, "демоай", "assignee")]))
    assignment = result.assignments[0]
    assert assignment.evidence[0].quote == "подготовь   эскиз"
    assert assignment.evidence[1].quote == "Демоай"
    assert assignment.evidence[0].start == 0 and assignment.evidence[0].end == 9
    assert assignment.confidence is None
    assert Proposal.model_validate_json(result.model_dump_json()) == result
    assert raw.model_dump() == original


def test_name_fragment_is_not_raw_evidence():
    with pytest.raises(ValueError, match="Цитата отсутствует"):
        parse(source("Демоайка готовит эскиз"), item("Эскиз", owner="Демоай", evidence=[
            (0, "готовит эскиз", "task"), (0, "Демоай", "assignee")]))


@pytest.mark.parametrize("intro", ["Меня зовут Демоай.", "я демоай готова", "мен Демоаймын", "менің атым Демоай"])
def test_self_introduction_proposes_only_same_voice(intro):
    raw = source(intro, "я подготовлю эскиз", names=["Демоай"], labels=["SPEAKER_00", "SPEAKER_00"])
    proposal = parse(raw, item("Подготовить эскиз", evidence=[(1, "я подготовлю эскиз", "task")]))
    record = proposal.speaker_records[0]
    assert record.participant_name == "Демоай"
    assert record.mapping_status == "suggested" and record.confidence is None
    assert record.evidence and record.source_segments == [0, 1]
    assert proposal.assignments[0].assignee == "Демоай"
    assert "speaker_uncertain" in proposal.assignments[0].review_reasons
    assert proposal.assignments[0].source_segments == [1, 0]


def test_addressing_someone_does_not_name_the_current_voice():
    proposal = parse(source("Демоай, подготовь эскиз", names=["Демоай"]), item("Подготовить эскиз", owner="Демоай",
                     evidence=[(0, "подготовь эскиз", "task"), (0, "Демоай", "assignee")]))
    assert proposal.speakers == {}
    assert proposal.speaker_records[0].participant_name is None
    assert proposal.assignments[0].assignee == "Демоай"


def test_neighbor_voice_does_not_inherit_identity():
    proposal = parse(source("меня зовут Демоай", "я подготовлю эскиз", names=["Демоай"], labels=["SPEAKER_00", "SPEAKER_01"]),
                     item("Подготовить эскиз", evidence=[(1, "я подготовлю эскиз", "task")]))
    assert proposal.assignments[0].assignee is None
    assert proposal.speaker_records[1].participant_name is None


@pytest.mark.parametrize("names,texts", [
    (["Демоай Первый", "Демоай Второй"], ["меня зовут Демоай"]),
    (["Демоай", "Демобек"], ["меня зовут Демоай", "меня зовут Демобек"]),
    (["Демогүл"], ["меня зовут Демогуль"]),
])
def test_ambiguous_or_misheard_identity_is_only_candidates(names, texts):
    proposal = parse(source(*texts, names=names))
    assert proposal.speakers == {}
    assert proposal.speaker_records[0].candidate_names
    assert proposal.speaker_records[0].mapping_status == "unmapped"
    assert proposal.speaker_records[0].evidence


def test_same_name_on_two_voices_requires_review():
    proposal = parse(source("меня зовут Демоай", "меня зовут Демоай", names=["Демоай"], labels=["SPEAKER_00", "SPEAKER_01"]))
    assert proposal.speakers == {}
    assert all(r.mapping_status == "unmapped" for r in proposal.speaker_records)


@pytest.mark.parametrize("proposed,expected", [("Демогүл", None), ("Демогуль", "Демогуль")])
def test_misheard_name_is_not_silently_corrected(proposed, expected):
    result = parse(source("Демогуль, подготовь эскиз", names=["Демогүл"]), item("Подготовить эскиз", owner=proposed,
                   evidence=[(0, "подготовь эскиз", "task"), (0, "Демогуль", "assignee")])).assignments[0]
    assert result.assignee == expected
    assert result.assignee_candidates == ["Демогүл"]
    assert "owner_uncertain" in result.review_reasons
    assert result.evidence[1].quote == "Демогуль"


def test_external_department_is_an_assignee_without_becoming_a_speaker():
    proposal = parse(source("Отдел макетов подготовит эскиз", names=["Демоай"]), item("Подготовить эскиз", owner="Отдел макетов",
                     evidence=[(0, "подготовит эскиз", "task"), (0, "Отдел макетов", "assignee")]))
    assert proposal.assignments[0].assignee == "Отдел макетов"
    assert proposal.speakers == {}
    assert len(proposal.speaker_records) == 1


@pytest.mark.parametrize("label,reasons", [("OVERLAP", {"overlap", "speaker_uncertain"}), (None, {"speaker_uncertain"})])
def test_unreliable_voice_is_flagged(label, reasons):
    proposal = parse(source("меня зовут Демоай я подготовлю эскиз", names=["Демоай"], labels=[label]),
                     item("Подготовить эскиз", evidence=[(0, "я подготовлю эскиз", "task")]))
    assert proposal.speakers == {}
    assert reasons <= set(proposal.assignments[0].review_reasons)


@pytest.mark.parametrize("text,task_a,task_b", [
    ("подготовь эскиз до 2027-02-03 а смету рассчитай до 2027-02-08", "подготовь эскиз", "смету рассчитай"),
    ("сызбаны 2027-02-03 дейін дайында ал сметаны 2027-02-08 дейін есепте", "сызбаны", "сметаны"),
    ("сызбаны дайында до 2027-02-03 затем рассчитай смету 2027-02-08 дейін", "сызбаны дайында", "рассчитай смету"),
])
def test_two_unrelated_deadlines_in_one_segment(text, task_a, task_b):
    proposal = parse(source(text), item("Эскиз", deadline="2027-02-03", deadline_text="2027-02-03", evidence=[
        (0, task_a, "task"), (0, "2027-02-03", "deadline")]), item("Смета", deadline="2027-02-08", deadline_text="2027-02-08", evidence=[
        (0, task_b, "task"), (0, "2027-02-08", "deadline")]))
    assert [a.deadline for a in proposal.assignments] == [date(2027, 2, 3), date(2027, 2, 8)]
    assert all("deadline_conflict" not in a.review_reasons for a in proposal.assignments)


@pytest.mark.parametrize("marker,expected", [("предлагаю", None), ("согласовали", date(2027, 2, 8)), ("не согласовано", None), ("не утвердили", None), ("не согласовали", None), ("келісілді", date(2027, 2, 8))])
def test_same_task_revision_inside_one_segment(marker, expected):
    proposal = parse(source(f"подготовь эскиз до 2027-02-03 затем {marker} срок до 2027-02-08"),
                     item("Эскиз", deadline="2027-02-08", deadline_text="до 2027-02-03; до 2027-02-08", evidence=[
                         (0, "подготовь эскиз", "task"), (0, "до 2027-02-03", "deadline"), (0, "до 2027-02-08", "deadline")]))
    assignment = proposal.assignments[0]
    assert assignment.deadline == expected
    assert ("deadline_conflict" in assignment.review_reasons) == (expected is None)
    assert len(assignment.evidence) == 3


def test_agreed_revision_can_replace_deadline_text_within_same_segment():
    result = parse(source("эскиз до 2027-02-03 затем согласовали до 2027-02-08"),
                   item("Эскиз", deadline=None, deadline_text="до 2027-02-08", evidence=[
                       (0, "эскиз", "task"), (0, "до 2027-02-03", "deadline"), (0, "до 2027-02-08", "deadline")])).assignments[0]
    assert result.deadline == date(2027, 2, 8)


def test_agreement_for_other_task_does_not_approve_proposed_date():
    proposal = parse(source("предлагаю подготовить эскиз до 2027-02-03 а согласовали рассчитать смету до 2027-02-08"),
                     item("Эскиз", deadline="2027-02-03", deadline_text="2027-02-03", evidence=[
                         (0, "подготовить эскиз", "task"), (0, "2027-02-03", "deadline")]),
                     item("Смета", deadline="2027-02-08", deadline_text="2027-02-08", evidence=[
                         (0, "рассчитать смету", "task"), (0, "2027-02-08", "deadline")]))
    assert proposal.assignments[0].deadline is None
    assert "deadline_unknown" in proposal.assignments[0].review_reasons
    assert proposal.assignments[1].deadline == date(2027, 2, 8)


def test_uncited_competing_deadline_still_rejected():
    with pytest.raises(ValueError, match="Не все даты"):
        parse(source("подготовь эскиз до 2027-02-03 предлагаю до 2027-02-08"),
              item("Эскиз", deadline="2027-02-03", deadline_text="2027-02-03", evidence=[
                  (0, "подготовь эскиз", "task"), (0, "2027-02-03", "deadline")]))


def test_crossed_task_deadlines_are_rejected():
    with pytest.raises(ValueError, match="пересекаются"):
        parse(source("подготовь эскиз до 2027-02-03 а смету рассчитай до 2027-02-08"),
              item("Эскиз", deadline="2027-02-08", deadline_text="2027-02-08", evidence=[
                  (0, "подготовь эскиз", "task"), (0, "2027-02-08", "deadline")]),
              item("Смета", deadline="2027-02-03", deadline_text="2027-02-03", evidence=[
                  (0, "смету рассчитай", "task"), (0, "2027-02-03", "deadline")]))


def test_invalid_response_cannot_be_repaired_as_empty_success(monkeypatch):
    responses = iter(["{}", json.dumps(dict(summary="Обсудили эскиз", decisions=[], speakers={}, assignments=[]))])
    async def complete(*args, **kwargs):
        return SimpleNamespace(content=next(responses), tokens=0, cost_usd=0)
    events = []
    async def emit(event):
        events.append(event)
        return event
    monkeypatch.setattr(runner.llm, "complete", complete)
    with pytest.raises(ValueError, match="Пустой список"):
        asyncio.run(runner.propose(source("подготовь эскиз"), emit))
    assert events[-1].type == "error"
    assert not any(event.type == "tool_result" for event in events)


def test_valid_negative_result_is_allowed():
    assert parse(source("Сегодня лишь обсуждаем цвета, поручений нет.")).assignments == []


def test_first_person_in_another_task_does_not_supply_owner():
    raw = source("меня зовут Демоай", "подготовьте эскиз а я рассчитаю смету", names=["Демоай"])
    proposal = parse(raw,
                     item("Эскиз", evidence=[(1, "подготовьте эскиз", "task")]),
                     item("Смета", evidence=[(1, "я рассчитаю смету", "task")]))
    assert proposal.assignments[0].assignee is None
    assert proposal.assignments[1].assignee == "Демоай"


def test_malformed_sibling_evidence_is_a_repairable_error():
    invalid = item("Смета", evidence=[(0, "смета", "task")])
    invalid["evidence"] = [None]
    with pytest.raises(ValueError, match="Некорректная цитата"):
        parse(source("эскиз и смета"), item("Эскиз", evidence=[(0, "эскиз", "task")]), invalid)


def test_execute_skips_unknown_and_excluded_without_model_calls(monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("execute must not call LLM")
    async def emit(event):
        return event
    monkeypatch.setattr(runner.llm, "complete", forbidden)
    proposal = Proposal(run_id="synthetic-quality", summary="Тест", assignments=[
        AssignmentDraft(task="Неизвестный исполнитель"),
        AssignmentDraft(task="Исключено", assignee="Демоай", review_status="excluded"),
        AssignmentDraft(task="Проверено", assignee="Демобек", review_status="confirmed"),
    ])
    result = asyncio.run(runner.execute(proposal, emit))
    assert [excerpt.recipient for excerpt in result.excerpts] == ["Демобек"]


def test_ambiguous_voice_candidates_survive_short_task_quote():
    result = parse(source("меня зовут Демобек подготовлю макет", names=["Демобек Первый", "Демобек Второй"]),
                   item("Подготовить макет", evidence=[(0, "подготовлю макет", "task")])).assignments[0]
    assert result.assignee is None
    assert result.assignee_candidates == ["Демобек Второй", "Демобек Первый"]
    assert "speaker_uncertain" in result.review_reasons
    assert any("меня зовут" in ev.quote for ev in result.evidence)


@pytest.mark.parametrize("new_date", ["2028-03-09", "9 марта"])
def test_unapproved_change_retains_explicitly_agreed_date(new_date):
    result = parse(source("согласовали подготовить макет до 2028-03-04", f"предлагаю перенести макет на {new_date} решение не принято"),
                   item("Подготовить макет", deadline=None, deadline_text=f"до 2028-03-04; на {new_date}", evidence=[
                       (0, "подготовить макет", "task"), (0, "до 2028-03-04", "deadline"),
                       (1, f"на {new_date}", "deadline")])).assignments[0]
    assert result.deadline == date(2028, 3, 4)
    assert "deadline_conflict" in result.review_reasons
    assert len(result.deadline_candidates) == 2


@pytest.mark.parametrize("first,second", [("бейсенбіге дейін", "бейсенбіге дейін жіберемін"),
                                          ("до 2028-03-04", "к 4 марта 2028 года")])
def test_same_deadline_phrases_do_not_create_conflict(first, second):
    result = parse(source(f"подготовь макет {first}", f"макет {second}"),
                   item("Подготовить макет", deadline=None, deadline_text=f"{first}; {second}", evidence=[
                       (0, "подготовь макет", "task"), (0, first, "deadline"), (1, second, "deadline")])).assignments[0]
    assert "deadline_conflict" not in result.review_reasons
    assert result.deadline_candidates == []
    assert len(result.evidence) == 3


def test_generic_action_flags_scope_and_keeps_full_raw_context():
    raw = source("ауыл картасын жасау керек до среды")
    result = parse(raw, item("жасау керек", deadline_text="до среды", evidence=[
        (0, "жасау керек", "task"), (0, "до среды", "deadline")])).assignments[0]
    assert "scope_incomplete" in result.review_reasons
    assert any(ev.quote == raw.segments[0].text for ev in result.evidence)
