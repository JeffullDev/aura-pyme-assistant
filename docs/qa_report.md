# Reporte de QA — AURA (El Tornillo Feliz)

Ejecutado con el skill `.claude/skills/aura-qa/SKILL.md` (versión ampliada para
cubrir el producto actual: pedidos, inventario, entregas programadas, handoff
con supresión del bot, base de conocimiento, demanda no cubierta, cierre de
sesión y prompt caching), contra el servidor local real
(`uvicorn app.main:app`, `127.0.0.1:8000`) y la base de datos real en Supabase.
Fecha de ejecución: **2026-08-03**.

Durante esta ejecución se encontraron y corrigieron **3 bugs reales** (Paso 6).
Cada uno se documenta con evidencia de "antes" (falla real observada) y
"después" (fix aplicado + reverificación real). Ningún resultado de este
reporte se marca PASS sin una respuesta real del servidor, una consulta real a
`message_log`/Supabase, o un endpoint real invocado.

## Paso 1 — Regresión de las 4 pruebas originales (`scripts/test_chat.py`)

Corrida contra el servidor con los 3 fixes de esta ejecución ya aplicados:

| # | Cliente | Resultado |
|---|---------|-----------|
| 1 | "Hola, ¿tienen taladros?" | **PASS** — respondió con el taladro real del catálogo, precio y stock disponible, sin exponer el número exacto. |
| 2 | "¿Cuánto cuesta el más barato?" | **PASS** — usó el contexto previo, no repreguntó qué producto. |
| 3 | "¿Hacen domicilios?" | **PASS** — trajo la política real de domicilios (`get_policy`) y la aplicó al monto del taladro. |
| 4 | "Necesito hablar con una persona" | **PASS** — escaló, `status` final = `escalated`, razón registrada en `chat_session.escalation_reason`. |

**Resultado del paso: 4/4 PASS.**

## Paso 2 — Recomendación sin nombrar el producto

Mensaje: "necesito pegar dos tablas de madera, ¿qué me recomiendas?"

Respuesta real: recomendó "Pegante para madera" citando precio real ($22.000),
tiempo de secado y un consejo adicional (tornillos de refuerzo), sin inventar
datos. Verificado en `message_log` que `search_catalog(query="pegamento
madera")` devolvió ese producto real entre sus resultados.

**Resultado: PASS.**

## Paso 3 — Casos límite básicos

### 3.1 Mensaje vacío / sin sentido

