-- AURA: distingue cierre por inactividad de cierre explicito (v1.3)
--
-- Hasta ahora el auto-cierre por 12h de inactividad y el cierre explicito
-- (boton 'Cerrar' del panel / tool close_conversation del agente) marcaban
-- ambos status='closed', quedando indistinguibles en el panel. chat_session.status
-- gana un quinto valor:
--   abandoned  -> se cerro sola por 12h de inactividad, sin despedida del cliente
--   closed     -> se cerro explicitamente, tras despedirse del cliente
--
-- Ver repository._auto_close_stale_sessions (ahora marca 'abandoned') vs
-- repository.close_session (sigue marcando 'closed').

alter table chat_session drop constraint if exists chat_session_status_check;
alter table chat_session
    add constraint chat_session_status_check
    check (status in ('active', 'escalated', 'assigned', 'closed', 'abandoned'));

comment on column chat_session.status is
    'active: bot atiende | escalated: en cola esperando humano | assigned: humano la tomo | closed: cerrada explicitamente | abandoned: se cerro sola por 12h de inactividad';
