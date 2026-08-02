"""Logica de negocio para crear pedidos y consultar su estado."""

from datetime import datetime
from typing import Any

from app.core.catalog import stock_status
from app.core.delivery import BUSINESS_TZ, calcular_entrega
from app.infrastructure import repository


def create_order(
    business: dict[str, Any],
    session_id: str,
    user_identifier: str,
    items: list[dict[str, Any]],
    customer_name: str,
    delivery_address: str,
) -> dict[str, Any]:
    if not items:
        return {"success": False, "error": "El pedido no tiene productos."}
    if not customer_name.strip():
        return {"success": False, "error": "Falta el nombre del cliente."}
    if not delivery_address.strip():
        return {"success": False, "error": "Falta la direccion de entrega."}

    resolved_items = []
    for raw_item in items:
        product_name = str(raw_item.get("product_name", "")).strip()
        quantity = raw_item.get("quantity")
        if not product_name or not isinstance(quantity, int) or quantity <= 0:
            return {
                "success": False,
                "error": (
                    f"Item invalido: {raw_item!r}. Cada item necesita product_name "
                    "y quantity (entero positivo)."
                ),
            }

        catalog_item = repository.find_catalog_item_for_order(business["id"], product_name)
        if catalog_item is None:
            return {
                "success": False,
                "error": f'No encontramos "{product_name}" en el catalogo. Verifica el nombre del producto.',
            }

        # Nunca se revela el numero exacto de stock, solo su categoria (Agotado /
        # Poco stock / ...), igual que search_catalog.
        if catalog_item["stock"] < quantity:
            return {
                "success": False,
                "error": (
                    f'No hay suficiente stock de "{catalog_item["name"]}" para '
                    f'{quantity} unidades. Disponibilidad actual: '
                    f'{stock_status(catalog_item["stock"])}.'
                ),
            }

        unit_price = catalog_item["price"]
        resolved_items.append(
            {
                "catalog_item_id": catalog_item["id"],
                "product_name": catalog_item["name"],
                "quantity": quantity,
                "unit_price": unit_price,
                # Snapshot del costo al momento de la compra, mismo patron que
                # unit_price (ver comentario en 005_orders.sql): si el costo de
                # compra cambia despues, el historico de margenes no se altera.
                "unit_cost": catalog_item.get("cost_price"),
                "subtotal": unit_price * quantity,
                "new_stock": catalog_item["stock"] - quantity,
            }
        )

    subtotal_total = sum(item["subtotal"] for item in resolved_items)
    free_shipping_threshold = business.get("free_shipping_threshold") or 0
    base_shipping_cost = business.get("shipping_cost") or 0
    shipping_cost = 0 if subtotal_total > free_shipping_threshold else base_shipping_cost
    total = subtotal_total + shipping_cost

    ahora = datetime.now(BUSINESS_TZ)
    estimated_delivery_at = calcular_entrega(business, ahora)

    order = repository.insert_order(
        business_id=business["id"],
        session_id=session_id,
        user_identifier=user_identifier,
        customer_name=customer_name,
        delivery_address=delivery_address,
        subtotal=subtotal_total,
        shipping_cost=shipping_cost,
        total=total,
        estimated_delivery_at=estimated_delivery_at,
    )

    repository.insert_order_items(
        [
            {
                "order_id": order["id"],
                "catalog_item_id": item["catalog_item_id"],
                "product_name": item["product_name"],
                "quantity": item["quantity"],
                "unit_price": item["unit_price"],
                "unit_cost": item["unit_cost"],
                "subtotal": item["subtotal"],
            }
            for item in resolved_items
        ]
    )

    # Se descuenta el stock al final, una vez que la orden y sus items ya
    # quedaron registrados: si algo falla antes, no se toca inventario.
    for item in resolved_items:
        repository.update_catalog_stock(item["catalog_item_id"], item["new_stock"])

    return {
        "success": True,
        "order_reference": order["id"][:8],
        "items": [
            {"product_name": item["product_name"], "quantity": item["quantity"]}
            for item in resolved_items
        ],
        "subtotal": subtotal_total,
        "shipping_cost": shipping_cost,
        "total": total,
        "estimated_delivery_at": estimated_delivery_at.isoformat(),
    }


def get_order_status(
    business: dict[str, Any],
    user_identifier: str,
    order_reference: str | None,
) -> dict[str, Any]:
    if order_reference:
        order = repository.find_order_by_reference(business["id"], order_reference)
        # Si la referencia existe pero es de otro cliente, se trata como "no
        # encontrado": un cliente no debe poder consultar pedidos ajenos
        # adivinando referencias de 8 caracteres.
        if order is None or order["user_identifier"] != user_identifier:
            return {"found": False, "error": "No encontramos un pedido con esa referencia."}
        orders = [order]
    else:
        orders = repository.get_recent_orders(business["id"], user_identifier)
        if not orders:
            return {"found": False, "error": "El cliente no tiene pedidos registrados."}

    summaries = []
    for order in orders:
        items = repository.get_order_items(order["id"])
        summaries.append(
            {
                "order_reference": order["id"][:8],
                "status": order["status"],
                "total": order["total"],
                "estimated_delivery_at": order["estimated_delivery_at"],
                "items": [
                    {"product_name": item["product_name"], "quantity": item["quantity"]}
                    for item in items
                ],
            }
        )
    return {"found": True, "orders": summaries}
