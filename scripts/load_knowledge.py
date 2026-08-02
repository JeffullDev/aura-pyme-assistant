"""Carga db/knowledge/tornillo_feliz.md en la tabla knowledge_base de Supabase.

El markdown se parte por encabezados H2 (`## Titulo`): cada seccion se inserta
como una fila independiente (title, content), asi la busqueda full-text puede
apuntar a fragmentos acotados en vez de al documento completo.
"""

import re
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.infrastructure.supabase_client import get_supabase_client

BUSINESS_NAME = "El Tornillo Feliz"
KNOWLEDGE_FILE = Path(__file__).resolve().parent.parent / "db" / "knowledge" / "tornillo_feliz.md"


def parse_sections(markdown: str) -> list[dict[str, str]]:
    # Descarta el H1 inicial (titulo del documento) y parte por cada H2.
    raw_sections = re.split(r"^## (.+)$", markdown, flags=re.MULTILINE)[1:]
    sections = []
    for title, content in zip(raw_sections[0::2], raw_sections[1::2]):
        sections.append({"title": title.strip(), "content": content.strip()})
    return sections


def main() -> None:
    if not KNOWLEDGE_FILE.exists():
        raise RuntimeError(f"No se encontro el archivo de conocimiento: {KNOWLEDGE_FILE}")

    client = get_supabase_client()

    business = (
        client.table("business")
        .select("id")
        .eq("name", BUSINESS_NAME)
        .limit(1)
        .execute()
        .data
    )
    if not business:
        raise RuntimeError(
            f'No existe el business "{BUSINESS_NAME}". Corre scripts/seed.py primero.'
        )
    business_id = business[0]["id"]

    # Idempotencia: si ya hay filas de knowledge_base para este business, no se
    # vuelve a insertar nada (mismo patron que scripts/seed.py).
    existing = (
        client.table("knowledge_base")
        .select("id")
        .eq("business_id", business_id)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        print("knowledge_base ya tiene datos para este business (carga omitida, no se duplico nada)")
        return

    sections = parse_sections(KNOWLEDGE_FILE.read_text(encoding="utf-8"))
    if not sections:
        raise RuntimeError("No se encontraron secciones H2 (##) en el archivo de conocimiento.")

    rows = [{**section, "business_id": business_id} for section in sections]
    client.table("knowledge_base").insert(rows).execute()
    print(f"{len(rows)} knowledge_base insertados")


if __name__ == "__main__":
    main()
