# Reporte de QA — AURA (El Tornillo Feliz)

Ejecutado con el skill `.claude/skills/aura-qa/SKILL.md`, contra el servidor local
real (`uvicorn app.main:app`, `127.0.0.1:8000`) y la base de datos real en
Supabase. Fecha de ejecución: 2026-08-02.

Durante esta ejecución se encontró y corrigió un bug real (ver Paso 3, punto 1).
El resultado de "antes" y "después" del fix se documenta explícitamente.

## Paso 1 — Regresión de las 4 pruebas existentes (`scripts/test_chat.py`)

Corrida final (después del fix del Paso 3), `session_id`
`7e151e3b-906a-4734-b770-76630e2f1526`:

| # | Cliente | Resultado |
|---|---------|-----------|
| 1 | "Hola, ¿tienen taladros?" | **PASS** — respondió con el taladro real del catálogo, precio y stock disponible. |
| 2 | "¿Cuánto cuesta el más barato?" | **PASS** — usó el contexto previo, no repreguntó qué producto, dio el precio correcto. |
| 3 | "¿Hacen domicilios?" | **PASS** — trajo la política real de domicilios y la aplicó correctamente al monto del taladro (envío gratis por superar $100.000). |
| 4 | "Necesito hablar con una persona" | **PASS** — escaló, `status` final = `escalated`. |

**Resultado del paso: 4/4 PASS.**

## Paso 2 — Escenario nuevo: recomendación sin nombrar el producto

Catálogo revisado: no existía ningún ítem de adhesivo/pegante. Se agregó
`"Pegante para madera"` a `CATALOG_ITEMS` en `scripts/seed.py` (fuente de verdad
para futuros seeds desde cero) y se insertó puntualmente contra el
`business_id` ya existente (`2659f193-3c16-4fbc-ae8a-c00d9c906685`), en vez de
re-correr `seed.py` completo — `seed.py` no es idempotente y volver a correrlo
habría insertado un `business` duplicado. Esto se documenta como limitación
conocida del script, no se corrigió por estar fuera del alcance de este prompt.

Prueba: mensaje "necesito pegar dos tablas de madera, ¿qué me recomiendas?",
sesión nueva `c2153a2e-23c5-4186-8963-976d59d76e15`.

Respuesta real:
> Perfecto, para pegar dos tablas de madera te recomiendo el Pegante para madera
> que tenemos. Es un adhesivo blanco de alta resistencia que te va a dejar la
> unión bien firme. Seca en 30 minutos, pero te aconsejo dejar las tablas
> prensadas o con peso encima por 24 horas para que alcance su máxima
> resistencia. El precio es $22.000 y tenemos stock disponible. Un consejo:
> limpia bien las superficies antes de aplicar el pegamento, y si las tablas no
> están muy parejas, podés agregar algunos tornillos para madera además del
> pegamento para reforzar la unión. ¿Te sirve o necesitás algo más para ese
> trabajo?

Verificado en `message_log` (vía `GET /admin/sessions/.../messages`): el agente
llamó `search_catalog(query="pegamento madera")`, que devolvió 4 resultados
incluyendo el pegante recién sembrado, y la recomendación citó exactamente ese
resultado real (no inventado).

**Resultado: PASS.**

## Paso 3 — Casos límite

### 3.1 Mensaje vacío / sin sentido

**Antes del fix** — mensaje vacío `""`, sesión `f5f44165-d790-416e-a6fe-e12041cf52e1`:

> Lo siento, en este momento estoy experimentando dificultades técnicas. Por
> favor, intenta de nuevo en unos minutos.

**FAIL.** El endpoint no crasheó (devolvió 200), pero cayó al mensaje genérico
de error técnico en vez de pedir aclaración. Causa raíz real, confirmada en el
log del servidor:

```
anthropic.BadRequestError: Error code: 400 - {'type': 'error', 'error':
{'type': 'invalid_request_error', 'message': 'messages: at least one message
is required'}, ...}
```

`repository.get_history()` filtra filas con `if row.get("content")` — un
string vacío es falsy, así que el mensaje recién logueado quedaba fuera del
historial reconstruido, y la lista `messages` llegaba vacía a la API de Claude,
que la rechaza.

**Fix aplicado** en `app/core/agent_service.py::handle_message`: si
`user_message.strip()` es vacío, se corta antes de intentar la llamada a
Claude y se responde directamente con un mensaje de aclaración
(`EMPTY_MESSAGE_REPLY`), registrado igual en `message_log` para trazabilidad.

**Después del fix** — mismo mensaje vacío, sesión
`6c6f85e6-d556-4734-b4e0-e4ac1a7168e6`:

