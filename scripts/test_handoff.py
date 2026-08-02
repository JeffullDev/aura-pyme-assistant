"""Prueba end-to-end del flujo de handoff a humano (v1.1 parte C) contra el
servidor local.

1. Cliente escribe y se escala (escalate_to_human).
2. El bot ya NO responde al siguiente mensaje del cliente (reply=null).
3. Un agente humano toma la conversacion (/admin/sessions/{id}/take).
4. El agente responde como humano (/admin/sessions/{id}/reply).
5. El cliente hace polling (/chat/{id}/messages) y ve la respuesta del agente.
"""

import sys

import httpx

sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:8000"
USER_IDENTIFIER = "+573005551234"
AGENT_NAME = "Camila"


def main() -> None:
    with httpx.Client(timeout=90.0) as client:
        print(f"\n{'=' * 70}\n1) Cliente pide hablar con una persona (debe escalar)\n{'=' * 70}")
        response = client.post(
            f"{BASE_URL}/chat",
            json={
                "session_id": None,
                "user_identifier": USER_IDENTIFIER,
                "message": "Necesito hablar con una persona, tengo un problema con mi pedido",
            },
        )
        response.raise_for_status()
        data = response.json()
        session_id = data["session_id"]
        print(f"AURA: {data['reply']}")
        print(f"status: {data['status']}  |  session_id: {session_id}")
        assert data["status"] == "escalated", f"esperaba 'escalated', llego '{data['status']}'"

        print(f"\n{'=' * 70}\n2) Cliente escribe de nuevo -> el bot debe estar suprimido (reply=null)\n{'=' * 70}")
        response = client.post(
            f"{BASE_URL}/chat",
            json={
                "session_id": session_id,
                "user_identifier": USER_IDENTIFIER,
                "message": "Hola? Sigo esperando",
            },
        )
        response.raise_for_status()
        data = response.json()
        print(f"AURA reply: {data['reply']!r}")
        print(f"status: {data['status']}")
        assert data["reply"] is None, f"el bot deberia estar suprimido, pero respondio: {data['reply']!r}"
        assert data["status"] == "escalated"

        print(f"\n{'=' * 70}\n3) Agente humano toma la conversacion\n{'=' * 70}")
        response = client.post(
            f"{BASE_URL}/admin/sessions/{session_id}/take",
            json={"agent_name": AGENT_NAME},
        )
        response.raise_for_status()
        take_data = response.json()
        print(take_data)
        assert take_data["status"] == "assigned"
        assert take_data["assigned_agent_name"] == AGENT_NAME

        print(f"\n{'=' * 70}\n4) Agente responde como humano\n{'=' * 70}")
        agent_message = "Hola! Soy Camila, ya estoy revisando tu pedido, dame un minuto."
        response = client.post(
            f"{BASE_URL}/admin/sessions/{session_id}/reply",
            json={"message": agent_message},
        )
        response.raise_for_status()
        print(response.json())

        print(f"\n{'=' * 70}\n5) Cliente escribe otra vez -> el bot sigue suprimido (status assigned)\n{'=' * 70}")
        response = client.post(
            f"{BASE_URL}/chat",
            json={
                "session_id": session_id,
                "user_identifier": USER_IDENTIFIER,
                "message": "Ok, gracias, espero",
            },
        )
        response.raise_for_status()
        data = response.json()
        print(f"AURA reply: {data['reply']!r}  |  status: {data['status']}")
        assert data["reply"] is None
        assert data["status"] == "assigned"

        print(f"\n{'=' * 70}\n6) Polling del cliente: debe ver el mensaje del agente\n{'=' * 70}")
        response = client.get(f"{BASE_URL}/chat/{session_id}/messages")
        response.raise_for_status()
        messages = response.json()
        for msg in messages:
            print(msg)
        agent_messages = [m for m in messages if m["role"] == "agent"]
        assert agent_messages, "no aparecio ningun mensaje role='agent' en el polling"
        assert agent_messages[0]["content"] == agent_message
        assert agent_messages[0]["tool_name"] == AGENT_NAME
        print("\nOK: el mensaje del agente aparece en el polling con el nombre correcto.")

        print(f"\n{'=' * 70}\n7) Polling incremental con `since` no debe repetir mensajes viejos\n{'=' * 70}")
        last_created_at = messages[-1]["created_at"]
        response = client.get(f"{BASE_URL}/chat/{session_id}/messages", params={"since": last_created_at})
        response.raise_for_status()
        incremental = response.json()
        print(f"mensajes nuevos desde {last_created_at}: {incremental}")
        assert incremental == []

        print(f"\n{'=' * 70}\n8) Agente devuelve la conversacion al bot\n{'=' * 70}")
        response = client.post(f"{BASE_URL}/admin/sessions/{session_id}/return-to-bot")
        response.raise_for_status()
        print(response.json())

        print(f"\n{'=' * 70}\n9) El bot retoma y ve el contexto del humano\n{'=' * 70}")
        response = client.post(
            f"{BASE_URL}/chat",
            json={
                "session_id": session_id,
                "user_identifier": USER_IDENTIFIER,
                "message": "Perfecto, gracias por la ayuda",
            },
        )
        response.raise_for_status()
        data = response.json()
        print(f"AURA: {data['reply']}")
        print(f"status: {data['status']}")
        assert data["status"] == "active"
        assert data["reply"] is not None

        print(f"\n{'=' * 70}\n10) Cerrar la conversacion\n{'=' * 70}")
        response = client.post(f"{BASE_URL}/admin/sessions/{session_id}/close")
        response.raise_for_status()
        print(response.json())

    print(f"\n{'=' * 70}\nPrueba de handoff completada OK.")


if __name__ == "__main__":
    main()
