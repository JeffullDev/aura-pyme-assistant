-- AURA: inventario con costos y margenes (v1.2 parte F)
--
-- catalog_item.cost_price: precio de compra (costo) del producto.
-- order_items.unit_cost: SNAPSHOT del costo al momento de la compra, mismo
-- patron que unit_price (ver 005_orders.sql) -- si no se congela, el historico
-- de margenes se recalcularia solo con que cambiara el costo de compra actual.

alter table catalog_item add column if not exists cost_price numeric(10, 2);
alter table order_items add column if not exists unit_cost numeric(10, 2);

-- Backfill de catalog_item.cost_price para los productos ya sembrados (el
-- seed es idempotente y no vuelve a correr sobre un business existente):
-- margen tipico de ferreteria sobre el costo, variando por categoria
-- (herramienta electrica ~25%, tornilleria/materiales ~40%, el resto entre
-- medio). Mismos porcentajes que scripts/seed.py, para que un negocio nuevo
-- sembrado desde cero quede identico.
update catalog_item set cost_price = round(price / 1.25, 2) where category = 'herramientas electricas' and cost_price is null;
update catalog_item set cost_price = round(price / 1.30, 2) where category = 'herramientas manuales' and cost_price is null;
update catalog_item set cost_price = round(price / 1.28, 2) where category = 'materiales de construccion' and cost_price is null;
update catalog_item set cost_price = round(price / 1.32, 2) where category = 'pinturas' and cost_price is null;
update catalog_item set cost_price = round(price / 1.40, 2) where category = 'materiales' and cost_price is null;
update catalog_item set cost_price = round(price / 1.35, 2) where category = 'seguridad industrial' and cost_price is null;
update catalog_item set cost_price = round(price / 1.30, 2) where category = 'electricidad' and cost_price is null;
update catalog_item set cost_price = round(price / 1.35, 2) where category = 'adhesivos' and cost_price is null;
update catalog_item set cost_price = round(price / 1.30, 2) where category = 'plomeria' and cost_price is null;
update catalog_item set cost_price = round(price / 1.30, 2) where category = 'cerrajeria' and cost_price is null;
update catalog_item set cost_price = round(price / 1.32, 2) where category = 'jardineria' and cost_price is null;
-- Cualquier categoria no listada arriba (o nueva en el futuro) cae a un
-- margen de referencia del 30%.
update catalog_item set cost_price = round(price / 1.30, 2) where cost_price is null;

comment on column catalog_item.cost_price is 'Precio de compra (costo). Junto con price permite calcular el margen real por producto.';
comment on column order_items.unit_cost is 'Snapshot del costo del producto al momento de la compra (igual patron que unit_price): preserva el margen historico aunque el costo de compra actual cambie despues.';
