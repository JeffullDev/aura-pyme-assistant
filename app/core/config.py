import os

from dotenv import load_dotenv

load_dotenv()

DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5"

# Precios de referencia por millon de tokens (USD). Son valores APROXIMADOS basados
# en el pricing publico conocido de Claude Sonnet ($3/M input, $15/M output) al
# momento de escribir esto — NO son autoritativos. Antes de usarlos para facturacion
# real, verificar y actualizar contra el pricing vigente en https://www.anthropic.com/pricing
PRICE_PER_MILLION_INPUT_TOKENS = 3.0
PRICE_PER_MILLION_OUTPUT_TOKENS = 15.0


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
