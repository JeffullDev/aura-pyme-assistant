import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_KEY", "")


settings = Settings()
