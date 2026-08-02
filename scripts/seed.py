"""Inserta datos de ejemplo para "El Tornillo Feliz" en Supabase."""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.infrastructure.supabase_client import get_supabase_client

BUSINESS = {
    "name": "El Tornillo Feliz",
    "tone_prompt": (
        "Sos el asistente de El Tornillo Feliz, una ferreteria de barrio con mas de "
        "20 anios de trayectoria. Hablas de forma cercana, calida y directa, como un "
        "vendedor de confianza que conoce bien sus productos. Usa un tono informal "
        "pero respetuoso, evita tecnicismos innecesarios, y siempre que puedas ofrece "
        "una recomendacion util ademas de responder la consulta. Si no sabes algo, "
        "decilo con honestidad y ofrece escalar con una persona del equipo."
    ),
}

CATALOG_ITEMS = [
    {
        "name": "Taladro percutor 1/2\" 750W",
        "description": "Taladro percutor electrico con mandril de 1/2 pulgada, ideal para perforar concreto, madera y metal.",
        "price": 189000,
        "stock": 12,
        "category": "herramientas electricas",
    },
    {
        "name": "Juego de destornilladores (6 piezas)",
        "description": "Set de destornilladores planos y de estrella con mango ergonomico antideslizante.",
        "price": 35000,
        "stock": 40,
        "category": "herramientas manuales",
    },
    {
        "name": "Martillo de una",
        "description": "Martillo de una con cabeza de acero forjado y mango de fibra de vidrio, 16 oz.",
        "price": 42000,
        "stock": 25,
        "category": "herramientas manuales",
    },
    {
        "name": "Cinta metrica 5m",
        "description": "Cinta metrica retractil de 5 metros con freno y clip de cinturon.",
        "price": 18000,
        "stock": 60,
        "category": "herramientas manuales",
    },
    {
        "name": "Cemento gris x 50kg",
        "description": "Bolsa de cemento gris de uso general para construccion y reparaciones.",
        "price": 32000,
        "stock": 80,
        "category": "materiales de construccion",
    },
    {
        "name": "Pintura latex blanca 1 galon",
        "description": "Pintura latex lavable para interiores, acabado mate, rendimiento aprox. 10m2/galon.",
        "price": 65000,
        "stock": 30,
        "category": "pinturas",
    },
    {
        "name": "Caja de tornillos autorroscantes (100u)",
        "description": "Tornillos autorroscantes de 1 pulgada para madera y drywall, cabeza phillips.",
        "price": 12000,
        "stock": 100,
        "category": "materiales",
    },
    {
        "name": "Guantes de trabajo reforzados",
        "description": "Guantes de cuero reforzado con palma antideslizante, talla unica.",
        "price": 15000,
        "stock": 50,
        "category": "seguridad industrial",
    },
    {
        "name": "Sierra manual para madera",
        "description": "Serrucho de 20 pulgadas con dientes templados, mango ergonomico.",
        "price": 28000,
        "stock": 18,
        "category": "herramientas manuales",
    },
    {
        "name": "Extension electrica 10m",
        "description": "Extension electrica de 10 metros con 3 tomas y proteccion contra sobrecarga.",
        "price": 45000,
        "stock": 22,
        "category": "electricidad",
    },
    {
        "name": "Pegante para madera",
        "description": "Adhesivo blanco de alta resistencia para union de madera, secado en 30 minutos, resistencia total en 24 horas.",
        "price": 22000,
        "stock": 35,
        "category": "adhesivos",
    },
]

POLICIES = [
    {
        "topic": "horario",
        "content": (
            "Atendemos de lunes a viernes de 8:00am a 6:00pm y sabados de 8:00am a "
            "2:00pm. Domingos y festivos permanecemos cerrados."
        ),
    },
    {
        "topic": "domicilios",
        "content": (
            "Hacemos domicilios dentro de la ciudad con un costo de $8000 para compras "
            "menores a $100000. Compras superiores a $100000 tienen domicilio gratis. "
            "El tiempo estimado de entrega es de 2 a 4 horas habiles."
        ),
    },
    {
        "topic": "garantia",
        "content": (
            "Las herramientas electricas tienen garantia de 6 meses por defectos de "
            "fabrica. Las herramientas manuales tienen garantia de 3 meses. La garantia "
            "no cubre mal uso, desgaste normal ni danios por accidentes."
        ),
    },
    {
        "topic": "pago",
        "content": (
            "Aceptamos efectivo, tarjetas debito y credito, y transferencias bancarias. "
            "Tambien contamos con pago contraentrega para domicilios dentro de la ciudad."
        ),
    },
]


def main() -> None:
    client = get_supabase_client()

    # Idempotencia: si el business ya existe (por nombre), no se vuelve a sembrar
    # nada. catalog_item y policy siempre se insertan junto con el business en la
    # misma corrida, asi que basta con este chequeo para evitar duplicados.
    existing = (
        client.table("business")
        .select("id")
        .eq("name", BUSINESS["name"])
        .limit(1)
        .execute()
        .data
    )
    if existing:
        print(f"Business ya existe: {existing[0]['id']} (seed omitido, no se duplico nada)")
        return

    business_result = client.table("business").insert(BUSINESS).execute()
    business_id = business_result.data[0]["id"]
    print(f"Business creado: {business_id}")

    items = [{**item, "business_id": business_id} for item in CATALOG_ITEMS]
    client.table("catalog_item").insert(items).execute()
    print(f"{len(items)} catalog_item insertados")

    policies = [{**policy, "business_id": business_id} for policy in POLICIES]
    client.table("policy").insert(policies).execute()
    print(f"{len(policies)} policy insertados")

    print("Seed completado.")


if __name__ == "__main__":
    main()
