# AURA — Asistente de atención al cliente con IA para PyMEs

Proyecto de hackathon (48h, solitario). AURA es un asistente conversacional que
entiende consultas de clientes, resuelve con la base de conocimiento del negocio
(catálogo, políticas), responde con el tono de marca del negocio, recomienda
productos y escala a un humano cuando hace falta — dejando trazabilidad completa
de cada conversación.

Negocio de ejemplo (ficticio, sin datos reales): **El Tornillo Feliz**, una ferretería.

El proyecto incluye: el motor del agente (tool use nativo con Claude) detrás de
`POST /chat`, un frontend de chat tipo widget (`/`), un panel de administración
de solo lectura con trazabilidad completa de cada conversación y métricas de
consumo de tokens/costo (`/admin`), y una calculadora de costo standalone para
dueños de PyME (`docs/artifact_calculadora_roi.html`, sin backend, 100% local).

## Stack

- Python 3.12 + FastAPI (async)
- Supabase (Postgres) vía `supabase-py`
- Anthropic Claude (Messages API, tool use) — llamadas directas al SDK, sin frameworks de orquestación
- Arquitectura por capas: `app/api` (endpoints), `app/core` (config/dominio), `app/infrastructure` (integraciones externas como Supabase)

## Cómo correrlo localmente

### 1. Requisitos
- Python 3.12+
- Una cuenta de Supabase con un proyecto creado
- Una API key de Anthropic

### 2. Instalar dependencias

```bash
python -m venv venv
source venv/bin/activate  # en Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Completa en `.env`:
- `ANTHROPIC_API_KEY`: tu API key de Anthropic
- `SUPABASE_URL`: URL de tu proyecto Supabase
- `SUPABASE_KEY`: service role key o anon key de tu proyecto Supabase

### 4. Ejecutar las migraciones

Copia el contenido de `db/migrations/001_init.sql` y ejecútalo en el **SQL Editor**
de tu proyecto Supabase (o usa la CLI de Supabase si la tienes configurada). Luego
haz lo mismo, en orden, con `002_token_usage.sql`, `003_business_config.sql`,
`004_knowledge.sql` y `005_orders.sql` — son secuenciales, corre las cinco antes
de seguir.

### 5. Cargar datos de ejemplo (seed)

```bash
python scripts/seed.py
python scripts/load_knowledge.py
```

`seed.py` crea el negocio "El Tornillo Feliz" (incluida su config estructurada de
horario/domicilios), su catálogo y sus políticas. `load_knowledge.py` carga
`db/knowledge/tornillo_feliz.md` (guías, consejos, historia del negocio) en la
tabla `knowledge_base`, partiendo el markdown por encabezados `##`. Ambos scripts
son idempotentes: si ya existen datos para el business, no vuelven a insertar
nada, así que puedes correrlos varias veces sin duplicar datos.

### 6. Levantar el servidor

```bash
uvicorn app.main:app --reload
```

Verifica que todo esté conectado en [http://localhost:8000/health](http://localhost:8000/health).
El chat queda disponible en [http://localhost:8000/](http://localhost:8000/) y el
panel de administración en [http://localhost:8000/admin](http://localhost:8000/admin).
También puedes correr `python scripts/test_chat.py` con el servidor levantado para
ver una conversación completa de extremo a extremo (catálogo, políticas y
escalamiento) contra `POST /chat`.

## Estructura del proyecto

```
app/
  api/             # endpoints HTTP (routers): health, chat, admin
  core/            # configuración y lógica de dominio (agente, tools, pricing)
  infrastructure/  # integraciones externas (Supabase, Anthropic)
  static/          # frontend plano: chat (index.html) y panel admin (admin.html)
  main.py          # entrypoint de FastAPI
db/
  migrations/      # SQL de migraciones, versionado por número
  knowledge/       # markdown fuente de la base de conocimiento (guías, consejos)
docs/
  qa_report.md                    # reporte de QA ejecutado contra el sistema real
  security_audit.md               # auditoría de seguridad ejecutada contra el sistema real
  artifact_calculadora_roi.html   # calculadora de costo standalone (sin backend)
scripts/
  seed.py            # carga de datos de ejemplo (idempotente)
  load_knowledge.py  # carga db/knowledge/*.md en knowledge_base (idempotente)
  test_chat.py       # prueba de extremo a extremo contra POST /chat
```

## Razonamiento de diseño

**FastAPI + async**: overhead mínimo para un MVP, tipado nativo con Pydantic, y el
modelo async encaja bien con llamadas I/O-bound (Supabase, Anthropic) sin bloquear
el event loop — relevante cuando el agente puede hacer varias idas y vueltas de
tool use antes de responder.

**Supabase como base de datos**: Postgres gestionado con setup casi instantáneo,
ideal para 48h. No usamos features realtime/auth de Supabase en este MVP — solo
la base de datos relacional vía `supabase-py`, manteniendo la puerta abierta a
usarlas después sin cambiar de proveedor.

**Claude vía Messages API con tool use, sin frameworks de orquestación**: para un
agente con alcance acotado (consultar catálogo, políticas, decidir si escalar),
una capa de orquestación como LangChain agrega indirección y superficie de bugs
sin aportar valor proporcional en 48h. Tool use nativo del SDK de Anthropic da
control directo sobre qué herramientas ve el modelo y cómo se ejecutan, que es
justo lo que se evalúa en el reto (uso técnico de Claude).

**Modelo de datos — por qué estas tablas**:
- `business` centraliza la identidad del negocio y, clave para el reto, el
  `tone_prompt`: la instrucción de tono de marca que el agente inyecta en su
  system prompt. Esto hace que el mismo motor de agente sirva a distintos
  negocios sin tocar código. También guarda la config estructurada del negocio
  (`opens_at`, `closes_at`, `avg_delivery_minutes`, `shipping_cost`,
  `free_shipping_threshold`): son la fuente de verdad para cálculos, mientras
  que el texto de `policy` existe solo para responder conversacionalmente y
  debe mantenerse coherente con esos valores.
- `catalog_item` y `policy` son la base de conocimiento estructurada que el
  agente consulta vía tool use para responder con hechos del negocio en vez de
  alucinar. `policy.topic` está acotado a un set fijo (horario/domicilios/
  garantía/pago) porque son las categorías de consulta más comunes en atención
  al cliente PyME.
- `knowledge_base` complementa a las dos anteriores con contenido narrativo más
  largo (guías de uso, consejos, historia del negocio) que no encaja en datos
  estructurados de precio/stock ni en un topic fijo de política. Se consulta
  vía la tool `search_knowledge` con el mismo enfoque de búsqueda por palabra
  clave que `search_catalog`.
- `orders` y `order_items` registran los pedidos que el agente toma por chat vía
  la tool `create_order`. `order_items` guarda un snapshot de `product_name` y
  `unit_price` al momento de la compra (no solo el FK a `catalog_item`): si el
  precio del catálogo cambia después, el pedido histórico conserva el precio
  real que se cobró.
- `chat_session` y `message_log` separan la sesión (quién, cuándo, en qué estado)
  del log de mensajes (qué se dijo). `message_log` guarda `tool_name`,
  `tool_input` y `tool_output` además de `content` para dejar trazabilidad
  completa de cada decisión del agente — no solo el texto final, sino qué
  herramienta uso y con qué datos, que es lo que pide el reto en cuanto a
  trazabilidad de conversaciones.
- Todas las tablas de negocio usan UUID como PK para evitar colisiones si en el
  futuro se necesita mergear datos de múltiples fuentes o entornos.
