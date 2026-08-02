"""Helpers de dominio sobre el catalogo, compartidos entre tools.py y orders.py."""


def stock_status(stock: int) -> str:
    """El numero crudo de stock es informacion interna: nunca debe llegar a Claude
    ni a un mensaje de error visible para el cliente. Se traduce a una categoria."""
    if stock == 0:
        return "Agotado"
    if stock <= 4:
        return "Poco stock"
    if stock <= 9:
        return "Hay stock, pocas unidades"
    return "Hay stock"
