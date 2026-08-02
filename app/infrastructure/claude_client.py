from functools import lru_cache
from typing import Any

from anthropic import Anthropic

from app.core.config import settings


@lru_cache
def get_claude_client() -> Anthropic:
    kwargs: dict[str, Any] = {"api_key": settings.anthropic_api_key}
    if settings.anthropic_base_url:
        kwargs["base_url"] = settings.anthropic_base_url
    return Anthropic(**kwargs)
