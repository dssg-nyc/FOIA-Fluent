from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatContext(BaseModel):
    page: str = ""  # "draft", "request_detail", "hub", "insights", "states"
    request_id: str | None = None
    draft_data: dict | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: ChatContext = ChatContext()
