"""Prueba end-to-end del endpoint /chat contra el servidor local.

Envia 4 mensajes secuenciales reusando el mismo session_id para validar memoria,
uso de herramientas y escalamiento.
"""

import sys

import httpx

sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:8000"
USER_IDENTIFIER = "+573001234567"

MESSAGES = [
    "Hola, ¿tienen taladros?",
    "¿Cuánto cuesta el más barato?",
    "¿Hacen domicilios?",
    "Necesito hablar con una persona",
]


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

    print(f"\n{'=' * 70}\nPrueba completada.")


if __name__ == "__main__":
    main()
