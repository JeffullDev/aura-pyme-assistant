-- AURA: handoff a humano (v1.1 parte C)
--
-- chat_session.status pasa a tener 4 valores validos:
--   active     -> el bot atiende normalmente
--   escalated  -> en cola, esperando que un humano la tome
--   assigned   -> un humano ya la tomo y responde el
--   closed     -> conversacion cerrada
--
-- message_log.role gana un cuarto valor 'agent': mensajes escritos por un
-- humano desde el panel (distinto de 'assistant', que es la IA).

alter table chat_session
    add column if not exists assigned_agent_name varchar(255),
    add column if not exists assigned_at timestamptz;

alter table chat_session drop constraint if exists chat_session_status_check;
alter table chat_session
    add constraint chat_session_status_check
    check (status in ('active', 'escalated', 'assigned', 'closed'));

comment on column chat_session.status is
    'active: bot atiende | escalated: en cola esperando humano | assigned: humano la tomo | closed: cerrada';

alter table message_log drop constraint if exists message_log_role_check;
alter table message_log
    add constraint message_log_role_check
    check (role in ('user', 'assistant', 'tool', 'agent'));

comment on column message_log.role is
    'user: cliente | assistant: respuesta de la IA | tool: uso de herramienta | agent: respuesta de un humano desde el panel';
