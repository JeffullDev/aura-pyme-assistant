"""Prueba end-to-end del flujo de pedidos contra el servidor local.

Escenario 1 (sesion A): compra normal de un producto con stock -> confirmacion
explicita -> create_order -> check_order_status.
Escenario 2 (sesion B): intento de compra de un producto con stock 0 -> el
agente debe negarse a crear el pedido.
"""

import sys

import httpx

sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:8000"

ESCENARIO_1 = {
    "user_identifier": "+573009998877",
    "messages": [
        "Hola, quiero comprar 2 martillos de una",
        "Me llamo Juan Perez, envienlo a Calle 45 #12-30, Bogota",
        "Si, confirmo el pedido",
        "Cual es el estado de mi pedido?",
    ],
}

ESCENARIO_2 = {
    "user_identifier": "+573001112233",
    "messages": [
        "Hola, quiero comprar una llave inglesa",
        "Igual la quiero, mandenmela a Carrera 7 #20-15, Bogota, mi nombre es Maria Gomez",
    ],
}


def run_escenario(nombre: str, config: dict) -> None:
    session_id: str | None = None
    print(f"\n{'#' * 70}\n{nombre}\n{'#' * 70}")

    with httpx.Client(timeout=90.0) as client:
        for index, message in enumerate(config["messages"], start=1):
            response = client.post(
                f"{BASE_URL}/chat",
                json={
                    "session_id": session_id,
                    "user_identifier": config["user_identifier"],
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


def main() -> None:
    run_escenario("ESCENARIO 1: compra normal (producto con stock)", ESCENARIO_1)
    run_escenario("ESCENARIO 2: intento de compra (producto con stock 0)", ESCENARIO_2)
    print(f"\n{'=' * 70}\nPrueba completada.")


if __name__ == "__main__":
    main()
