"""Calculo de la hora estimada de entrega de un pedido."""

from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

BUSINESS_TZ = ZoneInfo("America/Bogota")


def _parse_time(value: Any) -> time:
    if isinstance(value, time):
        return value
    # Postgres `time` llega desde supabase-py como string "HH:MM:SS".
    return time.fromisoformat(str(value))


def calcular_entrega(business: dict[str, Any], ahora: datetime) -> datetime:
    """Devuelve la hora estimada de entrega de un pedido hecho en `ahora`.

    Si `ahora + avg_delivery_minutes` cae dentro del horario de atencion de hoy
    (y el negocio esta abierto en `ahora`), la entrega es hoy a esa hora. Si el
    negocio ya esta cerrado (antes de abrir o despues de cerrar) o la entrega
    calculada caeria despues del cierre, se programa para el dia siguiente a
    partir de la hora de apertura (opens_at + avg_delivery_minutes).
    """
    if ahora.tzinfo is None:
        ahora = ahora.replace(tzinfo=BUSINESS_TZ)

    opens_at = _parse_time(business["opens_at"])
    closes_at = _parse_time(business["closes_at"])
    avg_delivery = timedelta(minutes=business["avg_delivery_minutes"])

    opens_today = datetime.combine(ahora.date(), opens_at, tzinfo=ahora.tzinfo)
    closes_today = datetime.combine(ahora.date(), closes_at, tzinfo=ahora.tzinfo)

    if opens_today <= ahora <= closes_today:
        candidata = ahora + avg_delivery
        if candidata <= closes_today:
            return candidata

    dia_siguiente = ahora.date() + timedelta(days=1)
    opens_manana = datetime.combine(dia_siguiente, opens_at, tzinfo=ahora.tzinfo)
    return opens_manana + avg_delivery
