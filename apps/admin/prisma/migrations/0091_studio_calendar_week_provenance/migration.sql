-- Existing weekly settings remain operator-owned. Generated weekly themes retain
-- their immutable run, native instruction and exact pack/source references.
ALTER TABLE studio_plan_week ADD COLUMN provenance JSONB;
