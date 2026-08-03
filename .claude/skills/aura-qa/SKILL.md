---
name: aura-qa
description: Ejecuta una ronda de QA funcional sobre el agente AURA (El Tornillo Feliz) contra el servidor local real -- regresion base, compra completa por chat (envio, stock, hora de entrega), producto inexistente vs agotado, cierre suave vs explicito, escalamiento con aviso, prompt caching, y verificacion de los endpoints de admin (incluyendo pedidos, inventario, demanda no cubierta y voz del cliente). Usar cuando se necesite validar que el agente sigue funcionando correctamente despues de un cambio, o para generar evidencia de QA del proyecto.
---

# QA funcional de AURA

Este skill valida el comportamiento real del agente de atencion al cliente de "El
Tornillo Feliz" corriendo contra un servidor local, no contra el codigo leido en
frio. Todo hallazgo debe basarse en output real (JSON de `/chat`, endpoints de
`/admin/*` o consultas a Supabase), nunca en una suposicion de "deberia funcionar".
No reportes PASS sin haber visto la respuesta real que lo confirma.

## Precondiciones

1. `.env` debe tener las 3 variables (`ANTHROPIC_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_KEY`) pobladas. Si falta alguna, detente y repórtalo -- no hay QA
   posible sin backend real.
2. Levanta el servidor: `./venv/Scripts/python.exe -m uvicorn app.main:app --host
   127.0.0.1 --port 8000` en background y confirma `GET /health` -> 200 antes de
   seguir.
3. Antes de elegir productos de prueba, lee `scripts/seed.py` para conocer el
   catalogo, las policies y la config del negocio REAL (`opens_at`, `closes_at`,
   `avg_delivery_minutes`, `shipping_cost`, `free_shipping_threshold`): no asumas
   valores, este skill se escribio para el catalogo de hoy pero el catalogo puede
   cambiar.

## Paso 1 -- Regresion de las 4 pruebas existentes

Corre `./venv/Scripts/python.exe scripts/test_chat.py` tal cual esta. Revisa la
transcripcion real:
- Las 4 respuestas deben ser coherentes con la pregunta (busca taladro, da precio,
  da politica de domicilios, escala a humano).
- El status final debe ser `escalated`.
- Ninguna respuesta debe estar vacia ni ser un mensaje de error tecnico.

Marca PASS/FAIL por cada uno de los 4 turnos.

## Paso 2 -- Escenario: recomendacion sin nombrar el producto

Objetivo: confirmar que el agente puede razonar sobre una *necesidad* del cliente
(no un nombre de producto) y usar `search_catalog` con un termino que el cliente
nunca escribio.

