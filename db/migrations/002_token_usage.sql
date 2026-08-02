-- AURA: tracking de consumo de tokens y costo estimado por turno de conversacion
-- Tabla: token_usage

create table if not exists token_usage (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references chat_session(id) on delete cascade,
    input_tokens integer not null,
    output_tokens integer not null,
    total_tokens integer not null,
    estimated_cost numeric(10, 6) not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_token_usage_session_id on token_usage(session_id);
