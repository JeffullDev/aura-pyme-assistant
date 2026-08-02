from fastapi import APIRouter
from pydantic import BaseModel

from app.core.agent_service import handle_message

router = APIRouter()


class ChatRequest(BaseModel):
    session_id: str | None = None
    user_identifier: str
    message: str


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    status: str


# Handler sincrono a proposito: supabase-py es bloqueante, y FastAPI despacha los
# handlers `def` a un threadpool en vez de ocupar el event loop.
@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> dict[str, str]:
    return handle_message(
        session_id=request.session_id,
        user_identifier=request.user_identifier,
        user_message=request.message,
    )
