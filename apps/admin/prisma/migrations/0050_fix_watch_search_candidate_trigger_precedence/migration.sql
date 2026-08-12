-- PostgreSQL parses user-defined operators at the same precedence level.
-- Parenthesize JSON extraction before applying jsonb containment so the
-- candidate lifecycle trigger compiles when a generation is updated.
CREATE OR REPLACE FUNCTION "reject_watch_search_candidate_identity_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."application_revision",
    NEW."source_epoch",
    NEW."source_digests",
    NEW."catalog_collection",
    NEW."availability_collection",
    NEW."lexical_collection",
    NEW."transcript_collection",
    NEW."transcript_projection_revision",
    NEW."catalog_fields",
    NEW."availability_fields",
    NEW."lexical_fields",
    NEW."transcript_fields",
    NEW."owned_collections",
    NEW."shared_collections"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."application_revision",
    OLD."source_epoch",
    OLD."source_digests",
    OLD."catalog_collection",
    OLD."availability_collection",
    OLD."lexical_collection",
    OLD."transcript_collection",
    OLD."transcript_projection_revision",
    OLD."catalog_fields",
    OLD."availability_fields",
    OLD."lexical_fields",
    OLD."transcript_fields",
    OLD."owned_collections",
    OLD."shared_collections"
  ) THEN
    RAISE EXCEPTION 'watch search candidate identity is immutable';
  END IF;

  IF NEW."state" <> OLD."state" THEN
    IF NOT (
      (OLD."state" = 'building' AND NEW."state" IN ('ready', 'invalidated', 'retiring'))
      OR (OLD."state" = 'ready' AND NEW."state" = 'invalidated')
      OR (OLD."state" = 'invalidated' AND NEW."state" = 'retiring')
      OR (OLD."state" = 'retiring' AND NEW."state" = 'retired')
    ) THEN
      RAISE EXCEPTION 'illegal watch search candidate lifecycle transition: % -> %',
        OLD."state", NEW."state";
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'watch search candidate lifecycle must increment version';
    END IF;
  END IF;

  IF NEW."state" = 'ready' AND NEW."validated_at" IS NULL THEN
    RAISE EXCEPTION 'ready watch search candidate must be fully validated';
  END IF;
  IF NEW."state" = 'invalidated' AND (
    NEW."invalidated_at" IS NULL
    OR NEW."invalidation_reason" IS NULL
    OR length(btrim(NEW."invalidation_reason")) = 0
  ) THEN
    RAISE EXCEPTION 'invalidated watch search candidate requires a reason';
  END IF;
  IF NEW."state" = 'retired' AND (
    NEW."retired_at" IS NULL
    OR jsonb_typeof(NEW."deletion_progress"->'deletedCollections') IS DISTINCT FROM 'array'
    OR NOT ((NEW."deletion_progress"->'deletedCollections') @> NEW."owned_collections")
    OR NOT (NEW."owned_collections" @> (NEW."deletion_progress"->'deletedCollections'))
  ) THEN
    RAISE EXCEPTION 'retired watch search candidate requires complete deletion progress';
  END IF;

  RETURN NEW;
END
$$;
