-- Metadata-only execution claims. Native Mastra snapshots remain the only prompt body store.
CREATE TABLE IF NOT EXISTS studio_agent_execution (
  id varchar(128) PRIMARY KEY,
  instruction_digest text NOT NULL CHECK (instruction_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  admitted_at timestamptz NOT NULL DEFAULT now()
);
