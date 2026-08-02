-- AURA: configuracion estructurada del negocio (horario y domicilios)
-- Estos campos son la fuente de verdad para calculos (p.ej. si un domicilio
-- aplica gratis); el texto de policy sigue existiendo para responder
-- conversacionalmente y debe mantenerse coherente con estos valores.

alter table business
    add column if not exists opens_at time,
    add column if not exists closes_at time,
    add column if not exists avg_delivery_minutes integer,
    add column if not exists shipping_cost numeric(10, 2),
    add column if not exists free_shipping_threshold numeric(10, 2);
