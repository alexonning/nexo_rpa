ALTER TABLE gestao_rpa.solicitacoes
  ADD COLUMN IF NOT EXISTS grupo_id UUID;

UPDATE gestao_rpa.solicitacoes
SET grupo_id = md5(random()::text || clock_timestamp()::text)::uuid
WHERE grupo_id IS NULL;

ALTER TABLE gestao_rpa.solicitacoes
  ALTER COLUMN grupo_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS solicitacoes_grupo_idx
  ON gestao_rpa.solicitacoes (grupo_id, criado_em DESC);
