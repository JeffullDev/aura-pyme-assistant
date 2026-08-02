from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.infrastructure import repository

router = APIRouter(prefix="/admin")

VALID_STATUSES = {"active", "escalated", "assigned", "closed"}

# pending -> confirmed -> in_transit -> delivered es la unica progresion lineal;
# cancelled es alcanzable desde cualquier estado no terminal. delivered y
# cancelled son terminales (sin transiciones salientes).
ORDER_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"in_transit", "cancelled"},
    "in_transit": {"delivered", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
}


class TakeRequest(BaseModel):
    agent_name: str


class ReplyRequest(BaseModel):
    message: str


class OrderStatusRequest(BaseModel):
    status: str


@router.get("/sessions")
def list_sessions(status: str | None = Query(default=None)) -> list[dict]:
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"status invalido: {status}")

    business_id = repository.get_business()["id"]
    return repository.list_sessions(business_id, status=status)


@router.get("/sessions/{session_id}/messages")
def session_messages(session_id: str) -> list[dict]:
    if repository.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    return repository.get_messages(session_id)


@router.get("/stats")
def stats() -> dict:
    business_id = repository.get_business()["id"]
    return repository.get_business_stats(business_id)


@router.post("/sessions/{session_id}/take")
def take_session(session_id: str, request: TakeRequest) -> dict:
    session = repository.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    if session["status"] == "assigned" and session.get("assigned_agent_name") != request.agent_name:
        raise HTTPException(
            status_code=409,
            detail=f"Esta sesion ya esta asignada a {session['assigned_agent_name']}",
        )

    return repository.take_session(session_id, request.agent_name)


@router.post("/sessions/{session_id}/reply")
def reply_to_session(session_id: str, request: ReplyRequest) -> dict:
    session = repository.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    if session["status"] != "assigned":
        raise HTTPException(
            status_code=400,
            detail="La sesion debe estar 'assigned' para que un agente responda",
        )

    # tool_name se reutiliza para llevar el nombre del asesor en filas role='agent'
    # (ver comentario en repository.get_messages_since): asi el cliente puede
    # mostrar quien le esta hablando sin agregar una columna nueva.
    repository.log_message(
        session_id,
        role="agent",
        content=request.message,
        tool_name=session.get("assigned_agent_name"),
    )
    return {"status": "ok"}


@router.post("/sessions/{session_id}/return-to-bot")
def return_session_to_bot(session_id: str) -> dict:
    if repository.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    return repository.return_session_to_bot(session_id)


@router.post("/sessions/{session_id}/close")
def close_session(session_id: str) -> dict:
    if repository.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    return repository.close_session(session_id)


@router.get("/orders")
def list_orders(status: str | None = Query(default=None)) -> list[dict]:
    if status is not None and status not in ORDER_STATUS_TRANSITIONS:
        raise HTTPException(status_code=400, detail=f"status invalido: {status}")

    business_id = repository.get_business()["id"]
    return repository.list_orders(business_id, status=status)


@router.post("/orders/{order_id}/status")
def update_order_status(order_id: str, request: OrderStatusRequest) -> dict:
    if request.status not in ORDER_STATUS_TRANSITIONS:
        raise HTTPException(status_code=400, detail=f"status invalido: {request.status}")

    order = repository.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    current_status = order["status"]
    allowed = ORDER_STATUS_TRANSITIONS[current_status]
    if request.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Transicion invalida: {current_status} -> {request.status}",
        )

    return repository.update_order_status(order_id, request.status)


@router.get("/inventory")
def inventory() -> list[dict]:
    # Stock numerico real, sin enmascarar: este endpoint es para el dueno del
    # negocio, no para el agente de cara al cliente (ver repository.list_catalog).
    business_id = repository.get_business()["id"]
    return repository.list_catalog(business_id)