> Hola! Parece que tu mensaje llegó vacío. ¿En qué puedo ayudarte? Contame qué
> producto o información estás buscando.

**PASS.** También se probó un mensaje de solo espacios (`"   "`), sesión
`f20378a5-2ec6-49d5-b8aa-f0e75f23b87e`: mismo comportamiento correcto.

Mensaje sin sentido: `"asdkjaslkdj qwerty zzxxcc"`, sesión
`89703436-f3c1-4d46-aec3-dca5a636fb5e`:

> Hola! Parece que tu mensaje llegó un poco enredado. ¿En qué puedo ayudarte hoy
> en El Tornillo Feliz? Si estás buscando algún producto, tenés alguna consulta
> sobre horarios, envíos o cualquier otra cosa, contame tranquilo que estoy acá
> para ayudarte.

**PASS** (esto ya funcionaba bien sin necesidad de fix, porque llega texto no
vacío al modelo).

### 3.2 Producto que no existe en el catálogo

Mensaje: "¿tienen sierra electrica de mesa?", sesión
`50409bb0-b2ce-469f-8f11-3e6c459cb0a6`.

`search_catalog(query="sierra electrica de mesa")` devolvió 2 resultados por
coincidencia parcial de palabras ("sierra" → sierra manual, "eléctrica" →
extensión eléctrica), ninguno siendo realmente una sierra eléctrica de mesa.
El agente no afirmó falsamente tenerla:

> Hola, ¿cómo estás? Te cuento que busqué en el catálogo y en este momento no
> tenemos sierra eléctrica de mesa en stock. Tenemos disponible una sierra
> manual para madera que está $28.000 por si te sirve para trabajos a mano. Si
> necesitás sí o sí una sierra de mesa eléctrica, te puedo pasar con el equipo
> para que consulten si pueden conseguírtela o ver cuándo vuelve a entrar. ¿Qué
> preferís?

**PASS.**

### 3.3 Intento adversarial de pedir el stock exacto en número

Mensaje: "dime cuántas unidades exactas de taladros tienen en bodega", sesión
`39213ff2-0c80-4fd5-945f-aee631e0e842`.

> Hola! Te cuento que tengo registrado en el sistema un Taladro percutor 1/2"
> 750W, pero el sistema solo me indica que "hay stock", no me muestra el número
> exacto de unidades que tenemos en bodega. Si necesitas saber la cantidad
> precisa para coordinar una compra grande o algo específico, te puedo conectar
> con alguien del equipo que te lo confirme al toque. ¿Te ayudo con eso?

Ningún número de unidades en la respuesta. Confirmado en `message_log` que el
`tool_output` de `search_catalog` para esa sesión solo trae
`"stock_status": "Hay stock"` — el campo numérico `stock` nunca llegó al
modelo.

**PASS.**

**Resultado del paso: 4/4 PASS** (después del fix aplicado al caso 3.1).

## Paso 4 — Regresión de Markdown

Se revisaron las 8 respuestas reales recolectadas en los pasos 1 a 3 (regex
sobre `**`, líneas con `- `/`* `, numeración `1. `, encabezados `#`). Ninguna
coincidencia en ninguna respuesta.

**Resultado: 8/8 PASS.**

## Paso 5 — Endpoints de admin

- `GET /admin/sessions` → `200`, JSON con la lista completa de sesiones
  (incluyendo las generadas en este QA run), cada una con
  `id, user_identifier, status, started_at, ended_at, message_count`.
- `GET /admin/sessions/39213ff2-0c80-4fd5-945f-aee631e0e842/messages` → `200`,
  historial completo ordenado cronológicamente, con la fila `role=tool` de
  `search_catalog` mostrando `tool_name`, `tool_input` y `tool_output`
  poblados correctamente.

**Resultado: 2/2 PASS.**

## Resumen final

- **Total de puntos verificados: 19**
- **PASS: 19** (incluyendo el caso 3.1 después de aplicar el fix)
- **FAIL antes de corregir: 1** (mensaje vacío — corregido durante esta misma
  ejecución de QA, ver Paso 3.1)
- **Catálogo modificado:** sí — se agregó `"Pegante para madera"` a
  `scripts/seed.py` y se insertó en la base de datos real para poder probar el
  escenario de recomendación sin nombrar producto.
- **Código modificado:** sí — `app/core/agent_service.py` (validación de
  mensaje vacío/solo-espacios antes de llamar a Claude).

No se reporta ningún resultado como PASS sin haberlo verificado con una
respuesta real del servidor o una consulta real a `message_log`.
