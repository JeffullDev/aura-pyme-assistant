from typing import Any

from app.infrastructure import repository

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "search_catalog",
        "description": (
            "Busca productos en el catálogo del negocio por nombre, categoría o "
            "palabra clave. Úsala SIEMPRE antes de responder sobre precios, "
            "disponibilidad o características de productos. Nunca inventes esta "
            "información."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Nombre o palabra clave del producto a buscar.",
                },
                "category": {
                    "type": "string",
                    "description": "Categoría opcional para acotar la búsqueda.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_policy",
        "description": (
            "Obtiene la política oficial del negocio sobre un tema. Úsala SIEMPRE "
            "antes de responder preguntas sobre horario, domicilios, garantía o "
            "pago. Nunca inventes esta información."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "enum": ["horario", "domicilios", "garantia", "pago"],
                    "description": "Tema de la política a consultar.",
                }
            },
            "required": ["topic"],
        },
    },
    {
        "name": "escalate_to_human",
        "description": (
            "Marca la conversación para que la atienda un humano. Úsala cuando el "
            "cliente lo pida explícitamente, cuando no puedas resolver su consulta "
            "después de intentarlo con las otras herramientas, o cuando detectes "
            "frustración clara."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Motivo por el que se escala la conversación.",
                }
            },
            "required": ["reason"],
        },
    },
]


def _stock_status(stock: int) -> str:
    if stock == 0:
        return "Agotado"
    if stock <= 4:
        return "Poco stock"
    if stock <= 9:
        return "Hay stock, pocas unidades"
    return "Hay stock"


def _sanitize_catalog_item(item: dict[str, Any]) -> dict[str, Any]:
    """El numero crudo de stock es informacion interna: nunca debe llegar a Claude."""
    return {
        "name": item.get("name"),
        "description": item.get("description"),
        "price": item.get("price"),
        "category": item.get("category"),
        "stock_status": _stock_status(item.get("stock") or 0),
    }


def execute_tool(
    name: str,
    tool_input: dict[str, Any],
    business_id: str,
    session_id: str,
) -> dict[str, Any]:
    if name == "search_catalog":
        results = repository.search_catalog(
            business_id,
            query=tool_input.get("query", ""),
            category=tool_input.get("category"),
        )
        sanitized = [_sanitize_catalog_item(item) for item in results]
        return {"results": sanitized, "count": len(sanitized)}

    if name == "get_policy":
        policy = repository.get_policy(business_id, tool_input.get("topic", ""))
        if policy is None:
            return {"found": False}
        return {"found": True, **policy}

    if name == "escalate_to_human":
        repository.escalate_session(session_id)
        return {"escalated": True, "reason": tool_input.get("reason", "")}

    return {"error": f"Herramienta desconocida: {name}"}
