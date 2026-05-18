-- Create an isolated Postgres schema for Mastra's memory + agent state.
--
-- Mastra's `@mastra/pg` PostgresStore creates and migrates its own tables
-- inside the `schemaName` it is configured with. Keeping those tables in a
-- dedicated `mastra` schema (rather than the default `public` schema)
-- isolates them from Prisma's migration history and makes a future drop
-- a single `DROP SCHEMA mastra CASCADE` instead of table-by-table cleanup.
--
-- This migration is additive and idempotent. The PostgresStore itself
-- handles its own DDL on first write inside the schema.

CREATE SCHEMA IF NOT EXISTS "mastra";
