from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.agent_service import handle_message
from app.infrastructure import repository

router = APIRouter()


class ChatRequest(BaseModel):
    session_id: str | None = None
    user_identifier: str
    message: str


class ChatResponse(BaseModel):
    session_id: str
    # None cuando la sesion esta 'escalated'/'assigned': el bot esta suprimido
    # y este turno no genera respuesta de la IA.
    reply: str | None
    status: str


# Handler sincrono a proposito: supabase-py es bloqueante, y FastAPI despacha los
# handlers `def` a un threadpool en vez de ocupar el event loop.
@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> dict:
    return handle_message(
        session_id=request.session_id,
        user_identifier=request.user_identifier,
        user_message=request.message,
    )


@router.get("/chat/{session_id}/messages")
def get_chat_messages(session_id: str, since: str | None = Query(default=None)) -> list[dict]:
    """Polling publico para el cliente mientras la conversacion esta en manos
    de un humano: devuelve los mensajes visibles (user/assistant/agent, nunca
    'tool') posteriores a `since`."""
    if repository.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    return repository.get_messages_since(session_id, since)
