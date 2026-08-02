-- AURA: pedidos (orders) y sus items (order_items)
--
-- order_items guarda snapshot de product_name y unit_price al momento de la
-- compra: si el precio del catalogo cambia despues, el pedido historico debe
-- conservar el precio real cobrado, no el precio actual.

create table if not exists orders (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references business(id) on delete cascade,
    session_id uuid references chat_session(id) on delete set null,
    user_identifier varchar(100) not null,
    customer_name varchar(255) not null,
    delivery_address text not null,
    status varchar(20) not null default 'pending'
        check (status in ('pending', 'confirmed', 'in_transit', 'delivered', 'cancelled')),
    subtotal numeric(10, 2) not null,
    shipping_cost numeric(10, 2) not null,
    total numeric(10, 2) not null,
    estimated_delivery_at timestamp not null,
    created_at timestamp not null default now()
);

create index if not exists idx_orders_business_id on orders(business_id);
create index if not exists idx_orders_session_id on orders(session_id);
create index if not exists idx_orders_user_identifier on orders(user_identifier);

create table if not exists order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id) on delete cascade,
    -- on delete set null: el snapshot (product_name/unit_price) ya preserva la
    -- info historica, asi que el item no debe desaparecer si el producto se borra.
    catalog_item_id uuid references catalog_item(id) on delete set null,
    product_name varchar(255) not null,
    quantity integer not null check (quantity > 0),
    unit_price numeric(10, 2) not null,
    subtotal numeric(10, 2) not null
);

create index if not exists idx_order_items_order_id on order_items(order_id);
