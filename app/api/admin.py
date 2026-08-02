from fastapi import APIRouter, HTTPException, Query

from app.infrastructure import repository

router = APIRouter(prefix="/admin")

VALID_STATUSES = {"active", "escalated", "closed"}


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
