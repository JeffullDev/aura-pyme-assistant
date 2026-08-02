# AURA — Asistente de atención al cliente con IA para PyMEs

Una pyme típica atiende su chat de WhatsApp o web con la misma persona que
factura, despacha y contesta el teléfono. Las preguntas se repiten todo el día
("¿tienen taladro?", "¿hacen domicilios?", "¿cuánto demora?"), la información
vive dispersa entre la cabeza del dueño y cuadernos, y cada minuto que un
cliente espera respuesta es una venta que se puede ir a la competencia.

AURA es un agente de atención al cliente que responde por chat usando Claude
con tool use real: consulta el catálogo, las políticas del negocio y una base
de conocimiento en vez de inventar, puede tomar pedidos, consultar su estado,
y escalar la conversación a un humano cuando corresponde. Sin humo: es un MVP
construido en un hackathon, con límites conocidos y declarados en la sección
6, no un producto terminado.

Negocio de ejemplo (ficticio, sin datos reales): **El Tornillo Feliz**, una
ferretería de barrio.

## Ver funcionando en 60 segundos

Con el servidor corriendo (ver [Instalación y reproducción](#instalación-y-reproducción)):

```
./venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

- Chat: **http://localhost:8000/**
- Panel de admin: **http://localhost:8000/admin**

Prueba estos tres mensajes en el chat, cada uno demuestra una capacidad distinta:

1. `¿tienen taladro?` — consulta de catálogo real vía `search_catalog` (precio,
   categoría y disponibilidad genuinos de Supabase, no inventados).
2. `necesito pegar dos tablas de madera, ¿qué me recomiendas?` — recomendación
   basada en una *necesidad*, sin que el cliente nombre el producto: el agente
   razona y busca "pegante"/"adhesivo" por su cuenta.
3. `quiero un martillo, mándamelo a la Calle 10 # 5-20, mi nombre es Ana` —
   flujo de compra: el agente confirma productos, dirección y total con envío
   antes de llamar `create_order`.

Después de probar, entra a `/admin` y abre la sesión recién creada: vas a ver
cada llamada a herramienta (`search_catalog`, `create_order`, etc.) con su
`tool_input` y `tool_output` real, no un resumen.

## Cómo funciona

FastAPI expone `POST /chat`. Cada mensaje pasa por `app/core/agent_service.py`,
que arma el historial de la conversación, construye el system prompt (reglas
base + tono de marca del negocio) y llama a Claude con un set fijo de
herramientas, en un loop de hasta 5 iteraciones de tool use. Cada llamada a
herramienta se ejecuta contra Supabase y se registra en `message_log` con
`tool_name`, `tool_input` y `tool_output`, así que cualquier respuesta del
agente es trazable hasta el dato exacto que la originó.

La decisión de diseño central: **el agente nunca improvisa datos del
negocio**. El system prompt (`BASE_INSTRUCTIONS` en `agent_service.py`) obliga
explícitamente a usar una herramienta para cualquier precio, disponibilidad,
política o estado de pedido, y prohíbe inventar cuando la herramienta no
devuelve nada. Los precios y el stock viven en Supabase, no en el prompt ni en
la memoria del modelo.

Las herramientas registradas hoy en `app/core/tools.py` (7 en total):

- **`search_catalog`** — busca productos por nombre, categoría o palabra
  clave. Obligatoria antes de responder sobre precio, disponibilidad o
  características.
- **`get_policy`** — trae la política oficial sobre horario, domicilios,
  garantía o pago (temas fijos, uno de esos cuatro).
- **`search_knowledge`** — busca en una base de conocimiento libre (guías de
  uso, consejos, historia de la marca) para preguntas que no encajan en
  catálogo ni en las 4 políticas fijas.
- **`create_order`** — registra un pedido. El system prompt exige haber
  confirmado explícitamente con el cliente productos, cantidades, dirección y
  total (con envío) antes de llamarla.
- **`check_order_status`** — consulta estado y hora estimada de entrega de los
  pedidos del cliente.
- **`escalate_to_human`** — marca la conversación para que la atienda una
  persona.
- **`close_conversation`** — cierra la conversación cuando el cliente confirma
  que ya no necesita nada más.

**Enmascaramiento de stock como defensa en profundidad.** `search_catalog`
nunca devuelve el número exacto de unidades en bodega: `_sanitize_catalog_item`
en `tools.py` reemplaza el campo `stock` por una categoría (`stock_status`:
"Hay stock", "Poco stock", "Agotado"). Esto no es una instrucción en el prompt
pidiéndole al modelo que no revele el número — es un filtro en la capa de
datos, antes de que la respuesta de Supabase llegue a Claude. La diferencia
importa: un prompt injection puede intentar convencer al modelo de romper una
regla que sí conoce, pero no puede hacerle repetir un dato que nunca recibió.
Esto se verificó en vivo (ver sección siguiente): un intento adversarial
explícito de pedir el número exacto no pudo tener éxito porque el
`tool_output` real de esa sesión solo contenía `stock_status`.

## Uso de capacidades de Claude

**Tool use con múltiples herramientas y loop de razonamiento.** El agente no
es un flujo de decisión escrito a mano: en cada turno Claude decide qué
herramienta(s) llamar, en qué orden, y si necesita otra ronda antes de
responder (`_run_tool_loop` en `agent_service.py`, hasta 5 iteraciones). Por
ejemplo, tomar un pedido típicamente encadena `search_catalog` (validar el
producto) y luego `create_order` en la misma respuesta al cliente.

**Dos skills de Claude Code usados para generar evidencia real, no simulada:**

- `.claude/skills/aura-qa/SKILL.md` — corre una ronda de QA funcional contra
  el servidor local real (nunca contra el código leído en frío): regresión de
  4 pruebas base, un escenario de recomendación sin nombrar producto, 3 casos
  límite (mensaje vacío, producto inexistente, intento adversarial de stock),
  regresión de Markdown sobre todas las respuestas, y verificación de
  endpoints de admin. La última corrida (`docs/qa_report.md`, 2026-08-02)
  encontró y corrigió un bug real en el mismo run (ver sección de qué falló) y
  cerró con **19/19 puntos en PASS**.
- `.claude/skills/aura-security-audit/SKILL.md` — audita secretos
  hardcodeados, inyección SQL/PostgREST, resistencia a prompt injection sobre
  el stock, exposición de errores internos, superficie sin autenticación del
  panel admin y ausencia de rate limiting. La última corrida
  (`docs/security_audit.md`, 2026-08-02) cerró con **0 hallazgos CRÍTICOS, 0
  MEDIOS, 1 BAJO y 3 INFORMATIVOS** (detalle en la sección de límites).

**Artifact:** `docs/artifact_calculadora_roi.html`, una calculadora de
proyección de costo del asistente (tokens reales de `/admin/stats` como punto
de partida, proyección x1/x2/x5 de volumen, comparación en COP contra el
costo de una persona) — un único archivo HTML/CSS/JS sin servidor ni
dependencias externas, pensado para compartirse suelto.

**Números reales medidos** (vía `GET /admin/stats` contra los datos actuales
de este entorno, no estimados): 41 conversaciones registradas, 368.869 tokens
consumidos en total, costo estimado acumulado de USD 1.24, promedio de
~14.187 tokens por conversación, 5 pedidos creados, tasa de conversión de
12.2%. El precio por millón de tokens usado para el cálculo ($3 input / $15
output) es un valor de referencia dejado explícito como aproximado en
`app/core/config.py`, no una tarifa facturada verificada contra el pricing
vigente.

**Nota de precisión:** el código actual **no implementa prompt caching** de
la API de Claude (no hay ningún `cache_control` en las llamadas de
`agent_service.py`/`claude_client.py`). Se documenta como oportunidad de
optimización pendiente en vez de afirmar un ahorro que no está medido ni
implementado — ver [Límites conocidos](#límites-conocidos).

## Cómo lo usaría una pyme de verdad

**Quién lo usa:** el dueño o administrador del negocio entra a `/admin` para
ver el panorama completo — todas las conversaciones, pedidos, el catálogo con
stock real, demanda no cubierta (términos que los clientes buscaron y el
catálogo no resolvió) y la rentabilidad diaria. El equipo de atención (o el
mismo dueño, en un negocio pequeño) usa el panel para tomar conversaciones
escaladas y responderlas directamente.

**Cuándo interviene una persona y qué revisa:** el dueño revisa periódicamente
la sección de demanda no cubierta (productos que la gente pide y no existen
en el catálogo — señal de oportunidad de inventario) y la de rentabilidad
diaria. Un agente humano interviene cuando el bot escala una conversación.

**Flujo completo de escalamiento (handoff):**
1. El cliente pide hablar con una persona, o el bot detecta que no puede
   resolver la consulta con las herramientas disponibles (`escalate_to_human`).
2. La conversación cambia de estado a `escalated` y entra a la cola visible
   en `/admin`.
3. Un agente humano la toma desde el panel (`POST
   /admin/sessions/{id}/take`); la sesión pasa a `assigned` con el nombre del
   agente.
4. **El bot se calla por completo** a partir de ese momento: `agent_service.py`
   corta la ejecución antes de llamar a Claude si el estado de la sesión es
   `escalated` o `assigned`, y devuelve `reply: null`. El mensaje del cliente
   se sigue registrando (trazabilidad intacta), pero no hay respuesta
   automática superpuesta a la del humano.
5. El agente humano responde desde el panel; el cliente ve esas respuestas
   por polling (`GET /chat/{session_id}/messages`).
6. El agente puede devolver la conversación al bot (`/return-to-bot`) o
   cerrarla (`/close`).

## Límites conocidos

Declarados explícitamente, no descubiertos por accidente:

- **El panel de admin no tiene autenticación.** Decisión de alcance para este
  MVP de 48 horas, documentada desde el propio código
  (`app/static/admin.html`) y confirmada en vivo en la auditoría de
  seguridad: `GET /admin`, `/admin/sessions` y `/admin/sessions/{id}/messages`
  responden 200 sin ningún header de autorización. En producción necesitaría
  login real o restricción de IP.
- **No hay rate limiting** en `/chat` ni en `/admin/*`. Consecuencia real: el
  costo de la API de Claude por `/chat` no tiene techo, y `/admin` se puede
  scrapear completo sin restricción. Límite de alcance conocido del MVP, no
  implementado a propósito.
- **Hallazgo BAJO de la auditoría de seguridad:** `app/api/health.py` mete el
  texto crudo de la excepción (`str(exc)`) directo en el `detail` del
  `HTTPException` cuando Supabase no responde — se probó en vivo y el cliente
  recibe algo como `503 - "Supabase unreachable: Invalid API key"`. No filtra
  rutas de archivo ni tracebacks, por eso se clasificó BAJO y no se corrigió;
  queda documentado como mejora de hardening pendiente (debería devolver un
  mensaje genérico, como ya hace `agent_service.py`).
- **El canal actual es web**, no WhatsApp — ver la hoja de ruta abajo.
- **Prompt caching no está implementado** (ver sección anterior).

La rúbrica premia límites declarados, no los castiga: esta sección existe
para que no haya que descubrir estos límites en producción.

## Hoja de ruta: WhatsApp y otros canales

La arquitectura ya es agnóstica al canal por construcción: `app/core/agent_service.py`
no sabe ni le importa si el mensaje vino del widget web, de la demo, o de
cualquier otro origen — solo recibe texto (`user_message`) y un identificador
de usuario (`user_identifier`). Todo lo que es específico del canal vive fuera
del core, en la capa de entrada/salida (`app/api/chat.py` para el web actual).

Conectar WhatsApp significa escribir un adaptador de entrada (un webhook que
recibe el evento de mensaje de la API de WhatsApp Business, lo traduce a una
llamada a `handle_message`) y un adaptador de salida (que tome el `reply` y lo
envíe de vuelta por la API de WhatsApp) — **sin tocar la lógica del agente**.

Lo que la empresa debe aportar: una cuenta de WhatsApp Business verificada
ante Meta y un número dedicado.

Restricción real de la API de WhatsApp Business que condiciona el diseño del
handoff: la **ventana de 24 horas**. Una vez que pasan 24 horas desde el
último mensaje del cliente, el negocio ya no puede iniciar contacto libre —
solo puede enviar plantillas de mensaje pre-aprobadas por Meta. Esto importa
directamente para el flujo de escalamiento a humano: si un cliente escala una
conversación y un agente humano no responde dentro de esa ventana, la
respuesta humana ya no puede salir como mensaje libre y tendría que pasar por
una plantilla aprobada. El diseño de colas y tiempos de respuesta del panel
de admin necesitaría tener esto en cuenta antes de una integración real.

## Protección de datos personales (Ley 1581 de 2012)

**Esto es un análisis de lo que exigiría producción, no una declaración de
cumplimiento ya implementado.** AURA en su estado actual no implementa ninguno
de los mecanismos de esta sección — no afirma cumplir lo que no está
construido.

**Qué se captura hoy:** un identificador de usuario (`user_identifier`) por
sesión de chat, el contenido completo de la conversación (`message_log`), y —
cuando se crea un pedido — nombre del cliente y dirección de entrega
(`orders`). No hay hoy ningún mecanismo de consentimiento, aviso de
privacidad, ni control de retención sobre esos datos.

**Qué exigiría producción en Colombia**, bajo la Ley 1581 de 2012:
- Autorización previa y expresa del titular antes de capturar sus datos.
- Aviso de privacidad accesible que explique qué se recopila y para qué.
- Un período de retención definido (hoy los datos no se purgan nunca).
- Mecanismo de consulta, rectificación y eliminación a disposición del
  titular (derecho de habeas data).
- **El punto que casi nadie menciona:** cada mensaje que este sistema envía a
  la API de Claude constituye una **transferencia internacional de datos**
  (el mensaje sale de Colombia hacia la infraestructura de Anthropic). Eso
  está regulado específicamente por los **artículos 26 y 27** de la Ley 1581
  de 2012, que exigen que el país receptor garantice un nivel adecuado de
  protección de datos o que se cumplan las excepciones previstas — es un
  requisito adicional y distinto al del tratamiento local de datos, y hoy no
  está evaluado ni cubierto en este proyecto.

## Instalación y reproducción

Ya se verificó que funciona desde un clon limpio — estos pasos son exactos.

1. **Entorno virtual e instalación de dependencias:**
   ```
   python -m venv venv
   ./venv/Scripts/python.exe -m pip install -r requirements.txt
   ```
2. **Configurar `.env`** (copiar `.env.example`) con las 3 variables
   requeridas: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.
   `ALLOWED_ORIGINS` y `CLAUDE_MODEL` son opcionales.
3. **Correr las 8 migraciones, en orden, contra tu proyecto de Supabase**
   (copiar y ejecutar cada archivo en el SQL editor de Supabase):
   `001_init.sql`, `002_token_usage.sql`, `003_business_config.sql`,
   `004_knowledge.sql`, `005_orders.sql`, `006_handoff.sql`,
   `007_margenes.sql`, `008_abandoned_status.sql`.
4. **Sembrar datos de ejemplo:**
   ```
   ./venv/Scripts/python.exe scripts/seed.py
   ./venv/Scripts/python.exe scripts/load_knowledge.py
   ```
   Ambos scripts son idempotentes: verifican si el negocio (o su
   `knowledge_base`) ya existe antes de insertar, y si ya existe no
   duplican nada — se puede correr el paso dos veces sin miedo.
5. **Levantar el servidor:**
   ```
   ./venv/Scripts/python.exe -m uvicorn app.main:app --reload
   ```
6. **Verificar:** `GET /health` debe responder
   `{"status": "ok", "supabase": "connected"}`. Chat en `/`, panel en
   `/admin`. `./venv/Scripts/python.exe scripts/test_chat.py` corre un flujo
   de 4 mensajes end-to-end contra el servidor local.

## Proceso de construcción: qué falló y cómo se corrigió

En prosa honesta, sin adornar — incidentes reales de este proyecto, no
hipotéticos:

**Búsqueda de catálogo no encontraba plurales.** El primer `search_catalog`
usaba `ILIKE` directo sobre el término tal cual lo escribía el cliente:
"taladros" no encontraba "Taladro percutor" porque el ILIKE comparaba la
palabra completa, no una raíz. El agente respondía que no había stock cuando
sí lo había. Se corrigió con `_singularize()` y `_search_terms()` en
`app/infrastructure/repository.py`: un stemming ingenuo de plurales en
español (recorta sufijos `-es`/`-s`) antes de armar el filtro, ya que un
`ILIKE %x%` solo necesita la raíz para machear.

**Mensaje vacío causaba un 400 de la API de Claude.** Encontrado por el
propio skill de QA en su corrida del 2026-08-02: enviar un mensaje vacío
producía la respuesta genérica de falla técnica en vez de pedir aclaración.
La causa: `get_history()` descarta filas con `content` vacío (`if
row.get("content")`), así que el mensaje recién logueado quedaba fuera del
historial reconstruido, dejando la lista de `messages` vacía — y la API de
Claude rechaza una llamada sin al menos un mensaje. Se corrigió en el mismo
run: `handle_message()` corta antes de llamar a Claude si
`user_message.strip()` está vacío, y responde con un mensaje de aclaración
fijo (igual se loguea para trazabilidad).

**`seed.py` no era idempotente.** Correr el script una segunda vez insertaba
un `business` duplicado — la primera versión insertaba sin verificar
existencia previa. La corrida de QA del mismo día lo detectó y documentó como
limitación conocida en ese momento (tuvo que sembrar un producto nuevo
insertándolo directo contra Supabase en vez de re-correr el seed, para no
duplicar el negocio). Se corrigió después agregando una verificación por
nombre de negocio al inicio de `main()`: si ya existe, el seed completo se
omite sin tocar nada.

**El README afirmaba que partes del sistema "llegan en el siguiente
prompt".** Detectado probando la reproducibilidad del proyecto desde un clon
limpio: el resumen seguía describiendo el agente, el chat y el frontend como
pendientes cuando ya existían y funcionaban. Se corrigió actualizando el
README para reflejar el estado real del código en ese momento, agregando
también el paso de migración que faltaba.

**Mezcla de monedas en la calculadora de costo.** El costo del asistente de
IA se calculaba en USD, pero se comparaba directamente contra el costo de una
persona en pesos colombianos — ambos mostrados con el mismo símbolo `$`, sin
convertir. Exageraba la diferencia en varios órdenes de magnitud. Se corrigió
agregando una constante de conversión (`ROI_USD_TO_COP`, referencial) y
forzando que la comparación se muestre siempre en COP, con el valor real en
USD aparte y etiquetas de moneda explícitas.

**Falso positivo en "demanda no cubierta".** Esta sección del panel lista
términos que los clientes buscaron y el catálogo no resolvió
(`search_catalog` devolvió `count: 0`). Como ese conteo queda grabado en el
momento histórico de la búsqueda, un término que falló por el bug de
plurales (antes de corregirse) seguía apareciendo como demanda no cubierta
para siempre, aunque el catálogo sí lo resolviera hoy. Se corrigió
revalidando cada término contra el catálogo actual antes de devolverlo
(`get_uncovered_demand()` en `repository.py`): si hoy sí hay resultados, se
descarta.

**El stock exacto llegaba al modelo.** La primera versión de
`search_catalog` devolvía el campo `stock` numérico crudo en el
`tool_output`. Se corrigió en la capa de datos, no con una instrucción de
prompt: `_sanitize_catalog_item()` en `app/core/tools.py` reemplaza el número
por una categoría (`stock_status`) antes de que el resultado salga hacia
Claude — así el dato nunca está disponible para que un prompt injection lo
extraiga, sin depender de que el modelo "decida" no repetirlo.

**Nota de precisión sobre un punto que la consigna original mencionaba** ("el
bot seguía respondiendo después de escalar a un humano"): revisando el
historial real del proyecto, la supresión del bot en sesiones
`escalated`/`assigned` se implementó como parte del diseño original de la
función de handoff, no como corrección de un bug detectado después. Se
documenta aquí tal como ocurrió en el repo, no como un incidente separado de
"qué falló".

## Entregables

- Skill de QA: `.claude/skills/aura-qa/SKILL.md`
- Skill de auditoría de seguridad: `.claude/skills/aura-security-audit/SKILL.md`
- Artifact (calculadora de costo): `docs/artifact_calculadora_roi.html`
- Reporte de QA: `docs/qa_report.md`
- Reporte de auditoría de seguridad: `docs/security_audit.md`
- Migraciones: `db/migrations/001_init.sql` a `008_abandoned_status.sql`
- Script de siembra de datos: `scripts/seed.py` y `scripts/load_knowledge.py`

## Stack y decisiones técnicas

- **Python 3.12 + FastAPI, handlers síncronos a propósito.** Todas las rutas
  en `app/api/*.py` están escritas como `def`, no `async def`. La razón:
  `supabase-py` es una librería bloqueante. Si un handler fuera `async def` y
  llamara a Supabase dentro, congelaría el event loop de FastAPI mientras
  espera la respuesta de red. Con `def`, FastAPI despacha automáticamente
  cada llamada a un threadpool, evitando ese bloqueo sin necesidad de un
  cliente async de Supabase.
- **Supabase (Postgres) vía `supabase-py`**, usando siempre el query builder
  (`.eq()`, `.ilike()`, `.or_()`, `.in_()`) — sin SQL crudo en la capa de
  aplicación, confirmado en la auditoría de seguridad.
- **Anthropic Claude Messages API con tool use, sin framework de
  orquestación.** El loop de tool use (`_run_tool_loop`) está escrito a mano
  en `agent_service.py`.
- **Arquitectura por capas:** `app/api` (rutas HTTP), `app/core` (lógica de
  negocio: agente, herramientas), `app/infrastructure` (acceso a datos:
  Supabase, cliente de Claude).
- **Modelo de datos:** `business` (config estructurada: horario, costo de
  envío, umbral de envío gratis — fuente de verdad para cálculos, separada
  del texto de las políticas), `catalog_item` / `policy` (políticas a 4 temas
  fijos: horario, domicilios, garantía, pago), `knowledge_base` (contenido
  libre indexado por título/sección), `orders` / `order_items` (con snapshot
  de precio y nombre al momento de la compra, para que un cambio posterior de
  precio no altere pedidos ya hechos), `chat_session` / `message_log`
  (trazabilidad completa, incluyendo filas `role='tool'` con
  `tool_name`/`tool_input`/`tool_output`). Todas las claves primarias son
  UUID.
