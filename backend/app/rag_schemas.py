"""Chat API schemas. Separate from the meeting/agent wire contract."""
from pydantic import BaseModel, Field


class BrowserSegment(BaseModel):
    id: str = Field(max_length=120)
    speaker: str = Field(default="", max_length=200)
    text: str = Field(max_length=12000)


class BrowserTask(BaseModel):
    title: str = Field(max_length=2000)
    assignee: str = Field(default="", max_length=200)
    deadline_text: str = Field(default="", max_length=200)
    status: str = Field(default="", max_length=40)


class BrowserMeeting(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=250)
    status: str = Field(max_length=40)
    date: str | None = Field(default=None, max_length=40)
    summary: str = Field(default="", max_length=20000)
    transcript: list[BrowserSegment] = Field(default_factory=list, max_length=1000)
    tasks: list[BrowserTask] = Field(default_factory=list, max_length=200)


class BrowserSync(BaseModel):
    meetings: list[BrowserMeeting] = Field(max_length=100)


class ChatAsk(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = Field(default=None, max_length=64)


class ChatConversationCreate(BaseModel):
    title: str = Field(default="Новый чат", min_length=1, max_length=100)


class ChatConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
