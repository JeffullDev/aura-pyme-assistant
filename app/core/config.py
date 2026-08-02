import os

from dotenv import load_dotenv

load_dotenv()

DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5"


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Opcional: si se define, apunta el SDK a un gateway/proxy en vez del endpoint por defecto.
    anthropic_base_url: str | None = os.getenv("ANTHROPIC_BASE_URL") or None
    claude_model: str = os.getenv("CLAUDE_MODEL") or DEFAULT_CLAUDE_MODEL
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_KEY", "")


settings = Settings()
