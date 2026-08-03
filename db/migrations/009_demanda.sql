-- AURA: demanda no cubierta registrada explicitamente por el agente (v1.4)
--
-- Hasta ahora "demanda no cubierta" se inferia releyendo tool_output de
-- search_catalog buscando count=0 (ver get_uncovered_demand en repository.py),
-- con una revalidacion cara contra el catalogo actual para descartar falsos
-- positivos de bugs de busqueda ya corregidos. Se reemplaza por una tool
-- explicita (registrar_demanda_no_cubierta, ver app/core/tools.py) que el
-- agente llama solo cuando confirma que el producto no esta disponible antes
-- de ofrecer alternativas o escalar: la fuente de verdad pasa de "un intento
-- de busqueda que no matcheo nada" a "el agente efectivamente le dijo al
-- cliente que no lo tenemos".

create table if not exists unmet_demand (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references business(id) on delete cascade,
    session_id uuid references chat_session(id) on delete set null,
    producto varchar(255) not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_unmet_demand_business_id on unmet_demand(business_id);
create index if not exists idx_unmet_demand_producto on unmet_demand(business_id, lower(producto));

comment on table unmet_demand is 'Producto que el agente confirmo no tener en catalogo, registrado via la tool registrar_demanda_no_cubierta. Reemplaza la inferencia por count=0 de search_catalog.';
