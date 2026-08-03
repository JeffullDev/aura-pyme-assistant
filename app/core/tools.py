from typing import Any

from app.core import orders as orders_service
from app.core.catalog import stock_status
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
        "name": "search_knowledge",
        "description": (
            "Busca en la base de conocimiento del negocio (guias de uso, consejos, "
            "historia, contexto de marca) por palabra clave. Usala para preguntas "
            "que no encajan en catalogo ni en politicas fijas de horario/domicilios/"
            "garantia/pago, por ejemplo 'como elijo un taladro' o 'cuanto cemento "
            "necesito'. Si no encuentra nada relevante, dilo con honestidad en vez "
            "de inventar la respuesta."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Palabra clave o pregunta a buscar en la base de conocimiento.",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "create_order",
        "description": (
            "Registra un pedido del cliente. IMPORTANTE: antes de llamar esta "
            "herramienta DEBES haber confirmado explícitamente con el cliente los "
            "productos, las cantidades, la dirección de entrega y haberle dado el "
            "total con el costo de envío. Nunca crees un pedido sin confirmación "
            "explícita del cliente."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "Productos del pedido.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "product_name": {
                                "type": "string",
                                "description": "Nombre del producto, tal como aparece en el catálogo.",
                            },
                            "quantity": {
                                "type": "integer",
                                "description": "Cantidad de unidades.",
                            },
                        },
                        "required": ["product_name", "quantity"],
                    },
                },
                "customer_name": {
                    "type": "string",
                    "description": "Nombre del cliente que recibe el pedido.",
                },
                "delivery_address": {
                    "type": "string",
                    "description": "Dirección de entrega confirmada por el cliente.",
                },
            },
            "required": ["items", "customer_name", "delivery_address"],
        },
    },
    {
        "name": "check_order_status",
        "description": (
            "Consulta el estado y la hora estimada de entrega de los pedidos del "
            "cliente. Úsala cuando pregunte por su pedido o por su envío."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "order_reference": {
                    "type": "string",
                    "description": (
                        "Referencia del pedido (8 caracteres). Si el cliente no la "
                        "tiene, omite este campo y se devolverán sus pedidos recientes."
                    ),
                }
            },
            "required": [],
        },
    },
    {
        "name": "registrar_demanda_no_cubierta",
        "description": (
            "Registra un producto que el cliente pidió y que confirmaste que NO "
            "está en el catálogo (después de usar search_catalog). Úsala SIEMPRE "
            "antes de ofrecer una alternativa o escalar por falta de stock: así "
            "el negocio sabe qué demanda está perdiendo."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "producto": {
                    "type": "string",
                    "description": "Nombre del producto que el cliente pidió y no tenemos.",
                }
            },
            "required": ["producto"],
        },
    },
    {
        "name": "escalate_to_human",
        "description": (
            "Marca la conversación para que la atienda un humano. Úsala cuando el "
            "cliente lo pida explícitamente, cuando no puedas resolver su consulta "
            "después de intentarlo con las otras herramientas, o cuando detectes "
            "frustración clara. En la MISMA respuesta en la que llamas esta "
            "herramienta incluye siempre un texto para el cliente avisándole que "
            "su conversación pasó a un asesor: nunca la llames sin texto."
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
    {
        "name": "close_conversation",
        "description": (
            "Cierra la conversación cuando el cliente confirma explícitamente que "
            "ya no necesita nada más, después de que le preguntaste. Ojo: 'está "
            "bien gracias', 'ok gracias' o 'listo' por sí solos NO son esa "
            "confirmación (son solo señal de que quedó conforme); solo cierra "
            "cuando responda que no a tu pregunta de si necesita algo más. En la "
            "MISMA respuesta en la que llamas esta herramienta incluye siempre un "
            "texto de despedida formal que agradezca el contacto e invite a "
            "volver: nunca la llames sin texto ni cierres en seco."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Motivo o resumen breve de por qué se cierra la conversación.",
                }
            },
            "required": ["reason"],
        },
    },
]


def _sanitize_catalog_item(item: dict[str, Any]) -> dict[str, Any]:
    """El numero crudo de stock es informacion interna: nunca debe llegar a Claude."""
    return {
        "name": item.get("name"),
        "description": item.get("description"),
        "price": item.get("price"),
        "category": item.get("category"),
        "stock_status": stock_status(item.get("stock") or 0),
    }


KNOWLEDGE_CONTENT_MAX_CHARS = 800


def _truncate_knowledge_content(content: str) -> str:
    if len(content) <= KNOWLEDGE_CONTENT_MAX_CHARS:
        return content
    return content[:KNOWLEDGE_CONTENT_MAX_CHARS].rstrip() + "..."


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

    if name == "search_knowledge":
        results = repository.search_knowledge_base(
            business_id, query=tool_input.get("query", "")
        )
        sanitized = [
            {"title": item["title"], "content": _truncate_knowledge_content(item["content"])}
            for item in results
        ]
        return {"results": sanitized, "count": len(sanitized)}

    if name == "create_order":
        business = repository.get_business()
        session = repository.get_session(session_id)
        user_identifier = session["user_identifier"] if session else ""
        return orders_service.create_order(
            business=business,
            session_id=session_id,
            user_identifier=user_identifier,
            items=tool_input.get("items", []),
            customer_name=tool_input.get("customer_name", ""),
            delivery_address=tool_input.get("delivery_address", ""),
        )

    if name == "check_order_status":
        business = repository.get_business()
        session = repository.get_session(session_id)
        user_identifier = session["user_identifier"] if session else ""
        return orders_service.get_order_status(
            business=business,
            user_identifier=user_identifier,
            order_reference=tool_input.get("order_reference"),
        )

    if name == "registrar_demanda_no_cubierta":
        producto = str(tool_input.get("producto", "")).strip()
        if not producto:
            return {"registered": False, "error": "Falta el nombre del producto."}
        repository.log_unmet_demand(business_id, session_id, producto)
        return {"registered": True, "producto": producto}

    if name == "escalate_to_human":
        repository.escalate_session(session_id)
        return {"escalated": True, "reason": tool_input.get("reason", "")}

    if name == "close_conversation":
        repository.close_session(session_id)
        return {"closed": True, "reason": tool_input.get("reason", "")}

    return {"error": f"Herramienta desconocida: {name}"}
