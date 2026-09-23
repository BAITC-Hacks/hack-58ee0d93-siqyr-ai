"""HTTP request bodies. Agent payloads use the unchanged shared schemas."""
from pydantic import BaseModel, ConfigDict, StrictBool
from backend.shared.schemas import Proposal


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: StrictBool
    comment: str | None = None
    proposal: Proposal | None = None


class AssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    done: StrictBool
