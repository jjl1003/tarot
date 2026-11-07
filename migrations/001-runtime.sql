BEGIN;
CREATE TABLE IF NOT EXISTS tarot_runtime (
  id smallint PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL
);
INSERT INTO tarot_runtime (id, state) VALUES (1,
  '{"version":1,"global":{"day":"1970-01-01","used":0,"total":0},"invites":{},"rates":{},"leases":{}}'::jsonb
) ON CONFLICT (id) DO NOTHING;
COMMIT;
