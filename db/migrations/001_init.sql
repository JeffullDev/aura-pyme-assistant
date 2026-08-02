-- AURA: esquema inicial
-- Tablas: business, catalog_item, policy, chat_session, message_log

create extension if not exists "pgcrypto";

create table if not exists business (
    id uuid primary key default gen_random_uuid(),
    name varchar(255) not null,
    tone_prompt text not null,
    created_at timestamptz not null default now()
);

create table if not exists catalog_item (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references business(id) on delete cascade,
    name varchar(255) not null,
    description text,
    price numeric(10, 2) not null,
    stock integer not null default 0,
    category varchar(100)
);

create index if not exists idx_catalog_item_business_id on catalog_item(business_id);
create index if not exists idx_catalog_item_category on catalog_item(category);

create table if not exists policy (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references business(id) on delete cascade,
    topic varchar(50) not null check (topic in ('horario', 'domicilios', 'garantia', 'pago')),
    content text not null
);

create index if not exists idx_policy_business_id on policy(business_id);
create index if not exists idx_policy_topic on policy(topic);

create table if not exists chat_session (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references business(id) on delete cascade,
    user_identifier varchar(100) not null,
    status varchar(20) not null default 'active' check (status in ('active', 'escalated', 'closed')),
    started_at timestamptz not null default now(),
    ended_at timestamptz
);

create index if not exists idx_chat_session_business_id on chat_session(business_id);
create index if not exists idx_chat_session_user_identifier on chat_session(user_identifier);
create index if not exists idx_chat_session_status on chat_session(status);

create table if not exists message_log (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references chat_session(id) on delete cascade,
    role varchar(20) not null check (role in ('user', 'assistant', 'tool')),
    content text,
    tool_name varchar(100),
    tool_input jsonb,
    tool_output jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_message_log_session_id on message_log(session_id);
create index if not exists idx_message_log_created_at on message_log(created_at);
