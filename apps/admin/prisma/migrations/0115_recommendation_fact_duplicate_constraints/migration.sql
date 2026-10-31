-- The non-null capability_jti column is already individually unique on each
-- fact table. Its composite (capability_jti, event_id) constraint adds no
-- uniqueness guarantee and is not referenced by foreign keys. Keep the
-- (request_id, item_id) constraints: Prisma's one-to-one relation validator
-- requires them even though item_id is also individually unique. DDL briefly
-- takes ACCESS EXCLUSIVE: fail rather than queue behind a long transaction.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE "recommendation_rendered_fact"
  DROP CONSTRAINT "recommendation_render_event_key";
ALTER TABLE "recommendation_impression"
  DROP CONSTRAINT "recommendation_impression_event_key";
COMMIT;
