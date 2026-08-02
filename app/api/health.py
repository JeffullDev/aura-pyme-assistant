from fastapi import APIRouter, HTTPException

from app.infrastructure.supabase_client import get_supabase_client

router = APIRouter()


@router.get("/health")
def health_check():
    try:
        client = get_supabase_client()
        client.table("business").select("id").limit(1).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Supabase unreachable: {exc}")

    return {"status": "ok", "supabase": "connected"}
