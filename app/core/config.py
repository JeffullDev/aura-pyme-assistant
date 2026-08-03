import os

from dotenv import load_dotenv

load_dotenv()

DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5"

# Precios de referencia por millon de tokens (USD), precio introductorio de
# Claude Sonnet 5 vigente HASTA EL 31 DE AGOSTO DE 2026. Despues de esa fecha
# el precio regular sube a $3/M input y $15/M output — hay que actualizar
# estas dos constantes ese dia. Verificar contra https://www.anthropic.com/pricing
PRICE_PER_MILLION_INPUT_TOKENS = 2.0
PRICE_PER_MILLION_OUTPUT_TOKENS = 10.0

# Multiplicadores de prompt caching sobre PRICE_PER_MILLION_INPUT_TOKENS (no
# aplican a output). TTL efimero de 5 minutos (el default): lectura de cache
# cuesta 0.1x, escritura cuesta 1.25x. Ver app/core/agent_service.py.
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Opcional: si se define, apunta el SDK a un gateway/proxy en vez del endpoint por defecto.
    anthropic_base_url: str | None = os.getenv("ANTHROPIC_BASE_URL") or None
    claude_model: str = os.getenv("CLAUDE_MODEL") or DEFAULT_CLAUDE_MODEL
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_KEY", "")
    # CORS: dominios permitidos para incrustar el widget (app/static/widget.js)
    # en sitios de clientes. Lista separada por comas en ALLOWED_ORIGINS.
    # Fallback a "*" SOLO si la variable no esta definida (comodo para probar
    # el widget en local) -- en un despliegue real esto debe restringirse a
    # los dominios reales de los clientes que incrustan el widget.
    allowed_origins: list[str] = [
        origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()
    ] or ["*"]


settings = Settings()
