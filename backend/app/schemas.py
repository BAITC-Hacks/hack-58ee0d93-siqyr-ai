"""HTTP request bodies. Agent payloads use the unchanged shared schemas."""
from pydantic import BaseModel, ConfigDict, StrictBool, Field
from backend.shared.schemas import Proposal


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: StrictBool
    comment: str | None = None
    proposal: Proposal | None = None
    expected_revision: int | None = None  # рекомендуется: повтор той же редакции идемпотентен, другая — 409


class ProposalSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int
    proposal: Proposal


class AssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    done: StrictBool


class Login(BaseModel):
    username: str
    password: str


class DepartmentCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,62}$")
    name: str = Field(min_length=1, max_length=200)
    organization_id: str = "default"
    parent_id: str | None = None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    display_name: str = Field(min_length=1, max_length=200)
    password: str | None = None
    is_system_admin: bool = False


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active: StrictBool | None = None
    password: str | None = None


class MembershipCreate(BaseModel):
    user_id: str
    department_id: str
    role: str


class IdentityLink(BaseModel):
    user_id: str
    provider: str
    subject: str = Field(min_length=1, max_length=400)


class EcpSignature(BaseModel):
    challenge_id: str
    cms: str = Field(min_length=1, max_length=100000)
