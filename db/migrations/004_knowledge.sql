-- AURA: base de conocimiento en texto libre (guias, tips, historia del negocio)
-- Tabla: knowledge_base
--
-- Complementa a catalog_item y policy: mientras esas dos tablas guardan datos
-- estructurados (precio/stock, texto normativo por topic fijo), knowledge_base
-- guarda contenido narrativo mas largo (guias de uso, consejos, contexto de marca)
-- que el agente consulta via full-text search cuando la pregunta no encaja en
-- las otras dos herramientas.

create table if not exists knowledge_base (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references business(id) on delete cascade,
    title varchar(255) not null,
    content text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_base_business_id on knowledge_base(business_id);

-- Indice full-text (espanol) sobre titulo + contenido para busqueda por relevancia.
create index if not exists idx_knowledge_base_fts on knowledge_base
    using gin (to_tsvector('spanish', title || ' ' || content));
