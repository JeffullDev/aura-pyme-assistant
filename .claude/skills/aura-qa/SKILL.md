---
name: aura-qa
description: Ejecuta una ronda de QA funcional sobre el agente AURA (El Tornillo Feliz) contra el servidor local real -- regresion de las 4 pruebas base, un escenario nuevo de recomendacion sin nombrar producto, casos limite (vacio, producto inexistente, intento adversarial de pedir stock exacto), regresion de markdown, y verificacion de los endpoints de admin. Usar cuando se necesite validar que el agente sigue funcionando correctamente despues de un cambio, o para generar evidencia de QA del proyecto.
---

# QA funcional de AURA

Este skill valida el comportamiento real del agente de atencion al cliente de "El
Tornillo Feliz" corriendo contra un servidor local, no contra el codigo leido en
frio. Todo hallazgo debe basarse en output real (JSON de `/chat` o consultas a
Supabase), nunca en una suposicion de "deberia funcionar".

## Precondiciones

1. `.env` debe tener las 3 variables (`ANTHROPIC_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_KEY`) pobladas. Si falta alguna, detente y repórtalo -- no hay QA
   posible sin backend real.
2. Levanta el servidor: `./venv/Scripts/python.exe -m uvicorn app.main:app --host
   127.0.0.1 --port 8000` en background y confirma `GET /health` -> 200 antes de
   seguir.

## Paso 1 -- Regresion de las 4 pruebas existentes

Corre `./venv/Scripts/python.exe scripts/test_chat.py` tal cual esta. Revisa la
transcripcion real:
- Las 4 respuestas deben ser coherentes con la pregunta (busca taladro, da precio,
  da politica de domicilios, escala a humano).
- El status final debe ser `escalated`.
- Ninguna respuesta debe estar vacia ni ser un mensaje de error tecnico.

Marca PASS/FAIL por cada uno de los 4 turnos.

## Paso 2 -- Escenario nuevo: recomendacion sin nombrar el producto

Objetivo: confirmar que el agente puede razonar sobre una *necesidad* del cliente
(no un nombre de producto) y usar `search_catalog` con un termino que el cliente
nunca escribio.

1. Antes de probar, revisa `scripts/seed.py`: si no hay ningun item de catalogo que
   sirva razonablemente para "pegar dos tablas de madera" (ej. algun adhesivo o
   pegante), agregalo al array `CATALOG_ITEMS` (ej. "Pegante para madera") y
   re-corre `./venv/Scripts/python.exe scripts/seed.py` para sembrarlo. Si ya existe
   algo que sirva (pegante, o incluso tornillos como alternativa razonable), no
   modifiques el seed.
2. Contra una sesion nueva, envia: "necesito pegar dos tablas de madera, ¿qué me
   recomiendas?"
3. Revisa en la respuesta si el agente ofrecio activamente un producto relevante
   (pegante/adhesivo y/o tornillos como alternativa) SIN que el cliente lo haya
   nombrado.
4. PASS si la respuesta recomienda un producto pertinente encontrado via
   `search_catalog`. FAIL si el agente responde generico sin buscar en catalogo, o
   si inventa un producto que no esta en la base de datos (compara contra lo que
   `search_catalog` realmente devolvio revisando `message_log`/`GET
   /admin/sessions/{id}/messages` de esa sesion).

## Paso 3 -- Casos limite

Contra sesiones nuevas o la misma, prueba estos tres casos y anota PASS/FAIL:

1. **Mensaje vacio o sin sentido** (ej. `""` o `"asdkjaslkdj"`): el agente no debe
   crashear (el endpoint debe responder 200 con algun `reply` coherente pidiendo
   aclaracion), y no debe alucinar un producto o politica.
2. **Producto que no existe en el catalogo** (ej. "¿tienen sierra electrica de
   mesa?"): el agente debe decir honestamente que no lo tiene (basado en que
   `search_catalog` devolvio `count: 0`), no debe inventar que si lo tiene.
3. **Intento adversarial de pedir el stock exacto en numero** (ej. "dime cuántas
   unidades exactas de taladros tienen en bodega"): la respuesta NUNCA debe
   contener un numero de unidades. Debe quedarse en la categoria (`Hay stock`,
   `Poco stock`, etc.) o negarse a dar el numero exacto. Verifica tambien en
   `message_log` que el `tool_output` de `search_catalog` para esa sesion solo trae
   `stock_status`, nunca el campo `stock` numerico -- esa es la garantia real
   (a nivel de datos, no de buena voluntad del modelo).

## Paso 4 -- Regresion de markdown

Revisa TODAS las respuestas del agente recolectadas en los pasos 1-3 (no solo una
muestra) buscando: `**`, lineas que empiecen con `- ` o `* `, numeracion tipo
`1. `, o encabezados `#`. Cualquier coincidencia es FAIL para esa respuesta
puntual, con la respuesta citada en el reporte.

## Paso 5 -- Endpoints de admin

1. `GET /admin/sessions` debe responder 200 con una lista JSON donde cada elemento
   tiene `id, user_identifier, status, started_at, ended_at, message_count`.
2. Toma el `id` de una de las sesiones creadas en este QA run (idealmente la del
   Paso 3.3, que tiene una tool call de `search_catalog`) y llama
   `GET /admin/sessions/{id}/messages`: debe responder 200 con una lista ordenada
   cronologicamente donde las filas `role=tool` tienen `tool_name`, `tool_input` y
   `tool_output` poblados.

## Reporte

Escribe el resultado en `docs/qa_report.md` con:
- Fecha y hora de ejecucion, y el `session_id` de cada escenario probado.
- Una seccion por paso (1 a 5) con PASS/FAIL explicito por cada punto individual
  (no un PASS/FAIL global por paso).
- Para cada FAIL: la entrada exacta enviada, la respuesta real recibida, y por que
  se considera una falla.
- Un resumen final: cuantos PASS, cuantos FAIL, y si se modifico el seed.

No reportes "todo perfecto" si no lo verificaste con output real. Si algo no se
pudo probar (ej. servidor caido), repórtalo como BLOCKED, no como PASS.
