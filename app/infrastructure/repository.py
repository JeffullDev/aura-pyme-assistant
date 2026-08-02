import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from app.infrastructure.supabase_client import get_supabase_client

HISTORY_ROLES = ("user", "assistant", "agent")

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


def search_knowledge_base(
    business_id: str,
    query: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Busqueda ILIKE sobre title/content, mismo enfoque que search_catalog: se
    prefiere recall sobre precision para contenido narrativo (guias, consejos)."""
    terms = _search_terms(query)
    if not terms:
        return []

    conditions = ",".join(
        f"{field}.ilike.%{term}%" for term in terms for field in ("title", "content")
    )

    return (
        get_supabase_client()
        .table("knowledge_base")
        .select("title, content")
        .eq("business_id", business_id)
        .or_(conditions)
        .limit(limit)
        .execute()
        .data
    )


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


def take_session(session_id: str, agent_name: str) -> dict[str, Any]:
    result = (
        get_supabase_client()
        .table("chat_session")
        .update(
            {
                "status": "assigned",
                "assigned_agent_name": agent_name,
                "assigned_at": datetime.utcnow().isoformat(),
            }
        )
        .eq("id", session_id)
        .execute()
    )
    return result.data[0]


def return_session_to_bot(session_id: str) -> dict[str, Any]:
    result = (
        get_supabase_client()
        .table("chat_session")
        .update({"status": "active", "assigned_agent_name": None, "assigned_at": None})
        .eq("id", session_id)
        .execute()
    )
    return result.data[0]


def close_session(session_id: str) -> dict[str, Any]:
    """Usada tanto por el boton 'Cerrar' del panel de admin como por la tool
    close_conversation del agente: mismo efecto en ambos casos, status +
    ended_at."""
    result = (
        get_supabase_client()
        .table("chat_session")
        .update({"status": "closed", "ended_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", session_id)
        .execute()
    )
    return result.data[0]


INACTIVITY_CLOSE_HOURS = 12


def _auto_close_stale_sessions(business_id: str) -> None:
    """Auto-cierre por inactividad, sin scheduler: se corre de forma perezosa
    cada vez que se listan las sesiones desde el panel de admin (list_sessions).
    Una sesion 'active' sin mensajes nuevos en mas de 12 horas se considera
    abandonada por el cliente y se cierra."""
    active_sessions = (
        get_supabase_client()
        .table("chat_session")
        .select("id")
        .eq("business_id", business_id)
        .eq("status", "active")
        .execute()
        .data
    )
    if not active_sessions:
        return

    session_ids = [session["id"] for session in active_sessions]
    rows = (
        get_supabase_client()
        .table("message_log")
        .select("session_id, created_at")
        .in_("session_id", session_ids)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    # order(desc) + setdefault: la primera fila vista por sesion es la mas reciente.
    last_message_at: dict[str, str] = {}
    for row in rows:
        last_message_at.setdefault(row["session_id"], row["created_at"])

    cutoff = datetime.now(timezone.utc) - timedelta(hours=INACTIVITY_CLOSE_HOURS)
    stale_ids = [
        session_id
        for session_id, last_at in last_message_at.items()
        if datetime.fromisoformat(last_at) < cutoff
    ]
    if stale_ids:
        get_supabase_client().table("chat_session").update(
            {"status": "closed", "ended_at": datetime.now(timezone.utc).isoformat()}
        ).in_("id", stale_ids).execute()


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


def list_sessions(business_id: str, status: str | None = None) -> list[dict[str, Any]]:
    _auto_close_stale_sessions(business_id)
    request = (
        get_supabase_client()
        .table("chat_session")
        .select("id, user_identifier, status, started_at, ended_at")
        .eq("business_id", business_id)
        .order("started_at", desc=True)
    )
    if status:
        request = request.eq("status", status)
    sessions = request.execute().data
    if not sessions:
        return []

    # Una sola query extra para contar mensajes por sesion en vez de N+1.
    session_ids = [session["id"] for session in sessions]
    rows = (
        get_supabase_client()
        .table("message_log")
        .select("session_id")
        .in_("session_id", session_ids)
        .execute()
        .data
    )
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["session_id"]] = counts.get(row["session_id"], 0) + 1

    token_totals = _token_totals_by_session(session_ids)

    for session in sessions:
        session["message_count"] = counts.get(session["id"], 0)
        totals = token_totals.get(session["id"], {"total_tokens": 0, "estimated_cost": 0.0})
        session["total_tokens"] = totals["total_tokens"]
        session["estimated_cost"] = totals["estimated_cost"]
    return sessions


def _token_totals_by_session(session_ids: list[str]) -> dict[str, dict[str, Any]]:
    rows = (
        get_supabase_client()
        .table("token_usage")
        .select("session_id, total_tokens, estimated_cost")
        .in_("session_id", session_ids)
        .execute()
        .data
    )
    totals: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = totals.setdefault(row["session_id"], {"total_tokens": 0, "estimated_cost": 0.0})
        entry["total_tokens"] += row["total_tokens"]
        entry["estimated_cost"] += row["estimated_cost"]
    return totals


def log_token_usage(
    session_id: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    estimated_cost: float,
) -> None:
    (
        get_supabase_client()
        .table("token_usage")
        .insert(
            {
                "session_id": session_id,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "estimated_cost": estimated_cost,
            }
        )
        .execute()
    )


def _count_escalated_sessions(session_ids: list[str]) -> int:
    """Cuenta sesiones que en algun momento llamaron a escalate_to_human, via el
    log permanente de la tool call en message_log (role='tool', tool_name=
    'escalate_to_human'). chat_session.status NO sirve como fuente historica:
    se sobreescribe con el tiempo (escalated -> assigned -> closed), asi que una
    conversacion cerrada despues de escalar ya no muestra rastro en su status."""
    if not session_ids:
        return 0
    rows = (
        get_supabase_client()
        .table("message_log")
        .select("session_id")
        .in_("session_id", session_ids)
        .eq("tool_name", "escalate_to_human")
        .execute()
        .data
    )
    return len({row["session_id"] for row in rows})


def _classify_conversations(session_ids: list[str]) -> dict[str, int]:
    """Categoria derivada de las tools llamadas en cada sesion, via message_log
    (SIN llamadas extra al modelo). Precedencia exacta: si llamo create_order ->
    'venta'; si no y llamo escalate_to_human -> 'escalada'; si no y llamo
    get_policy con topic='garantia' -> 'garantia'; si no -> 'consulta'."""
    if not session_ids:
        return {}

    rows = (
        get_supabase_client()
        .table("message_log")
        .select("session_id, tool_name, tool_input")
        .in_("session_id", session_ids)
        .in_("tool_name", ["create_order", "escalate_to_human", "get_policy"])
        .execute()
        .data
    )

    created_order: set[str] = set()
    escalated: set[str] = set()
    warranty: set[str] = set()
    for row in rows:
        sid = row["session_id"]
        if row["tool_name"] == "create_order":
            created_order.add(sid)
        elif row["tool_name"] == "escalate_to_human":
            escalated.add(sid)
        elif row["tool_name"] == "get_policy" and (row.get("tool_input") or {}).get("topic") == "garantia":
            warranty.add(sid)

    counts: dict[str, int] = {}
    for session_id in session_ids:
        if session_id in created_order:
            category = "venta"
        elif session_id in escalated:
            category = "escalada"
        elif session_id in warranty:
            category = "garantia"
        else:
            category = "consulta"
        counts[category] = counts.get(category, 0) + 1
    return counts


def get_uncovered_demand(business_id: str, limit: int = 10) -> list[dict[str, Any]]:
    """Demanda no cubierta: terminos que los clientes buscaron con search_catalog
    y no encontraron nada. Se recorre message_log (la tool ya quedo registrada
    con su tool_output original, que trae `count`) -- sin llamadas extra al
    modelo ni tocar el catalogo. Top N por frecuencia, con la fecha del ultimo
    intento."""
    sessions = (
        get_supabase_client()
        .table("chat_session")
        .select("id")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    session_ids = [session["id"] for session in sessions]
    if not session_ids:
        return []

    rows = (
        get_supabase_client()
        .table("message_log")
        .select("tool_input, tool_output, created_at")
        .in_("session_id", session_ids)
        .eq("tool_name", "search_catalog")
        .execute()
        .data
    )

    counts: dict[str, int] = {}
    last_asked: dict[str, datetime] = {}
    for row in rows:
        tool_output = row.get("tool_output") or {}
        # Solo terminos que devolvieron CERO resultados (count ausente o
        # distinto de 0 no cuenta como demanda no cubierta).
        if tool_output.get("count") != 0:
            continue
        term = str((row.get("tool_input") or {}).get("query", "")).strip().lower()
        if not term:
            continue
        counts[term] = counts.get(term, 0) + 1
        created_at = datetime.fromisoformat(row["created_at"])
        if term not in last_asked or created_at > last_asked[term]:
            last_asked[term] = created_at

    ranked = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:limit]
    return [
        {"term": term, "count": count, "last_asked_at": last_asked[term].isoformat()}
        for term, count in ranked
    ]


def get_business_stats(business_id: str) -> dict[str, Any]:
    sessions = (
        get_supabase_client()
        .table("chat_session")
        .select("id")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    total_conversations = len(sessions)
    session_ids = [session["id"] for session in sessions]

    token_totals = _token_totals_by_session(session_ids) if session_ids else {}
    total_tokens = sum(entry["total_tokens"] for entry in token_totals.values())
    total_estimated_cost = sum(entry["estimated_cost"] for entry in token_totals.values())

    # El promedio se calcula solo sobre sesiones con al menos un registro en
    # token_usage: conversaciones anteriores a la migracion nunca pudieron
    # generar tokens y diluirian el promedio si se dividiera por total_conversations.
    sessions_with_usage = len(token_totals)
    avg_tokens_per_conversation = (
        total_tokens / sessions_with_usage if sessions_with_usage else 0.0
    )

    escalated_conversations = _count_escalated_sessions(session_ids)
    conversations_by_category = _classify_conversations(session_ids)

    orders = (
        get_supabase_client()
        .table("orders")
        .select("status, total")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    total_orders = len(orders)
    orders_by_status: dict[str, int] = {}
    for order in orders:
        orders_by_status[order["status"]] = orders_by_status.get(order["status"], 0) + 1

    # Un pedido cancelado nunca se cobro: no cuenta como ingreso ni entra al
    # ticket promedio, pero si cuenta para total_orders/conversion_rate (el
    # chat si convirtio en una intencion de compra, aunque luego se cancelara).
    non_cancelled_orders = [order for order in orders if order["status"] != "cancelled"]
    revenue_total = sum(float(order["total"]) for order in non_cancelled_orders)
    avg_ticket = revenue_total / len(non_cancelled_orders) if non_cancelled_orders else 0.0
    conversion_rate = (
        (total_orders / total_conversations * 100) if total_conversations else 0.0
    )

    return {
        "total_conversations": total_conversations,
        "escalated_conversations": escalated_conversations,
        "conversations_by_category": conversations_by_category,
        "total_tokens": total_tokens,
        "total_estimated_cost": total_estimated_cost,
        "avg_tokens_per_conversation": avg_tokens_per_conversation,
        "total_orders": total_orders,
        "orders_by_status": orders_by_status,
        "revenue_total": revenue_total,
        "avg_ticket": avg_ticket,
        "conversion_rate": conversion_rate,
    }


def get_messages(session_id: str) -> list[dict[str, Any]]:
    result = (
        get_supabase_client()
        .table("message_log")
        .select("role, content, tool_name, tool_input, tool_output, created_at")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )
    return result.data


def get_messages_since(session_id: str, since: str | None) -> list[dict[str, Any]]:
    """Para el polling publico del cliente: solo roles visibles de cara al
    cliente (user/assistant/agent), nunca 'tool' (son internos, se ven solo en
    el panel de admin). `tool_name` se reutiliza en filas role='agent' para
    llevar el nombre del asesor que escribio ese mensaje (ver reply_to_session
    en app/api/admin.py); en las demas filas siempre viene null."""
    request = (
        get_supabase_client()
        .table("message_log")
        .select("role, content, tool_name, created_at")
        .eq("session_id", session_id)
        .in_("role", ["user", "assistant", "agent"])
        .order("created_at")
    )
    if since:
        request = request.gt("created_at", since)
    return request.execute().data


def get_history(session_id: str) -> list[dict[str, str]]:
    """Turnos user/assistant/agent en texto plano, para reconstruir el historial
    que se manda a Claude. Las filas role='tool' quedan en la tabla para
    trazabilidad, pero no se reenvian a Claude en el siguiente turno. Los
    mensajes 'agent' (humano respondiendo desde el panel) se remapean a
    'assistant': la API de Claude solo conoce los roles user/assistant, y si la
    conversacion vuelve al bot este necesita ver lo que dijo el humano como si
    fuera su propio turno anterior."""
    result = (
        get_supabase_client()
        .table("message_log")
        .select("role, content")
        .eq("session_id", session_id)
        .in_("role", list(HISTORY_ROLES))
        .order("created_at")
        .execute()
    )
    return [
        {"role": "assistant" if row["role"] == "agent" else row["role"], "content": row["content"]}
        for row in result.data
        if row.get("content")
    ]


def find_catalog_item_for_order(business_id: str, product_name: str) -> dict[str, Any] | None:
    """Mismo enfoque ILIKE que search_catalog, pero solo sobre `name` (no
    description) y trayendo `id`/`stock` crudos: create_order necesita el id
    para el FK de order_items y el stock exacto para validar/descontar."""
    terms = _search_terms(product_name)
    if not terms:
        return None

    conditions = ",".join(f"name.ilike.%{term}%" for term in terms)
    result = (
        get_supabase_client()
        .table("catalog_item")
        .select("id, name, price, stock, category, cost_price")
        .eq("business_id", business_id)
        .or_(conditions)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def update_catalog_stock(catalog_item_id: str, new_stock: int) -> None:
    (
        get_supabase_client()
        .table("catalog_item")
        .update({"stock": new_stock})
        .eq("id", catalog_item_id)
        .execute()
    )


def insert_order(
    business_id: str,
    session_id: str,
    user_identifier: str,
    customer_name: str,
    delivery_address: str,
    subtotal: float,
    shipping_cost: float,
    total: float,
    estimated_delivery_at: datetime,
) -> dict[str, Any]:
    result = (
        get_supabase_client()
        .table("orders")
        .insert(
            {
                "business_id": business_id,
                "session_id": session_id,
                "user_identifier": user_identifier,
                "customer_name": customer_name,
                "delivery_address": delivery_address,
                "subtotal": subtotal,
                "shipping_cost": shipping_cost,
                "total": total,
                # estimated_delivery_at es `timestamp` (sin zona horaria): se manda
                # el wall-clock de America/Bogota sin offset. Si se mandara con
                # offset, Postgres la reinterpretaria en la timezone de la sesion
                # (UTC) y desfasaria la hora real de entrega.
                "estimated_delivery_at": estimated_delivery_at.replace(tzinfo=None).isoformat(),
            }
        )
        .execute()
    )
    return result.data[0]


def insert_order_items(rows: list[dict[str, Any]]) -> None:
    get_supabase_client().table("order_items").insert(rows).execute()


def find_order_by_reference(business_id: str, reference: str) -> dict[str, Any] | None:
    """El `order_reference` que ve el cliente son los primeros 8 caracteres del
    UUID. Se trae el set de orders del negocio y se compara en Python: para el
    volumen de este MVP es mas simple y robusto que castear uuid a texto en el
    filtro de PostgREST."""
    orders = (
        get_supabase_client()
        .table("orders")
        .select("*")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    reference_lower = reference.strip().lower()
    for order in orders:
        if str(order["id"]).lower().startswith(reference_lower):
            return order
    return None


def get_recent_orders(business_id: str, user_identifier: str, limit: int = 5) -> list[dict[str, Any]]:
    return (
        get_supabase_client()
        .table("orders")
        .select("*")
        .eq("business_id", business_id)
        .eq("user_identifier", user_identifier)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )


def get_order_items(order_id: str) -> list[dict[str, Any]]:
    return (
        get_supabase_client()
        .table("order_items")
        .select("product_name, quantity, unit_price, subtotal")
        .eq("order_id", order_id)
        .execute()
        .data
    )


def list_orders(business_id: str, status: str | None = None) -> list[dict[str, Any]]:
    """Panel de admin: pedidos con sus items, mismo patron anti-N+1 que
    list_sessions (una query de orders + una batched de order_items por in_())."""
    request = (
        get_supabase_client()
        .table("orders")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
    )
    if status:
        request = request.eq("status", status)
    orders = request.execute().data
    if not orders:
        return []

    order_ids = [order["id"] for order in orders]
    items_rows = (
        get_supabase_client()
        .table("order_items")
        .select("order_id, product_name, quantity, unit_price, subtotal")
        .in_("order_id", order_ids)
        .execute()
        .data
    )
    items_by_order: dict[str, list[dict[str, Any]]] = {}
    for row in items_rows:
        items_by_order.setdefault(row["order_id"], []).append(row)

    for order in orders:
        order["items"] = items_by_order.get(order["id"], [])
    return orders


def get_order(order_id: str) -> dict[str, Any] | None:
    result = (
        get_supabase_client()
        .table("orders")
        .select("*")
        .eq("id", order_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def update_order_status(order_id: str, status: str) -> dict[str, Any]:
    result = (
        get_supabase_client()
        .table("orders")
        .update({"status": status})
        .eq("id", order_id)
        .execute()
    )
    return result.data[0]


def list_catalog(business_id: str) -> list[dict[str, Any]]:
    """Catalogo completo del panel de admin, con el stock numerico REAL. A
    diferencia de search_catalog (que alimenta al agente de cara al cliente y
    cuyo resultado eventualmente se enmascara via stock_status en tools.py),
    esta funcion es exclusiva del dueno viendo su propio inventario y nunca
    debe enmascarar el numero de stock."""
    return (
        get_supabase_client()
        .table("catalog_item")
        .select("id, name, description, price, stock, category")
        .eq("business_id", business_id)
        .order("name")
        .execute()
        .data
    )
