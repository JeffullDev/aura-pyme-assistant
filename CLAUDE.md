# CLAUDE.md

Instrucciones de proyecto para trabajar en AURA. Léelo antes de tocar código:
está escrito para que un desarrollador (o un agente) nuevo no repita errores ya
corregidos ni rompa invariantes que no son obvios leyendo un solo archivo.

## Qué es esto

AURA es un agente de atención al cliente por chat para una PyME (negocio de
ejemplo ficticio: **El Tornillo Feliz**, una ferretería de barrio). Usa Claude
con tool use real contra datos reales en Supabase: consulta catálogo y
políticas del negocio en vez de inventar, toma pedidos, consulta su estado, y
escala a un humano cuando corresponde. Es un MVP de hackathon con límites
declarados (ver `README.md`), no un producto de producción.

Contexto de negocio, decisiones de diseño, capacidades de Claude usadas,
límites conocidos y el historial honesto de "qué falló y cómo se corrigió"
están en `README.md` — no los dupliques aquí. Este archivo es para
convenciones de código y reglas operativas, no para la narrativa del proyecto.

## Arquitectura en pocas líneas

Tres capas, dependencias en una sola dirección:

```
app/api/*.py          rutas HTTP (FastAPI routers): health, chat, admin
app/core/*.py          logica de negocio: orquestacion del agente, tools,
                        pedidos, entrega, catalogo (sin saber nada de HTTP)
app/infrastructure/*.py  acceso a datos: cliente de Supabase, cliente de
                        Claude, repository.py (unico punto que habla con
                        Supabase; todo filtrado por business_id)
```

Flujo de un mensaje: `POST /chat` (`app/api/chat.py`) → `handle_message()` en
`app/core/agent_service.py` reconstruye historial, arma el system prompt,
corre el loop de tool use (máx. 5 iteraciones, `_run_tool_loop`) llamando a
`app/core/tools.py::execute_tool`, que delega en `app/core/orders.py` /
`app/core/delivery.py` / `app/infrastructure/repository.py` según la tool.
Cada mensaje y cada llamada a herramienta se registra en `message_log`
(incluyendo filas `role='tool'` con `tool_name`/`tool_input`/`tool_output`),
así que cualquier respuesta del agente es trazable hasta el dato exacto que
la originó — si algo se ve raro en el chat, el primer lugar para investigar
es `GET /admin/sessions/{id}/messages`, no adivinar leyendo el prompt.

Frontend: `app/static/index.html`+`script.js` (chat de página completa) y
`app/static/widget.js` (versión embebible en Shadow DOM para incrustar en el
sitio de un cliente) son **dos implementaciones separadas e intencionalmente
duplicadas** de la misma lógica de conversación. Ver regla más abajo.

`app/static/admin.html`+`admin.js` es el panel del dueño del negocio: sesiones,
pedidos, inventario con stock real, demanda no cubierta, "lo que dice la
gente", rentabilidad diaria. **Sin autenticación** — ver `docs/security_audit.md`
hallazgo #5 antes de tocar cualquier endpoint de escritura de `app/api/admin.py`.

## Convenciones de código

- **Handlers de FastAPI son `def`, nunca `async def`.** `supabase-py` es
  bloqueante; un `async def` que llame a Supabase dentro congelaría el event
  loop. Con `def`, FastAPI despacha automáticamente a un threadpool. Sigue
  este patrón en cualquier ruta nueva.
- **Acceso a datos solo vía el query builder de `supabase-py`** (`.eq()`,
  `.ilike()`, `.or_()`, `.in_()`, `.limit()`, `.order()`) en
  `app/infrastructure/repository.py`. Nunca SQL crudo desde la capa de
  aplicación. Si construyes un filtro con input del usuario dentro de
  `.or_()`, sanitiza antes: PostgREST interpreta `,` `(` `)` `.` como sintaxis
  de su propio lenguaje de filtros (ver `_sanitize_filter_term()` en
  `repository.py` y el payload adversarial de ejemplo en
  `docs/security_audit.md` sección 2).
- **`app/core/*` no sabe nada de HTTP.** No importes nada de `fastapi` ni
  manejes `HTTPException` fuera de `app/api/*`. Los servicios de `core`
  devuelven dicts planos (`{"success": bool, ...}` o `{"found": bool, ...}`);
  el router traduce a la respuesta HTTP.
- **Todo dato de negocio pasa por Supabase, nunca por el prompt.** Si Claude
  necesita un precio, disponibilidad, política o estado de pedido, la
  respuesta tiene que venir de una tool call real. El system prompt
  (`BASE_INSTRUCTIONS` en `agent_service.py`) ya se lo exige explícitamente;
  no agregues atajos que le permitan "recordar" o inventar estos datos.
- **Nombres y comentarios en español**, consistente con el resto del código
  (el negocio y sus usuarios son hispanohablantes). Comentarios solo cuando
  explican un *por qué* no obvio (una invariante, un bug pasado, una decisión
  de scope) — no expliques qué hace el código si el nombre ya lo dice.
- **UUIDs como llave primaria en todas las tablas.** Las migraciones nuevas
  van en `db/migrations/NNN_descripcion.sql`, numeradas secuencialmente,
  aplicadas a mano en el SQL editor de Supabase (no hay migrador automático).

## Comandos frecuentes

