import json
import logging
from typing import Any

from app.core.config import (
    CACHE_READ_MULTIPLIER,
    CACHE_WRITE_MULTIPLIER,
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
- Para preguntas que no encajan en catálogo ni en esas 4 políticas fijas (guías de uso, consejos, cuánto material se necesita, historia o contexto del negocio) usa search_knowledge antes de responder.
- NUNCA inventes precios, disponibilidad, políticas, consejos técnicos ni el estado de un pedido. Si la herramienta no devuelve resultados, dilo con honestidad.
- Si search_catalog confirma que un producto que el cliente pidió NO está en el catálogo: (1) llama SIEMPRE a registrar_demanda_no_cubierta con ese producto; (2) dile al cliente con claridad que ese producto no está disponible en el catálogo; (3) ofrécele una alternativa del catálogo SOLO si es genuinamente parecida y sirve para la misma necesidad — si lo único parecido no resuelve lo que pidió, es mejor no ofrecer nada a ofrecer algo que no le sirve; (4) ofrécele la opción de hablar con un asesor. NO llames a escalate_to_human en ese mismo turno por este motivo: solo escala si el cliente acepta esa oferta o lo pide explícitamente.
- Si un producto SÍ está en el catálogo pero search_catalog indica que está agotado (sin stock), dile al cliente que no está disponible en este momento, sugiérele consultar en los próximos días, u ofrécele hablar con un asesor. NUNCA prometas avisarle, notificarle o contactarlo cuando llegue mercancía nueva ("te aviso cuando llegue", "te contactamos cuando haya stock" o equivalentes): el sistema no tiene ninguna forma de hacerlo, así que sería una promesa que el negocio no puede cumplir.
- Cuando tenga sentido, recomienda un producto complementario o una alternativa útil.
- Puedes tomar pedidos con create_order. Antes de llamar la herramienta, confirma explícitamente con el cliente: los productos y cantidades, la dirección de entrega, y el total incluyendo el costo de envío (o que el envío es gratis). create_order NO necesita método de pago ni ningún otro dato: no lo preguntes antes de crear el pedido, eso solo demora la confirmación (si el cliente pregunta cómo puede pagar, usa get_policy con topic "pago"). En cuanto el cliente confirme explícitamente (por ejemplo "sí", "confirmo", "dale", "así está bien"), LLAMA A create_order en ese mismo turno, no sigas preguntando ni pospongas la llamada. NUNCA digas que un pedido quedó confirmado, registrado o creado si no llamaste a create_order y la herramienta devolvió éxito: eso es inventar el estado de un pedido, algo que tienes prohibido.
- Informa la hora estimada de entrega de forma natural y conversacional, nunca en formato técnico o ISO. IMPORTANTE: compara la FECHA de estimated_delivery_at con la fecha de hoy antes de elegir la palabra. Si es el mismo día calendario, di SIEMPRE "hoy" (ej. "te llega hoy alrededor de las 10:20 am"), incluso si la hora es en la mañana — nunca digas solo "mañana" para una entrega que es el mismo día, porque en español "mañana" se lee como "el día siguiente" y sería un dato falso. Si estimated_delivery_at cae en el día calendario siguiente, ahí sí di "mañana" (ej. "te llega mañana a partir de las 9:00 am").
- Si create_order devuelve un error (por ejemplo falta de stock), explícaselo al cliente con honestidad y ofrece una alternativa razonable si aplica; nunca insistas en crear el pedido igual.
- Usa check_order_status cuando el cliente pregunte por el estado o la hora de entrega de su pedido.
- Usa escalate_to_human si el cliente pide hablar con una persona, si detectas frustración clara, o si no puedes resolver la consulta con las otras herramientas.
- Cuando resuelvas la duda del cliente o se concrete una venta, despídete de forma cordial y pregúntale si necesita algo más.
- Frases como "está bien, gracias", "ok gracias", "listo", "perfecto gracias" o similares indican que el cliente quedó conforme, pero NO son una confirmación de que quiere terminar la conversación: ante ellas, no cierres de una vez, confirma explícitamente si necesita algo más.
- Solo llama a close_conversation cuando el cliente confirme explícitamente que no necesita nada adicional (por ejemplo, respondiendo a tu pregunta con "no, eso es todo", "no gracias", "nada más", o despidiéndose claramente después de que ya le preguntaste). Antes de llamar a close_conversation, el mensaje final SIEMPRE debe incluir una despedida formal que agradezca el contacto e invite a volver (por ejemplo, en el sentido de "gracias por contactarte con nosotros, aquí estamos para atenderte con el mayor de los gustos"), adaptada al tono de marca — nunca cierres en seco. NUNCA llames close_conversation sin haberte despedido antes y haber preguntado explícitamente si necesita algo más.
- Regla transversal: nunca actúes en silencio. Cada vez que llames a escalate_to_human o a close_conversation, tu respuesta en ESE MISMO turno (junto con el bloque de uso de la herramienta, no en un turno posterior) debe incluir SIEMPRE un texto dirigido al cliente que le diga explícitamente que su conversación pasó a un humano o que se cerró. Nunca llames a estas dos herramientas sin acompañarlas de texto: una respuesta vacía o solo con la herramienta, sin decirle nada al cliente, está PROHIBIDA; el cliente nunca debe quedarse sin saber qué pasó."""


def _build_system_prompt(tone_prompt: str) -> list[dict[str, Any]]:
    """Se manda como lista de bloques (no string plano) para poder poner
    cache_control en el ULTIMO bloque: el orden de renderizado de la API es
    tools -> system -> messages, asi que un breakpoint ahi cachea las
    TOOL_DEFINITIONS y el system prompt juntos en un solo prefijo. Nunca debe
    interpolarse aqui nada que cambie por sesion/turno (session_id, timestamps,
    etc.) o se invalida el cache en cada request; tone_prompt es estable
    (mono-negocio, cacheado via repository.get_business())."""
    text = f"{BASE_INSTRUCTIONS}\n\n## Tono de marca\n{tone_prompt}"
    return [
        {
            "type": "text",
            "text": text,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _text_from(response: Any) -> str:
    return "\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()


def _run_tool_loop(
    system_prompt: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    business_id: str,
    session_id: str,
) -> tuple[str | None, int, int, int, int]:
    """Devuelve (respuesta final o None si se agoto el limite de iteraciones,
    input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens),
    los ultimos 4 acumulados sumando el usage de TODAS las llamadas a Claude
    hechas en este turno (la inicial mas cada iteracion por tool use).
    input_tokens NO incluye los tokens de cache (creation/read): la API los
    reporta aparte en response.usage, cada uno con su propio precio."""
    client = get_claude_client()
    total_input_tokens = 0
    total_output_tokens = 0
    total_cache_creation_tokens = 0
    total_cache_read_tokens = 0

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
        total_cache_creation_tokens += response.usage.cache_creation_input_tokens or 0
        total_cache_read_tokens += response.usage.cache_read_input_tokens or 0

        if response.stop_reason != "tool_use":
            return (
                _text_from(response),
                total_input_tokens,
                total_output_tokens,
                total_cache_creation_tokens,
                total_cache_read_tokens,
            )

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

    return None, total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens


def handle_message(
    session_id: str | None,
    user_identifier: str,
    user_message: str,
) -> dict[str, Any]:
    business = repository.get_business()
    business_id = business["id"]

    if session_id is None:
        session_id = repository.create_session(business_id, user_identifier)["id"]
        session_status = "active"
    else:
        session = repository.get_session(session_id)
        session_status = session["status"] if session else "active"
        # 'closed' y 'abandoned' se tratan como el arranque de una conversacion
        # nueva: son igual de terminales (ver comentario en updateHandoffControls
        # de admin.js), no se reabre la sesion vieja, se crea otra desde cero.
        if session_status in ("closed", "abandoned"):
            session_id = repository.create_session(business_id, user_identifier)["id"]
            session_status = "active"

    repository.log_message(session_id, role="user", content=user_message)

    # Handoff a humano: si la sesion esta en cola ('escalated') o ya la tomo un
    # humano ('assigned'), el bot se calla por completo. El mensaje del cliente
    # ya quedo registrado arriba (trazabilidad intacta), pero no se llama a
    # Claude ni se genera respuesta del bot; reply=None le indica al frontend
    # que no hay burbuja de asistente que mostrar para este turno.
    if session_status in ("escalated", "assigned"):
        return {"session_id": session_id, "reply": None, "status": session_status}

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
        reply, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens = _run_tool_loop(
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

    # total_tokens incluye los de cache (creation + read): son tokens reales
    # procesados por el modelo, solo que a un precio distinto al input normal.
    total_tokens = input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens
    estimated_cost = (
        input_tokens / 1_000_000 * PRICE_PER_MILLION_INPUT_TOKENS
        + output_tokens / 1_000_000 * PRICE_PER_MILLION_OUTPUT_TOKENS
        + cache_creation_tokens / 1_000_000 * PRICE_PER_MILLION_INPUT_TOKENS * CACHE_WRITE_MULTIPLIER
        + cache_read_tokens / 1_000_000 * PRICE_PER_MILLION_INPUT_TOKENS * CACHE_READ_MULTIPLIER
    )
    repository.log_token_usage(
        session_id,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost,
        cache_creation_tokens,
        cache_read_tokens,
    )

    repository.log_message(session_id, role="assistant", content=reply)

    session = repository.get_session(session_id)
    return {
        "session_id": session_id,
        "reply": reply,
        "status": session["status"] if session else "active",
    }
