import json
import logging
from typing import Any

from app.core.config import (
    PRICE_PER_MILLION_INPUT_TOKENS,
    PRICE_PER_MILLION_OUTPUT_TOKENS,
    settings,
)
from app.core.tools import TOOL_DEFINITIONS, execute_tool
from app.infrastructure import repository
from app.infrastructure.claude_client import get_claude_client

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 5
MAX_TOKENS = 1024

TECHNICAL_FAILURE_REPLY = (
    "Lo siento, en este momento estoy experimentando dificultades técnicas. "
    "Por favor, intenta de nuevo en unos minutos."
)
LOOP_EXHAUSTED_REPLY = (
    "Disculpa, no logré resolver tu consulta por este medio. Ya marqué la "
    "conversación para que un miembro del equipo te contacte y te ayude."
)
EMPTY_MESSAGE_REPLY = (
    "Hola! Parece que tu mensaje llegó vacío. ¿En qué puedo ayudarte? Contame qué "
    "producto o información estás buscando."
)

BASE_INSTRUCTIONS = """Eres el asistente de atención al cliente de este negocio y atiendes por chat.

Reglas:
- Responde SIEMPRE en español.
- Sé breve: es un chat tipo WhatsApp, no un correo. Evita listas largas.
- NUNCA uses Markdown: nada de **negritas**, nada de listas numeradas o con guiones, nada de encabezados con #. Escribe texto plano, como un mensaje real de WhatsApp. Si necesitas listar productos, hazlo en oraciones normales o con saltos de línea simples, sin símbolos de formato.
- Para CUALQUIER dato de catálogo (precios, stock, características) usa search_catalog antes de responder.
- Para CUALQUIER dato de políticas (horario, domicilios, garantía, pago) usa get_policy antes de responder.
- NUNCA inventes precios, disponibilidad ni políticas. Si la herramienta no devuelve resultados, dilo con honestidad.
- Cuando tenga sentido, recomienda un producto complementario o una alternativa útil.
- Usa escalate_to_human si el cliente pide hablar con una persona, si detectas frustración clara, o si no puedes resolver la consulta con las otras herramientas. Al escalar, avísale al cliente que alguien del equipo lo contactará."""


def _build_system_prompt(tone_prompt: str) -> str:
    return f"{BASE_INSTRUCTIONS}\n\n## Tono de marca\n{tone_prompt}"


def _text_from(response: Any) -> str:
    return "\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()


def _run_tool_loop(
    system_prompt: str,
    messages: list[dict[str, Any]],
    business_id: str,
    session_id: str,
) -> tuple[str | None, int, int]:
    """Devuelve (respuesta final o None si se agoto el limite de iteraciones,
    input_tokens acumulados, output_tokens acumulados) sumando el usage de TODAS
    las llamadas a Claude hechas en este turno (la inicial mas cada iteracion por
    tool use)."""
    client = get_claude_client()
    total_input_tokens = 0
    total_output_tokens = 0

    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.messages.create(
            model=settings.claude_model,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )
        total_input_tokens += response.usage.input_tokens
        total_output_tokens += response.usage.output_tokens

        if response.stop_reason != "tool_use":
            return _text_from(response), total_input_tokens, total_output_tokens

        # Dentro del loop sí se usan bloques tool_use/tool_result: la API los exige
        # para cerrar el ciclo. Lo que no se replica es el historial de turnos previos.
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            output = execute_tool(block.name, block.input, business_id, session_id)
            repository.log_message(
                session_id,
                role="tool",
                tool_name=block.name,
                tool_input=block.input,
                tool_output=output,
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(output, ensure_ascii=False, default=str),
                }
            )

        messages.append({"role": "user", "content": tool_results})

    return None, total_input_tokens, total_output_tokens


def handle_message(
    session_id: str | None,
    user_identifier: str,
    user_message: str,
) -> dict[str, str]:
    business = repository.get_business()
    business_id = business["id"]

    if session_id is None:
        session_id = repository.create_session(business_id, user_identifier)["id"]

    repository.log_message(session_id, role="user", content=user_message)

    # Un mensaje vacio/solo-espacios nunca llega a Claude: get_history() descarta
    # contenido vacio al reconstruir el historial (filtro `if row.get("content")`),
    # asi que la lista de mensajes quedaria vacia y la API rechaza la llamada con
    # "messages: at least one message is required". Se corta antes de intentarlo.
    if not user_message.strip():
        reply = EMPTY_MESSAGE_REPLY
        repository.log_message(session_id, role="assistant", content=reply)
        session = repository.get_session(session_id)
        return {
            "session_id": session_id,
            "reply": reply,
            "status": session["status"] if session else "active",
        }

    # El historial ya incluye el mensaje recién registrado.
    messages: list[dict[str, Any]] = [
        {"role": row["role"], "content": row["content"]}
        for row in repository.get_history(session_id)
    ]

    try:
        reply, input_tokens, output_tokens = _run_tool_loop(
            _build_system_prompt(business["tone_prompt"]),
            messages,
            business_id,
            session_id,
        )
    except Exception:
        logger.exception("Fallo la llamada a Claude en la sesion %s", session_id)
        # El texto de error no se registra en message_log: ensuciaría el historial
        # que se reenvía en el siguiente turno. El detalle queda en el log del server.
        session = repository.get_session(session_id)
        return {
            "session_id": session_id,
            "reply": TECHNICAL_FAILURE_REPLY,
            "status": session["status"] if session else "active",
        }

    if reply is None:
        logger.warning(
            "Limite de %s iteraciones alcanzado en la sesion %s; escalando.",
            MAX_TOOL_ITERATIONS,
            session_id,
        )
        repository.escalate_session(session_id)
        reply = LOOP_EXHAUSTED_REPLY

    total_tokens = input_tokens + output_tokens
    estimated_cost = (
        input_tokens / 1_000_000 * PRICE_PER_MILLION_INPUT_TOKENS
        + output_tokens / 1_000_000 * PRICE_PER_MILLION_OUTPUT_TOKENS
    )
    repository.log_token_usage(
        session_id, input_tokens, output_tokens, total_tokens, estimated_cost
    )

    repository.log_message(session_id, role="assistant", content=reply)

    session = repository.get_session(session_id)
    return {
        "session_id": session_id,
        "reply": reply,
        "status": session["status"] if session else "active",
    }