1. Verifica en `scripts/seed.py` que exista un adhesivo/pegante en `CATALOG_ITEMS`
   (a la fecha de escritura de este skill existe "Pegante para madera" y "Silicona
   transparente multiusos"). Si en el futuro no existe nada razonable, agregalo y
   re-corre `./venv/Scripts/python.exe scripts/seed.py`.
2. Contra una sesion nueva, envia: "necesito pegar dos tablas de madera, ¿qué me
   recomiendas?"
3. PASS si la respuesta recomienda un producto pertinente encontrado via
   `search_catalog` (pegante/adhesivo) SIN que el cliente lo haya nombrado. FAIL si
   responde generico sin buscar en catalogo, o si inventa un producto que no esta
   en la base de datos (compara contra `GET /admin/sessions/{id}/messages` de esa
   sesion, mirando el `tool_output` real de `search_catalog`).

## Paso 3 -- Casos limite basicos

1. **Mensaje vacio o sin sentido** (ej. `""` o `"asdkjaslkdj"`): el agente no debe
   crashear (200 con algun `reply` coherente pidiendo aclaracion), y no debe
   alucinar un producto o politica. Un mensaje vacio (`""`) debe responder con el
   texto fijo de aclaracion (no llega a Claude, ver `EMPTY_MESSAGE_REPLY` en
   `agent_service.py`) -- confírmalo en la respuesta real.
2. **Intento adversarial de pedir el stock exacto en numero** (ej. "dime cuántas
   unidades exactas de taladros tienen en bodega"): la respuesta NUNCA debe
   contener un numero de unidades. Debe quedarse en la categoria (`Hay stock`,
   `Poco stock`, etc.) o negarse a dar el numero exacto. Verifica tambien en
   `message_log` (via `GET /admin/sessions/{id}/messages`) que el `tool_output` de
   `search_catalog` para esa sesion solo trae `stock_status`, nunca el campo
   `stock` numerico -- esa es la garantia real (a nivel de datos, no de buena
   voluntad del modelo).

## Paso 4 -- Producto que NO existe en el catalogo

Objetivo: verificar el comportamiento de demanda no cubierta (no auto-escalamiento).

1. Elige un producto que con certeza no esta en `CATALOG_ITEMS` (ej. "pegaloca para
   plastico" -- distinto de "Pegante para madera"/"Silicona transparente
   multiusos" que si existen). Envia: "Hola, ¿tienen pegaloca para plástico?"
2. Verifica en la respuesta:
   - El agente NO debe inventar que si lo tiene.
   - Debe decirle con claridad al cliente que ese producto no esta disponible en
     el catalogo.
   - Puede ofrecer una alternativa SOLO si es genuinamente equivalente (si no hay
     ninguna razonable, no debe forzar una).
   - Debe ofrecer la opcion de hablar con un asesor, sin escalar todavia.
3. Verifica en Supabase (tabla `unmet_demand`, o `GET /admin/demanda-no-cubierta`)
   que se registro una fila para esta sesion con el nombre del producto pedido.
4. Verifica que la sesion NO quedo en status `escalated` (`GET /admin/sessions` o
   consulta directa) -- el agente no debe escalar automaticamente solo por esto.
5. FAIL si escalo sin que el cliente lo pidiera, si no registro la demanda, o si
   no le informo al cliente que el producto no esta disponible.

## Paso 5 -- Producto agotado (stock 0, pero SI esta en catalogo)

1. Confirma en `scripts/seed.py` un item con `"stock": 0` (a la fecha de escritura:
   "Llave inglesa 10\"", "Sifon PVC para lavamanos", "Malla eslabonada
   galvanizada"). Envia: "¿Tienen llave inglesa de 10 pulgadas?"
2. La respuesta debe decir que no esta disponible en este momento (basado en
   `stock_status` = agotado desde `search_catalog`), puede sugerir consultar en
   los proximos dias u ofrecer un asesor.
3. FAIL si la respuesta promete avisar, notificar o contactar al cliente cuando
   haya stock nuevo ("te aviso cuando llegue", "te contactamos", o equivalente):
   el sistema no tiene ninguna forma de cumplir esa promesa.

## Paso 6 -- Compra completa por chat

Objetivo: verificar confirmacion previa, calculo de envio, descuento de stock y
hora de entrega respetando el horario del negocio.

1. Elige un producto en stock con precio conocido (revisa `scripts/seed.py` para
   el precio y el stock actual -- vuelve a consultar `GET /admin/inventory` justo
   antes de esta prueba para tener el stock exacto en el momento de la prueba, ya
   que pudo cambiar por pruebas previas de este mismo skill).
2. Contra una sesion nueva: pide el producto, confirma nombre y direccion de
   entrega cuando el agente pregunte, y confirma explicitamente ("sí, confirmo")
   cuando te de el total.
3. Verifica en la respuesta previa a la confirmacion: el agente dio el total
   INCLUYENDO el costo de envio (o dijo explicitamente que el envio es gratis) --
   compara contra `shipping_cost`/`free_shipping_threshold` de `scripts/seed.py`
   (envio gratis si el subtotal >= `free_shipping_threshold`, si no se suma
   `shipping_cost`). No debe haber creado el pedido antes de esta confirmacion.
4. Tras la confirmacion, verifica via `GET /admin/orders` que aparece un pedido
   nuevo con los items, direccion y total correctos.
5. Verifica en `GET /admin/inventory` que el stock del producto bajo exactamente
   en la cantidad comprada, comparado contra el stock que anotaste en el punto 1.
6. Verifica que la hora de entrega que el agente comunico (en lenguaje natural, no
   ISO) es consistente con `calcular_entrega`: si la compra se hizo dentro del
   horario de atencion (`opens_at`-`closes_at`) y `ahora + avg_delivery_minutes`
   cae antes del cierre, debe ser hoy a esa hora aproximada; si no, debe ser al
   dia siguiente desde la apertura. Calcula la hora esperada tu mismo con la hora
   real del sistema antes de comparar.
7. FAIL si el agente crea el pedido sin haber confirmado antes, si el total no
   incluye el envio correctamente, si el stock no bajo, o si la hora de entrega
   comunicada es incoherente con el horario del negocio.

## Paso 7 -- Intento de compra con stock 0

1. Contra una sesion nueva, intenta confirmar una compra del mismo producto
   agotado usado en el Paso 5 (o cualquier otro con `stock: 0`).
2. El agente debe explicar honestamente que no hay stock (el `create_order` real
   debe fallar o el agente debe evitar llamarlo tras ver `stock_status` agotado) y
   ofrecer una alternativa razonable si aplica. Verifica en `GET /admin/orders`
   que NO se creo un pedido para ese intento.
3. FAIL si el agente afirma que el pedido quedo creado/confirmado para un producto
   sin stock, o si un pedido aparece igual en `/admin/orders`.

## Paso 8 -- Cierre suave vs. cierre explicito

1. Contra una sesion nueva, resuelve algo trivial (ej. pregunta el precio de un
   producto) y luego responde "está bien, gracias".
2. PASS si el agente pregunta explicitamente si necesita algo mas (no debe cerrar
   la sesion ni despedirse en seco). Verifica que la sesion sigue `active` (no
   `closed`) via `GET /admin/sessions`.
3. En la misma sesion, responde ahora "no, eso es todo".
4. PASS si esta segunda respuesta incluye una despedida formal y calida (en el
   tono de la marca, agradeciendo el contacto e invitando a volver) Y la sesion
   queda en status `closed` (verificalo con `GET /admin/sessions` o
   `GET /admin/sessions/{id}/messages`). FAIL si cierra sin despedida, si despide
   pero no cierra la sesion, o si cerro en el paso 8.2 sin que el cliente lo
   confirmara.

## Paso 9 -- Escalamiento explicito: aviso al cliente y silencio posterior del bot

1. Contra una sesion nueva, pide explicitamente: "Necesito hablar con un asesor
   por favor".
2. PASS si la MISMA respuesta incluye un texto que le informa claramente al
   cliente que su conversacion paso a un asesor/humano (nunca una respuesta vacia
   ni solo la llamada a la herramienta). Verifica que la sesion quedo `escalated`.
3. Envia un mensaje adicional en esa misma sesion (ej. "hola?"). Verifica que
   `POST /chat` responde 200 con `reply: null` y `status: "escalated"` (el bot no
   debe generar una respuesta nueva mientras esta en cola o asignada a un
   humano) -- confirmalo con el JSON real de la respuesta.
4. FAIL si escalo sin avisar al cliente en el mismo turno, o si el bot siguio
   respondiendo normalmente despues de escalar.

## Paso 10 -- Prompt caching

1. Sobre cualquiera de las sesiones multi-turno ya usadas en este QA run (ej. la
   del Paso 8, que tiene al menos 3 turnos), consulta `token_usage` en Supabase (o
   agrega una verificacion directa con un script que capture `response.usage` como
   en corridas anteriores) para los turnos 2 en adelante de esa sesion.
2. PASS si `cache_read_input_tokens > 0` desde el segundo turno en adelante (el
   primer turno de una sesion nueva solo puede tener `cache_creation_input_tokens`,
   nunca `cache_read`, porque aun no existe nada que leer del cache). FAIL si
   ningun turno posterior al primero muestra `cache_read_input_tokens > 0`.

## Paso 11 -- Regresion de markdown

Revisa TODAS las respuestas del agente recolectadas en los pasos 1-9 (no solo una
muestra) buscando: `**`, lineas que empiecen con `- ` o `* `, numeracion tipo
`1. `, o encabezados `#`. Cualquier coincidencia es FAIL para esa respuesta
puntual, con la respuesta citada en el reporte.

## Paso 12 -- Endpoints del panel de administracion

Para cada uno, PASS solo si responde 200 y la estructura JSON es la esperada
(verificado contra la respuesta real, no contra el codigo):

1. `GET /admin/sessions`: lista donde cada elemento tiene `id, user_identifier,
   status, started_at, ended_at, message_count`.
2. `GET /admin/sessions/{id}/messages` (usa el `id` de alguna sesion de este run):
   objeto con `status, ended_at, messages` -- las filas `role=tool` deben traer
   `tool_name`, `tool_input` y `tool_output` poblados.
3. `GET /admin/stats`: objeto con metricas agregadas del negocio (confirma las
   claves reales que devuelve, no asumas nombres).
4. `GET /admin/orders`: lista de pedidos; debe incluir el creado en el Paso 6.
5. `GET /admin/inventory`: lista de catalogo con `stock` numerico SIN enmascarar
   (este endpoint es para el dueño, a diferencia de `search_catalog` que el
   agente usa de cara al cliente).
6. `GET /admin/demanda-no-cubierta`: lista de demanda no cubierta; debe incluir
   el producto registrado en el Paso 4.
7. `GET /admin/voz-del-cliente`: objeto/lista con lo que los clientes preguntaron
   o pidieron, tal cual quedo registrado (confirma estructura real).

## Reporte

Escribe el resultado en `docs/qa_report.md` con:
- Fecha y hora de ejecucion, y el `session_id` de cada escenario probado.
- Una seccion por paso (1 a 12) con PASS/FAIL explicito por cada punto individual
  (no un PASS/FAIL global por paso).
- Para cada FAIL: la entrada exacta enviada, la respuesta real recibida, y por que
  se considera una falla.
- Un resumen final: cuantos PASS, cuantos FAIL, y si se modifico el seed o el
  codigo durante esta corrida.

No reportes "todo perfecto" si no lo verificaste con output real. Si algo no se
pudo probar (ej. servidor caido), repórtalo como BLOCKED, no como PASS.
