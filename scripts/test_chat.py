"""Prueba end-to-end del endpoint /chat contra el servidor local.

Envia 4 mensajes secuenciales reusando el mismo session_id para validar memoria,
uso de herramientas y escalamiento.
"""

import sys
from pathlib import Path

import httpx

sys.path.append(str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")

from app.infrastructure.supabase_client import get_supabase_client  # noqa: E402

BASE_URL = "http://localhost:8000"
USER_IDENTIFIER = "+573001234567"

MESSAGES = [
    "Hola, ¿tienen taladros?",
    "¿Cuánto cuesta el más barato?",
    "¿Hacen domicilios?",
    "Necesito hablar con una persona",
]


def _latest_token_usage(session_id: str) -> dict | None:
    """Trae la fila de token_usage mas reciente de la sesion: agent_service.py
    inserta una por turno (log_token_usage), sumando el usage de TODAS las
    llamadas a Claude hechas dentro de ese turno (ver _run_tool_loop)."""
    result = (
        get_supabase_client()
        .table("token_usage")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def main() -> None:
    session_id: str | None = None

    with httpx.Client(timeout=90.0) as client:
        for index, message in enumerate(MESSAGES, start=1):
            response = client.post(
                f"{BASE_URL}/chat",
                json={
                    "session_id": session_id,
                    "user_identifier": USER_IDENTIFIER,
                    "message": message,
                },
            )
            response.raise_for_status()
            data = response.json()
            session_id = data["session_id"]

            print(f"\n{'=' * 70}")
            print(f"[{index}] CLIENTE: {message}")
            print(f"{'-' * 70}")
            print(f"AURA: {data['reply']}")
            print(f"{'-' * 70}")
            print(f"status: {data['status']}  |  session_id: {session_id}")

            usage = _latest_token_usage(session_id)
            if usage:
                print(
                    f"cache_creation_input_tokens: {usage['cache_creation_input_tokens']}  |  "
                    f"cache_read_input_tokens: {usage['cache_read_input_tokens']}  |  "
                    f"input_tokens: {usage['input_tokens']}  |  output_tokens: {usage['output_tokens']}"
                )
            else:
                print("(sin fila de token_usage para este turno)")

    print(f"\n{'=' * 70}\nPrueba completada.")


if __name__ == "__main__":
    main()
