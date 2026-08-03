-- Prompt caching (v1.5): registra cuantos tokens de cada llamada a Claude
-- fueron escritura o lectura de cache, para poder calcular el costo real
-- (lectura ~0.1x, escritura ~1.25x) en vez de asumir que todo input se cobro
-- al precio base. Ver app/core/agent_service.py y app/core/config.py.
ALTER TABLE token_usage
  ADD COLUMN cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN cache_read_input_tokens INTEGER NOT NULL DEFAULT 0;
