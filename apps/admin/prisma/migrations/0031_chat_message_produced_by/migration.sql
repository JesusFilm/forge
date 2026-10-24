-- 0017_chat_message_produced_by
--
-- Adds a nullable `produced_by` column to `experience_chat_message`.
-- The column carries the producer id (agent or workflow) that
-- emitted each assistant turn. Read by the AI chat panel to decide
-- whether to render the 👍/👎 rating control, and stored on each
-- Mastra score record as the `producedBy` metadata field.
--
-- Forward-only and purely additive (NULLable TEXT). Historic rows
-- written before this migration stay NULL → not ratable. No backfill.

ALTER TABLE "experience_chat_message"
  ADD COLUMN "produced_by" TEXT;
