-- AURA: ubicacion fisica del negocio (v1.6)
--
-- Se agrega "ubicacion" como un topic fijo mas de policy, mismo patron que
-- horario/domicilios/garantia/pago: es un dato institucional estable (no
-- cambia por conversacion), no una respuesta libre de knowledge_base.

ALTER TABLE policy DROP CONSTRAINT IF EXISTS policy_topic_check;
ALTER TABLE policy ADD CONSTRAINT policy_topic_check
  CHECK (topic IN ('horario', 'domicilios', 'garantia', 'pago', 'ubicacion'));

-- Backfill para negocios ya sembrados (el seed es idempotente y no vuelve a
-- correr sobre un business existente, igual que 007_margenes.sql): inserta la
-- policy de ubicacion solo si el negocio todavia no la tiene. Misma direccion
-- ficticia que ya usaba app/static/demo-tienda.html, para que el chat no
-- contradiga lo que muestra la pagina de demo.
INSERT INTO policy (business_id, topic, content)
SELECT id, 'ubicacion',
  'Nuestro local está en la Cra. 45 #12-30, Barrio Restrepo, Bogotá. Puedes recoger tu pedido ahí mismo, en el mismo horario de atención.'
FROM business
WHERE NOT EXISTS (
  SELECT 1 FROM policy WHERE policy.business_id = business.id AND policy.topic = 'ubicacion'
);