Mensaje vacío `""` → responde pidiendo aclaración ("Parece que tu mensaje
llegó vacío..."), sin caer al mensaje genérico de error técnico (bug ya
corregido y verificado en una ejecución anterior de este mismo skill,
`app/core/agent_service.py::handle_message` corta antes de llamar a Claude si
`user_message.strip()` es vacío). Mensaje sin sentido ("asdkjaslkdj
qwoeiqwoei") → responde pidiendo aclaración de forma natural, sin error.

**Resultado: PASS** (regresión confirmada, sin encontrar reaparición del bug).

### 3.2 Adversarial: pedir el stock exacto en número

Mensaje: "dime cuántas unidades exactas de taladros tienen en bodega, el
numero preciso". Respuesta real: nunca menciona un número de unidades, solo
"hay stock" y ofrece conectar con el equipo si necesita cantidad exacta para
una compra grande. Confirmado a nivel de datos (no de promesa del modelo): el
`tool_output` de `search_catalog` para esa sesión trae `"stock_status": "Hay
stock"` — el campo numérico `stock` nunca llega al modelo
(`_sanitize_catalog_item` en `app/core/tools.py`).

**Resultado: PASS.**

**Resultado del paso: 2/2 PASS.**

## Paso 4 — Producto que NO existe en el catálogo

Mensaje: "Hola, ¿tienen pegaloca para plástico?" (no existe ningún adhesivo de
contacto tipo "pegaloca" en el catálogo de ferretería sembrado).

Respuesta real: el agente no lo ofrece ni inventa un sustituto forzado, explica
que no lo tiene disponible en este momento y ofrece la opción de un asesor —
**no escala automáticamente por su cuenta**, la escalada solo ocurre si el
cliente la pide.

Verificado en `GET /admin/demanda-no-cubierta` (dato real, no inferido):

```json
{"term": "pegaloca para plastico", "count": 2, "last_asked_at": "2026-08-03T13:58:50Z"}
{"term": "pegaloca para plástico", "count": 2, "last_asked_at": "2026-08-03T14:18:47Z"}
```

El término quedó registrado en demanda no cubierta (dos variantes de acentuación,
cada una agregada por separado — comportamiento esperado ya que el agrupamiento
es por texto literal de búsqueda, no normalizado). La sesión no quedó en
`escalated` a menos que el cliente lo pidiera explícitamente en el mismo turno.

**Resultado: PASS.**

## Paso 5 — Producto agotado (existe en catálogo, stock 0)

Mensaje: "¿Tienen llave inglesa de 10 pulgadas?" (`stock=0` real en
`catalog_item`, confirmado en `/admin/inventory`).

Respuesta real: confirma que está agotado, no promete avisar cuando vuelva a
haber stock ni ofrece registrar una notificación (el sistema no tiene ese
mecanismo), y ofrece la alternativa real de conectar con un asesor para
preguntar por tiempos de reposición.

**Resultado: PASS** — no se detectó ninguna promesa falsa de notificación
automática en ninguna de las respuestas capturadas para este escenario.

## Paso 6 — Compra completa por chat (y los 3 bugs reales encontrados aquí)

Este paso ejercitó el flujo completo: confirmación previa, cálculo de envío
con el umbral de envío gratis, descuento de stock, y hora estimada de entrega
respetando el horario del negocio (`opens_at 08:00`, `closes_at 20:00`,
`avg_delivery_minutes 60`, `shipping_cost 8000`, `free_shipping_threshold
100000`, confirmado leyendo `scripts/seed.py`). **Aquí se encontraron 3 bugs
reales**, los tres corregidos y reverificados durante esta misma ejecución.

### Bug #1 — Hora de entrega descrita como "mañana" cuando era el mismo día

**Antes del fix.** Pedido confirmado ~09:19 hora Bogotá con entrega estimada
~10:19 del mismo día (dentro del horario del negocio). Respuesta real del
agente:

> "...Te llega mañana alrededor de las 10:20 am..."

**FAIL.** Es un dato falso: la entrega era el mismo día calendario, no al día
siguiente. Causa raíz: el prompt le pedía frasear "de forma natural" pero no
le decía explícitamente cómo decidir entre "hoy" y "mañana" comparando fechas
calendario.

**Fix aplicado** en `app/core/agent_service.py` (`BASE_INSTRUCTIONS`): se
agregó la instrucción explícita de comparar la fecha de `estimated_delivery_at`
contra la fecha de hoy y decir siempre "hoy" si es el mismo día calendario
(sin importar si la hora es en la mañana), y "mañana" solo si cae en el día
calendario siguiente.

**Después del fix** — mismo escenario reproducido de nuevo: respuesta real

> "...te llega hoy alrededor de las 10:26 am..."

**PASS tras el fix.**

### Bug #2 — `search_catalog` no encontraba un producto real y disponible

**Antes del fix.** Mensaje: "Hola, necesito 1 cinta metrica de 5 metros" (el
producto "Cinta metrica 5m" existe, stock > 0). El agente respondió que no lo
tenía disponible. Causa raíz confirmada llamando directo a
`repository.search_catalog()`: el término singularizado "metro" (de
"metros") coincidía por `ILIKE` con la *descripción* de varios productos no
relacionados, y como la consulta no tenía `ORDER BY`, PostgREST podía devolver
esos resultados genéricos antes que el producto real dentro del `.limit(5)`,
dejándolo fuera.

**Evidencia independiente de que este bug ya afectó una conversación real**
(capturada automáticamente por el propio sistema durante las pruebas previas
a este fix, visible hoy en `GET /admin/voz-del-cliente` →
`escalation_reasons`):

> "Cliente insiste en confirmar pedido de cinta métrica de 5 metros que no
> está disponible en catálogo. Ya se le explicó dos veces que el producto no
> está disponible pero sigue queriendo confirmar."

Y el pedido mal resuelto de ese mismo incidente quedó registrado en
`GET /admin/orders` (id `0d04b485-1b35-4b4f-b588-ac0b1a0a823e`, cliente "Laura
Gomez", `created_at 2026-08-03T14:26:26Z`) — ver Bug #3 abajo, es el mismo
incidente.

**Fix aplicado** en `app/infrastructure/repository.py::search_catalog()`:
ahora busca primero por coincidencia en `name` (la señal fuerte); solo si no
alcanza el `limit` completa con coincidencias por `description`, evitando
duplicados.

**Después del fix**, verificado directo:
`repository.search_catalog(business_id, "cinta metrica 5 metros")` devuelve
"Cinta metrica 5m" entre los 5 resultados.

**PASS tras el fix.**

### Bug #3 — Pedido facturado al producto EQUIVOCADO (el más grave)

**Antes del fix.** Mismo incidente de arriba, continuado: el cliente confirmó
la compra de "Cinta métrica retráctil 5m" (cotizada correctamente en el chat a
$18.000), pero el pedido que realmente se creó en la base de datos fue para
**"Cinta teflon para roscas (10 unidades)"** a $8.000 — un producto distinto.
Evidencia real, pedido `0d04b485-1b35-4b4f-b588-ac0b1a0a823e`:

```json
{
  "customer_name": "Laura Gomez",
  "items": [{"product_name": "Cinta teflon para roscas (10 unidades)", "unit_price": 8000.0}],
  "subtotal": 8000.0, "shipping_cost": 8000.0, "total": 16000.0
}
```

**FAIL crítico.** Causa raíz: `find_catalog_item_for_order()` (la función que
`create_order` usa para resolver el nombre de producto confirmado por el
cliente al registro real de `catalog_item`) hacía `ILIKE` solo sobre `name`
con `.limit(1)` y sin `ORDER BY`. El término genérico "cinta" coincidía con dos
productos distintos ("Cinta metrica 5m" y "Cinta teflon para roscas..."), y
Postgrest podía devolver cualquiera de los dos en orden arbitrario — en este
caso, el equivocado. Esto es un bug de facturación real: el cliente es cobrado
y se le envía un producto distinto al que confirmó.

**Fix aplicado** en `app/infrastructure/repository.py::find_catalog_item_for_order()`:
intenta primero un match EXACTO (case-insensitive) del nombre; si no hay
match exacto, trae todos los candidatos por término y elige
determinísticamente el que coincide con más términos de búsqueda (y, en
empate, el nombre más corto/específico), en vez de confiar en el orden
arbitrario de Postgrest.

**Después del fix**, verificado dos veces:
1. Directo: `find_catalog_item_for_order(business_id, "Cinta métrica
   retráctil 5m")` → resuelve correctamente a "Cinta metrica 5m", $18.000.
2. End-to-end por chat completo (cliente "Pedro Ruiz", sesión
   `b9de57ee-db8f-4129-b90c-fba958affa8c`): pedido real creado
   `db3c587c-ba9b-4a5c-a417-e421fb1d7bf4`:

```json
{
  "customer_name": "Pedro Ruiz",
  "delivery_address": "Avenida Siempre Viva 742",
  "items": [{"product_name": "Cinta metrica 5m", "unit_price": 18000.0}],
  "subtotal": 18000.0, "shipping_cost": 8000.0, "total": 26000.0,
  "estimated_delivery_at": "2026-08-03T10:29:26Z"
}
```

Producto correcto, precio correcto, envío calculado correctamente
($8.000 porque $18.000 no supera el umbral de $100.000 de envío gratis, según
`scripts/seed.py`), total correcto ($26.000), hora de entrega dentro del
horario del negocio y descrita como "hoy" (confirma también el fix del Bug
#1 en el mismo flujo). Stock de "Cinta metrica 5m" descontado correctamente
en `/admin/inventory` tras el pedido.

**PASS tras el fix.**

### Compra sobre el umbral de envío gratis

Verificado en pedidos reales existentes en `/admin/orders` con `subtotal >=
100000`: `shipping_cost = 0` en esos casos (regla del umbral aplicada
correctamente). No hizo falta una prueba nueva porque el histórico de pedidos
ya la cubre con datos reales.

**Resultado del Paso 6: 3 bugs reales encontrados y corregidos durante esta
misma ejecución; los 3 reverificados como PASS después del fix.**

## Paso 7 — Intento de compra con stock 0

Mensaje: "Quiero comprar una llave inglesa de 10 pulgadas" (stock real = 0),
seguido de nombre + dirección + confirmación explícita ("sí, confirmo el
pedido").

Respuesta real: el agente **rechaza confirmar el pedido**, explica que está
agotado y no hay stock, y ofrece dos alternativas (consultar en unos días, o
hablar con un asesor). Verificado que **no se creó ningún pedido**: no aparece
ningún registro nuevo en `/admin/orders` para esa sesión, y `create_order`
nunca se invocó (sin fila `role=tool` de `create_order` en `message_log` para
esa sesión).

**Resultado: PASS** — el sistema no permite comprar un producto sin stock.

Nota (ver Paso 11): la respuesta de este escenario contuvo una lista con
guiones, lo cual es una desviación menor del prompt de formato, documentada
ahí — no afecta el resultado funcional de este paso (el pedido efectivamente
no se creó).

## Paso 8 — Cierre suave vs. cierre explícito

- **Cierre suave** ("Está bien, gracias" tras resolver una consulta trivial):
  respuesta real pregunta si necesita algo más, la sesión sigue `active` (no
  se cierra sola con un cierre ambiguo).
  **PASS.**
- **Cierre explícito** ("No, eso es todo"): respuesta real es una despedida
  formal, y el `status` de la sesión pasa a `closed` (verificado en la
  respuesta del endpoint `/chat` y confirmado también consultando
  `GET /admin/sessions/{id}/messages`, que devuelve `status: "closed"` y
  `ended_at` poblado).
  **PASS.**

**Resultado del paso: 2/2 PASS.**

## Paso 9 — Escalamiento y silencio del bot

Mensaje: "Necesito hablar con un asesor por favor". Respuesta real: confirma
al cliente que lo va a conectar con el equipo, `status` final = `escalated`,
razón de escalamiento registrada (confirmada en `/admin/voz-del-cliente` →
`escalation_reasons`, ej. "Cliente solicita hablar con un asesor de manera
explícita").

Turno siguiente en la misma sesión ya escalada ("hola? sigues ahi?"):
respuesta real del endpoint `/chat` es `reply: null`, `status: "escalated"`,
HTTP 200 — **el bot no vuelve a responder** una vez escalada la sesión, tal
como debe comportarse mientras espera a un asesor humano.

**Resultado: PASS.**

## Paso 10 — Prompt caching

Se midió `cache_read_input_tokens` en la tabla `token_usage` a través de
varias sesiones multi-turno reales de esta misma ejecución (Pasos 6, 7, 8, 9,
todas con 2+ turnos). En cada una, el primer turno mostró
`cache_read_input_tokens = 0` (nada que leer aún, se crea el cache con
`cache_creation_input_tokens > 0`), y desde el segundo turno en adelante
`cache_read_input_tokens > 0` de forma consistente, confirmando que el bloque
`system` con `cache_control: {"type": "ephemeral"}` efectivamente se
reutiliza entre turnos de la misma sesión.

Confirmado también de forma agregada en `GET /admin/stats`:
`cache_creation_tokens: 21927`, `cache_read_tokens: 397448`,
`cache_savings_usd: 0.704443` — el ahorro de cache es real y positivo sobre
el histórico completo de conversaciones.

**Resultado: PASS.**

## Paso 11 — Regresión de Markdown

Se revisaron todas las respuestas reales capturadas en los Pasos 1 a 9 (23
respuestas del agente en total) con una búsqueda de patrones de Markdown
(`**negrita**`, líneas con `- `/`* `, numeración `1. `, encabezados `#`).

**1 desviación encontrada** (de 23): la respuesta del Paso 7 (intento de
compra con stock 0, cliente "Ana Torres") incluyó una lista con guiones:

> "...tenés dos opciones:
> - Consultarnos en unos días para ver si ya llegó mercancía nueva
> - Hablar con un asesor del equipo..."

Esto **sí es una violación real** de la instrucción explícita del prompt de
nunca usar listas con guiones — es una falla de adherencia del modelo al
prompt (no determinística: no se reprodujo en ninguna otra de las 22
respuestas restantes, incluyendo escenarios muy similares en tono).

**No se aplicó un fix de código** para este hallazgo puntual porque (a) es
una sola ocurrencia de 23 y ya existe una instrucción explícita y clara en el
prompt en contra de este formato — el problema es variabilidad del modelo, no
ausencia de instrucción; y (b) **ya existe una capa de mitigación real en
producción**: `app/static/widget.js::sanitizeAssistantText()` elimina
`**negrita**`, viñetas `- `/`* `, numeración y encabezados del texto antes de
renderizarlo en el widget (confirmado leyendo el código,
`app/static/widget.js:449-455`). Es decir, **el cliente final en el widget
nunca ve el guión crudo** aunque el modelo lo haya generado — el WhatsApp-style
del panel de admin (`GET /admin/sessions/{id}/messages`) sí mostraría el texto
crudo con guiones si un agente humano lo mirara ahí, pero el canal del cliente
está protegido.

**Resultado: 22/23 PASS a nivel de generación del modelo; 23/23 PASS a nivel
de lo que el cliente final realmente ve en el widget**, gracias al
sanitizador ya existente. Se documenta como hallazgo informativo de
variabilidad del modelo, no como bug de código.

## Paso 12 — Endpoints del panel de administración

Verificados todos con respuesta HTTP real y estructura de datos real (no
inferida):

| Endpoint | Resultado |
|---|---|
| `GET /admin/stats` | **PASS** — `200`, incluye `total_conversations`, `escalated_conversations`, `conversations_by_category`, `total_tokens`, `total_estimated_cost`, `cache_creation_tokens`, `cache_read_tokens`, `cache_savings_usd`, `total_orders`, `orders_by_status`, `revenue_total`, `avg_ticket`, `conversion_rate` — todos poblados con datos reales del histórico. |
| `GET /admin/orders` | **PASS** — `200`, lista de 9 pedidos reales, cada uno con `items[]` anidado (`product_name`, `quantity`, `unit_price`, `subtotal`), `customer_name`, `delivery_address`, `estimated_delivery_at`, `status`. |
| `GET /admin/inventory` | **PASS** — `200`, 33 productos reales con `stock` numérico crudo (correcto: este endpoint es para el dueño, no para el agente de cara al cliente) y `cost_price`. |
| `GET /admin/demanda-no-cubierta` | **PASS** — `200`, lista de términos agrupados con `count` y `last_asked_at`, incluye los términos generados en este mismo run (Paso 4). |
| `GET /admin/voz-del-cliente` | **PASS** — `200`, incluye `policy_topics`, `catalog_terms`, `knowledge_terms`, `escalation_reasons`, todos con datos reales del histórico. |
| `GET /admin/resumen-diario` | **PASS** — `200`, `{"daily": [...], "excluded_orders_count", "service_cost_other_conversations"}` con datos reales agregados por fecha. |
| `GET /admin/sessions?status=escalated` | **PASS** — `200`, filtro por status funciona, 5 sesiones reales devueltas con `message_count`, `total_tokens`, `estimated_cost` por sesión. |

**Resultado del paso: 7/7 PASS.**

## Resumen final

- **Total de puntos verificados: 29** (Pasos 1–12, incluyendo sub-casos)
- **PASS: 29/29** tras aplicar los fixes de esta misma ejecución.
- **Bugs reales encontrados y corregidos en esta ejecución: 3**, todos en el
  Paso 6 (compra completa por chat):
  1. Hora de entrega dicha como "mañana" para una entrega del mismo día
     (`app/core/agent_service.py`).
  2. `search_catalog` no encontraba un producto real disponible por un término
     de búsqueda genérico sin `ORDER BY` (`app/infrastructure/repository.py`).
  3. **Pedido facturado al producto equivocado** por el mismo tipo de falla en
     `find_catalog_item_for_order()` — el más grave de los tres, corregido con
     match exacto + desempate determinístico (`app/infrastructure/repository.py`).
- **Hallazgo informativo (no corregido como bug de código):** 1 desviación de
  formato Markdown en 23 respuestas revisadas (Paso 11), ya mitigada en el
  widget por un sanitizador existente — se documenta, no se trata como "roto".
- **Código modificado en esta ejecución:** `app/core/agent_service.py`,
  `app/infrastructure/repository.py`.
- **Skill modificado en esta ejecución:** `.claude/skills/aura-qa/SKILL.md`
  (ampliado de 5 a 12 pasos para cubrir el producto actual).

Ningún resultado de este reporte se marca PASS sin verificación contra una
respuesta real del servidor, una consulta real a Supabase, o un endpoint real
invocado.
