import re
from functools import lru_cache
from typing import Any

from app.infrastructure.supabase_client import get_supabase_client

HISTORY_ROLES = ("user", "assistant")

STOPWORDS = {
    "de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas",
    "para", "por", "con", "sin", "que", "y", "o", "al", "en", "tienen", "tiene",
}


@lru_cache
def get_business() -> dict[str, Any]:
    """MVP mono-negocio: hay un solo registro sembrado, se cachea al primer uso."""
    result = get_supabase_client().table("business").select("*").limit(1).execute()
    if not result.data:
        raise RuntimeError("No hay ningun business sembrado. Corre scripts/seed.py.")
    return result.data[0]


def _sanitize_filter_term(term: str) -> str:
    """PostgREST lee , ( ) . como sintaxis dentro de or_(); fuera del termino de busqueda."""
    return re.sub(r"[,().\"']", " ", term).strip()


def _singularize(word: str) -> str:
    """Stemming ingenuo de plurales en espanol. Como el filtro es ILIKE %x%, recortar
    el sufijo solo amplia el match: 'taladros' -> 'taladro' encuentra 'Taladro percutor'."""
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s"):
        return word[:-1]
    return word


def _search_terms(query: str) -> list[str]:
    clean = _sanitize_filter_term(query)
    terms = [
        _singularize(word)
        for word in clean.lower().split()
        if len(word) >= 3 and word not in STOPWORDS
    ]
    # Si todo se filtro (consulta muy corta), cae al termino original.
    return terms or ([clean] if clean else [])


def search_catalog(
    business_id: str,
    query: str,
    category: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    terms = _search_terms(query)
    if not terms:
        return []

    # OR entre todos los terminos: preferimos recall sobre precision, decir "no
    # tenemos" cuando si hay stock es mucho peor que devolver un resultado de mas.
    conditions = ",".join(
        f"{field}.ilike.%{term}%" for term in terms for field in ("name", "description")
    )

    request = (
        get_supabase_client()
        .table("catalog_item")
        .select("name, description, price, stock, category")
        .eq("business_id", business_id)
        .or_(conditions)
    )
    if category:
        request = request.ilike("category", f"%{_sanitize_filter_term(category)}%")

    return request.limit(limit).execute().data


def get_policy(business_id: str, topic: str) -> dict[str, Any] | None:
    result = (
        get_supabase_client()
        .table("policy")
        .select("topic, content")
        .eq("business_id", business_id)
        .eq("topic", topic)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def create_session(business_id: str, user_identifier: str) -> dict[str, Any]:
    result = (
        get_supabase_client()
        .table("chat_session")
        .insert(
            {
                "business_id": business_id,
                "user_identifier": user_identifier,
                "status": "active",
            }
        )
        .execute()
    )
    return result.data[0]


def get_session(session_id: str) -> dict[str, Any] | None:
    result = (
        get_supabase_client()
        .table("chat_session")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def escalate_session(session_id: str) -> None:
    (
        get_supabase_client()
        .table("chat_session")
        .update({"status": "escalated"})
        .eq("id", session_id)
        .execute()
    )


def log_message(
    session_id: str,
    role: str,
    content: str | None = None,
    tool_name: str | None = None,
    tool_input: dict[str, Any] | None = None,
    tool_output: Any = None,
) -> None:
    (
        get_supabase_client()
        .table("message_log")
        .insert(
            {
                "session_id": session_id,
                "role": role,
                "content": content,
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_output": tool_output,
            }
        )
        .execute()
    )


def get_history(session_id: str) -> list[dict[str, str]]:
    """Turnos user/assistant en texto plano. Las filas role='tool' quedan en la
    tabla para trazabilidad, pero no se reenvian a Claude en el siguiente turno."""
    result = (
        get_supabase_client()
        .table("message_log")
        .select("role, content")
        .eq("session_id", session_id)
        .in_("role", list(HISTORY_ROLES))
        .order("created_at")
        .execute()
    )
    return [row for row in result.data if row.get("content")]
