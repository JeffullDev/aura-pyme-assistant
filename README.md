# AURA — Asistente de atención al cliente con IA para PyMEs

Proyecto de hackathon (48h, solitario). AURA es un asistente conversacional que
entiende consultas de clientes, resuelve con la base de conocimiento del negocio
(catálogo, políticas), responde con el tono de marca del negocio, recomienda
productos y escala a un humano cuando hace falta — dejando trazabilidad completa
de cada conversación.

Negocio de ejemplo (ficticio, sin datos reales): **El Tornillo Feliz**, una ferretería.

Este primer entregable cubre solo el **backend base**: estructura del proyecto,
modelo de datos, seed de datos de ejemplo y un endpoint `/health`. La lógica del
agente (tool use con Claude) y el endpoint `/chat` llegan en el siguiente prompt.
El frontend no está incluido en este alcance.

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

### 4. Ejecutar la migración

Copia el contenido de `db/migrations/001_init.sql` y ejecútalo en el **SQL Editor**
de tu proyecto Supabase (o usa la CLI de Supabase si la tienes configurada).

### 5. Cargar datos de ejemplo (seed)

```bash
python scripts/seed.py
```

Esto crea el negocio "El Tornillo Feliz", su catálogo y sus políticas.

### 6. Levantar el servidor

```bash
uvicorn app.main:app --reload
```

Verifica que todo esté conectado en [http://localhost:8000/health](http://localhost:8000/health).

## Estructura del proyecto

```
app/
  api/             # endpoints HTTP (routers)
  core/            # configuración y lógica de dominio
  infrastructure/  # integraciones externas (Supabase, Anthropic)
  main.py          # entrypoint de FastAPI
db/
  migrations/      # SQL de migraciones, versionado por número
scripts/
  seed.py          # carga de datos de ejemplo
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

**Modelo de datos — por qué estas 5 tablas**:
- `business` centraliza la identidad del negocio y, clave para el reto, el
  `tone_prompt`: la instrucción de tono de marca que el agente inyecta en su
  system prompt. Esto hace que el mismo motor de agente sirva a distintos
  negocios sin tocar código.
- `catalog_item` y `policy` son la base de conocimiento que el agente consulta
  vía tool use para responder con hechos del negocio en vez de alucinar.
  `policy.topic` está acotado a un set fijo (horario/domicilios/garantía/pago)
  porque son las categorías de consulta más comunes en atención al cliente PyME.
- `chat_session` y `message_log` separan la sesión (quién, cuándo, en qué estado)
  del log de mensajes (qué se dijo). `message_log` guarda `tool_name`,
  `tool_input` y `tool_output` además de `content` para dejar trazabilidad
  completa de cada decisión del agente — no solo el texto final, sino qué
  herramienta uso y con qué datos, que es lo que pide el reto en cuanto a
  trazabilidad de conversaciones.
- Todas las tablas de negocio usan UUID como PK para evitar colisiones si en el
  futuro se necesita mergear datos de múltiples fuentes o entornos.
