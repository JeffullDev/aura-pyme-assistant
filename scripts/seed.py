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
    # Config estructurada del negocio: fuente de verdad para calculos (p.ej. si un
    # domicilio aplica gratis). El texto de las policies de abajo debe ser coherente
    # con estos valores, pero solo sirve para responder conversacionalmente.
    "opens_at": "08:00",
    "closes_at": "20:00",
    "avg_delivery_minutes": 60,
    "shipping_cost": 8000,
    "free_shipping_threshold": 100000,
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
    {
        "name": "Llave de tubo ajustable 14\"",
        "description": "Llave stillson de 14 pulgadas para tuberia, mordazas dentadas de acero forjado.",
        "price": 38000,
        "stock": 15,
        "category": "plomeria",
    },
    {
        "name": "Cinta teflon para roscas (10 unidades)",
        "description": "Cinta de teflon blanca para sellar roscas de tuberia, paquete de 10 rollos.",
        "price": 8000,
        "stock": 90,
        "category": "plomeria",
    },
    {
        "name": "Sifon PVC para lavamanos",
        "description": "Sifon en PVC tipo botella para lavamanos, incluye conexiones.",
        "price": 15000,
        "stock": 0,
        "category": "plomeria",
    },
    {
        "name": "Tubo PVC 1/2\" x 3m",
        "description": "Tubo de PVC presion de 1/2 pulgada por 3 metros, para instalaciones hidraulicas.",
        "price": 9500,
        "stock": 70,
        "category": "plomeria",
    },
    {
        "name": "Candado de seguridad 50mm",
        "description": "Candado de acero con cuerpo de laton, arco endurecido, 50mm, incluye 3 llaves.",
        "price": 25000,
        "stock": 40,
        "category": "cerrajeria",
    },
    {
        "name": "Cerradura de perilla para puerta interior",
        "description": "Cerradura de perilla en acabado niquel satinado para puertas interiores, incluye llaves.",
        "price": 48000,
        "stock": 20,
        "category": "cerrajeria",
    },
    {
        "name": "Set de llaves allen (9 piezas)",
        "description": "Juego de llaves hexagonales allen de 1.5mm a 10mm en estuche plastico.",
        "price": 24000,
        "stock": 30,
        "category": "herramientas manuales",
    },
    {
        "name": "Llave inglesa 10\"",
        "description": "Llave ajustable inglesa de 10 pulgadas, mordaza de apertura rapida.",
        "price": 29000,
        "stock": 0,
        "category": "herramientas manuales",
    },
    {
        "name": "Taladro inalambrico 20V con bateria",
        "description": "Taladro atornillador inalambrico de 20V, incluye bateria de litio, cargador y maletin.",
        "price": 245000,
        "stock": 8,
        "category": "herramientas electricas",
    },
    {
        "name": "Pulidora angular 4.5\" 850W",
        "description": "Pulidora/esmeriladora angular de 850W para disco de 4.5 pulgadas, ideal para corte y desbaste de metal.",
        "price": 178000,
        "stock": 10,
        "category": "herramientas electricas",
    },
    {
        "name": "Sierra caladora electrica 500W",
        "description": "Sierra caladora de 500W con velocidad variable, para cortes rectos y curvos en madera y metal.",
        "price": 165000,
        "stock": 6,
        "category": "herramientas electricas",
    },
    {
        "name": "Rotomartillo SDS Plus",
        "description": "Rotomartillo con sistema SDS Plus para perforacion en concreto y demolicion liviana.",
        "price": 320000,
        "stock": 3,
        "category": "herramientas electricas",
    },
    {
        "name": "Cable electrico #12 AWG (metro)",
        "description": "Cable electrico de cobre calibre 12 AWG, venta por metro, uso residencial.",
        "price": 2800,
        "stock": 500,
        "category": "electricidad",
    },
    {
        "name": "Interruptor sencillo",
        "description": "Interruptor sencillo de pared para instalacion electrica residencial, color blanco.",
        "price": 6500,
        "stock": 80,
        "category": "electricidad",
    },
    {
        "name": "Breaker termomagnetico 20A",
        "description": "Breaker termomagnetico de 20 amperios, un polo, para tablero residencial.",
        "price": 18000,
        "stock": 4,
        "category": "electricidad",
    },
    {
        "name": "Pintura esmalte sintetico negro 1/4 galon",
        "description": "Esmalte sintetico brillante color negro, cuarto de galon, para metal y madera.",
        "price": 22000,
        "stock": 40,
        "category": "pinturas",
    },
    {
        "name": "Brocha de cerdas naturales 3\"",
        "description": "Brocha de cerdas naturales de 3 pulgadas, mango de madera, para esmalte y barniz.",
        "price": 9000,
        "stock": 45,
        "category": "pinturas",
    },
    {
        "name": "Varilla de acero corrugada 3/8\" x 6m",
        "description": "Varilla de refuerzo corrugada de 3/8 de pulgada por 6 metros, para estructuras de concreto.",
        "price": 24000,
        "stock": 2,
        "category": "materiales de construccion",
    },
    {
        "name": "Malla eslabonada galvanizada (metro)",
        "description": "Malla eslabonada galvanizada calibre 12, venta por metro lineal, para cerramientos.",
        "price": 18000,
        "stock": 0,
        "category": "materiales de construccion",
    },
    {
        "name": "Manguera de jardin 15m",
        "description": "Manguera flexible de jardin de 15 metros con conectores, resistente a rayos UV.",
        "price": 42000,
        "stock": 22,
        "category": "jardineria",
    },
    {
        "name": "Gafas de seguridad transparentes",
        "description": "Gafas de seguridad transparentes con proteccion antiempanante, ajuste antideslizante.",
        "price": 8000,
        "stock": 70,
        "category": "seguridad industrial",
    },
    {
        "name": "Silicona transparente multiusos",
        "description": "Silicona transparente de curado acetico, uso general en vidrio, ceramica y metal.",
        "price": 11000,
        "stock": 45,
        "category": "adhesivos",
    },
]

POLICIES = [
    {
        "topic": "horario",
        "content": (
            "Atendemos de lunes a sabado de 8:00am a 8:00pm. Domingos y festivos "
            "permanecemos cerrados."
        ),
    },
    {
        "topic": "domicilios",
        "content": (
            "Hacemos domicilios dentro de la ciudad con un costo de $8000 para compras "
            "menores a $100000. Compras superiores a $100000 tienen domicilio gratis. "
            "El tiempo estimado de entrega es de aproximadamente 60 minutos."
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
