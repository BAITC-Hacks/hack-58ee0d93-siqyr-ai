"""Small synthetic history, inserted once per database."""
from datetime import timedelta

from sqlmodel import select

from backend.shared.schemas import AssignmentDraft, Proposal, Result, StepEvent
from .config import Settings, today
from .db import Database
from .demo import demo_meeting
from .models import Assignment, Cache, Run, Step


def seed_history(db: Database, settings: Settings):
    with db.session() as session:
        if session.get(Cache, "system:history-seeded"):
            return
        # Existing installations must never acquire duplicate seed history.
        if session.exec(select(Run)).first() is None:
            fixture = demo_meeting()
            run = Run(title="Синтетическая история: контроль поручений", meeting_date=today(settings) - timedelta(days=7),
                      status="done", synthetic=True, participants=fixture["participants"])
            drafts = []
            for index, (offset, done) in enumerate([(-3, False), (0, False), (-1, True)]):
                raw = fixture["expected"]["assignments"][index]
                draft = AssignmentDraft.model_validate({**raw, "deadline": today(settings) + timedelta(days=offset)})
                drafts.append(draft)
            proposal = Proposal(run_id=run.id, summary="Синтетический пример для контроля сроков.", assignments=drafts)
            run.proposal = proposal.model_dump(mode="json")
            run.result = Result(run_id=run.id).model_dump(mode="json")
            session.add(run)
            session.flush()
            items = []
            for draft, done in zip(drafts, (False, False, True)):
                item = Assignment(run_id=run.id, done=done, **draft.model_dump())
                session.add(item)
                items.append(item.id)
            for seq, kind, content, data in [
                (1, "needs_approval", "Подготовлен синтетический пример протокола.", {"proposal": run.proposal}),
                (2, "final", "Синтетический протокол утверждён.", {"docx": f"/api/runs/{run.id}/protocol.docx", "pdf": f"/api/runs/{run.id}/protocol.pdf", "assignments": items}),
            ]:
                event = StepEvent(run_id=run.id, seq=seq, type=kind, agent="secretary", content=content, data=data)
                session.add(Step(run_id=run.id, seq=seq, payload=event.model_dump(mode="json")))
        session.add(Cache(key="system:history-seeded", value={"synthetic": True}))
        session.commit()