```bash
# Entorno (una sola vez)
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt
# copiar .env.example a .env y completar ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY

# Levantar el servidor
./venv/Scripts/python.exe -m uvicorn app.main:app --reload
# Chat:  http://localhost:8000/
# Admin: http://localhost:8000/admin

# Sembrar datos de ejemplo (idempotente: seguro correrlo mas de una vez)
./venv/Scripts/python.exe scripts/seed.py
./venv/Scripts/python.exe scripts/load_knowledge.py

# "Tests" (no hay pytest/suite formal: son scripts que corren contra el
# servidor local real, con datos reales de Supabase — levanta uvicorn primero)
./venv/Scripts/python.exe scripts/test_chat.py     # flujo de 4 mensajes: catalogo, contexto, politica, escalamiento
./venv/Scripts/python.exe scripts/test_order.py    # flujo de compra completo (create_order)
./venv/Scripts/python.exe scripts/test_handoff.py  # escalamiento -> toma humana -> respuesta -> cierre

# Verificar que el entorno esta bien montado
curl http://localhost:8000/health   # {"status": "ok", "supabase": "connected"}
```

Migraciones: aplicar `db/migrations/001_init.sql` a `011_ubicacion.sql` en orden
contra el proyecto de Supabase antes de sembrar datos.

## Cómo están organizadas las tools del agente

Todo vive en `app/core/tools.py`: `TOOL_DEFINITIONS` (nombre, descripción,
`input_schema` que se manda a la API de Claude tal cual) y `execute_tool()`
(dispatcher `if name == ...` que delega y devuelve el dict que se loguea como
`tool_output`). Para agregar una tool nueva: agrégala a `TOOL_DEFINITIONS` con
una descripción que le diga a Claude *cuándo* usarla (no solo qué hace — el
system prompt depende de esto para forzar el uso de tools sobre inventar), y
un `if` correspondiente en `execute_tool()` que delegue en `app/core/*` o
`repository.py`, nunca lógica de negocio inline ahí mismo.

Las 8 tools actuales, agrupadas por qué resuelven:

| Tool | Resuelve |
|---|---|
| `search_catalog` | precio/disponibilidad/características de productos |
| `get_policy` | horario, domicilios, garantía, pago, ubicación (5 temas fijos) |
| `search_knowledge` | preguntas libres que no encajan arriba (guías, consejos, marca) |
| `create_order` | registra un pedido — exige confirmación explícita previa del cliente |
| `check_order_status` | estado y hora estimada de entrega de pedidos propios |
| `registrar_demanda_no_cubierta` | producto pedido que `search_catalog` confirmó que no existe |
| `escalate_to_human` | pasa la conversación a una persona |
| `close_conversation` | cierra la conversación con confirmación explícita del cliente |

El loop de tool use (`_run_tool_loop` en `agent_service.py`) corre hasta 5
iteraciones; si se agota, escala automáticamente y responde con disculpa. El
historial que se reconstruye entre turnos (`get_history()`) es solo texto
plano user/assistant — los bloques `tool_use`/`tool_result` no se replican
entre turnos, solo dentro de una misma llamada al loop.

## Reglas que un desarrollador nuevo debe respetar

1. **Nunca expongas el stock numérico al modelo.** `search_catalog` no
   devuelve el campo `stock` crudo: `_sanitize_catalog_item()` en
   `app/core/tools.py` lo reemplaza por `stock_status` categórico
   (`Agotado` / `Poco stock` / `Hay stock, pocas unidades` / `Hay stock`, ver
   `app/core/catalog.py::stock_status()`). Esto es una defensa a nivel de
   datos, no una instrucción de prompt — un prompt injection no puede hacer
   que el modelo revele un número que nunca recibió. Si escribes un endpoint
   o tool nueva que toque `catalog_item.stock`, pásalo por `stock_status()`
   antes de que llegue a Claude o a un mensaje de error visible para el
   cliente. La única excepción intencional es `GET /admin/inventory`, que
   expone el número real porque es para el dueño del negocio, no para el
   agente de cara al cliente.
2. **`order_items` guarda snapshot de `unit_price` y `unit_cost` al momento de
   la compra** (`db/migrations/005_orders.sql` y `007_margenes.sql`), no una
   referencia al precio/costo actual de `catalog_item`. Si el precio o el
   costo de compra de un producto cambia después, los pedidos ya hechos deben
   conservar el valor real cobrado/pagado en ese momento — así el histórico
   de márgenes (rentabilidad diaria en `/admin`) no se recalcula solo porque
   cambió un precio hoy. Cualquier lógica nueva de pedidos debe copiar el
   precio/costo en el momento de `create_order` (`app/core/orders.py`), nunca
   hacer join en vivo contra `catalog_item` para mostrar históricos.
3. **`app/static/script.js` y `app/static/widget.js` están intencionalmente
   duplicados** (localStorage, polling, indicador de "escribiendo", banner de
   escalamiento, saneo de Markdown del texto del asistente). Es una decisión
   de alcance de MVP explícita en el comentario al inicio de `widget.js`, no
   un descuido. **Si cambias el comportamiento de la conversación en uno,
   replica el cambio en el otro** — ya pasó una vez que un fix de handoff
   solo se aplicó a `script.js` y `widget.js` quedó desincronizado y con un
   bug propio (polling que no leía `status`); ambos se corrigieron juntos en
   el mismo commit. No hay un test automático que detecte esta divergencia:
   es responsabilidad de quien edita cualquiera de los dos archivos.
4. **No prometas notificaciones que el sistema no tiene.** No hay push,
   email, SMS ni WebSockets — el cliente se entera de una respuesta humana o
   de un cierre de conversación únicamente por *polling* (`GET
   /chat/{session_id}/messages`, que devuelve mensajes nuevos y el `status`
   de la sesión). Si agregas una feature que depende de que el cliente "se
   entere" de algo, tiene que resolverse con este mismo mecanismo de polling
   (o agregar polling donde falte), no asumir un canal de notificación que no
   existe. Por la misma razón, no le hagas decir al agente (system prompt o
   tool) que "te vamos a avisar" por un canal que no está implementado.
