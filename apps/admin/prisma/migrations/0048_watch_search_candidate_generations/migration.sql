-- Immutable identity and ownership ledger for the private Typesense Watch
-- candidate. Current serving aliases and collections are deliberately absent:
-- this migration cannot move or retire the current search generation.

CREATE TYPE "WatchSearchCandidateGenerationState" AS ENUM (
  'building',
  'ready',
  'invalidated',
  'retiring',
  'retired'
);

CREATE TYPE "WatchSearchCandidatePointerKind" AS ENUM (
  'evaluation',
  'serving'
);

CREATE TYPE "WatchSearchCandidateQualificationStatus" AS ENUM (
  'passed',
  'rejected'
);

CREATE TYPE "WatchSearchCandidateLeaseKind" AS ENUM (
  'comparison',
  'evaluation'
);

CREATE TABLE "watch_search_candidate_generation" (
  "id" varchar(128) NOT NULL,
  "state" "WatchSearchCandidateGenerationState" NOT NULL DEFAULT 'building',
  "version" integer NOT NULL DEFAULT 0,
  "application_revision" varchar(128) NOT NULL,
  "source_epoch" varchar(128) NOT NULL,
  "source_digests" jsonb NOT NULL,
  "catalog_collection" varchar(255) NOT NULL,
  "availability_collection" varchar(255) NOT NULL,
  "lexical_collection" varchar(255) NOT NULL,
  "transcript_collection" varchar(255) NOT NULL,
  "transcript_projection_revision" bigint NOT NULL,
  "catalog_fields" jsonb NOT NULL,
  "availability_fields" jsonb NOT NULL,
  "lexical_fields" jsonb NOT NULL,
  "transcript_fields" jsonb NOT NULL,
  "owned_collections" jsonb NOT NULL,
  "shared_collections" jsonb NOT NULL,
  "document_counts" jsonb NOT NULL DEFAULT '{}',
  "capacity_evidence" jsonb NOT NULL DEFAULT '{}',
  "deletion_progress" jsonb NOT NULL DEFAULT '{}',
  "validated_at" timestamp(3),
  "invalidated_at" timestamp(3),
  "invalidation_reason" varchar(2048),
  "retired_at" timestamp(3),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL,

  CONSTRAINT "watch_search_candidate_generation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "watch_search_candidate_generation_version_check"
    CHECK ("version" >= 0),
  CONSTRAINT "watch_search_candidate_generation_revision_check"
    CHECK (
      length(btrim("application_revision")) > 0
      AND length(btrim("source_epoch")) > 0
      AND "transcript_projection_revision" >= 0
    ),
  CONSTRAINT "watch_search_candidate_generation_distinct_members_check"
    CHECK (
      "catalog_collection" <> "availability_collection"
      AND "catalog_collection" <> "lexical_collection"
      AND "catalog_collection" <> "transcript_collection"
      AND "availability_collection" <> "lexical_collection"
      AND "availability_collection" <> "transcript_collection"
      AND "lexical_collection" <> "transcript_collection"
    ),
  CONSTRAINT "watch_search_candidate_generation_manifests_check"
    CHECK (
      jsonb_typeof("catalog_fields") = 'array'
      AND jsonb_array_length("catalog_fields") > 0
      AND jsonb_typeof("availability_fields") = 'array'
      AND jsonb_array_length("availability_fields") > 0
      AND jsonb_typeof("lexical_fields") = 'array'
      AND jsonb_array_length("lexical_fields") > 0
      AND jsonb_typeof("transcript_fields") = 'array'
      AND jsonb_array_length("transcript_fields") > 0
    ),
  CONSTRAINT "watch_search_candidate_generation_ownership_check"
    CHECK (
      "owned_collections" = jsonb_build_array(
        "catalog_collection",
        "availability_collection",
        "lexical_collection"
      )
      AND "shared_collections" = jsonb_build_array("transcript_collection")
    )
);

CREATE INDEX "watch_search_candidate_generation_state_created_at_idx"
  ON "watch_search_candidate_generation"("state", "created_at");
CREATE INDEX "watch_search_candidate_generation_transcript_identity_idx"
  ON "watch_search_candidate_generation"(
    "transcript_collection",
    "transcript_projection_revision"
  );

CREATE TABLE "watch_search_candidate_pointer" (
  "kind" "WatchSearchCandidatePointerKind" NOT NULL,
  "generation_id" varchar(128),
  "version" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp(3) NOT NULL,

  CONSTRAINT "watch_search_candidate_pointer_pkey" PRIMARY KEY ("kind"),
  CONSTRAINT "watch_search_candidate_pointer_version_check"
    CHECK ("version" >= 0),
  CONSTRAINT "watch_search_candidate_pointer_generation_id_fkey"
    FOREIGN KEY ("generation_id")
    REFERENCES "watch_search_candidate_generation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "watch_search_candidate_pointer_generation_id_idx"
  ON "watch_search_candidate_pointer"("generation_id");

INSERT INTO "watch_search_candidate_pointer" (
  "kind",
  "generation_id",
  "version",
  "updated_at"
) VALUES
  ('evaluation', NULL, 0, CURRENT_TIMESTAMP),
  ('serving', NULL, 0, CURRENT_TIMESTAMP);

CREATE TABLE "watch_search_candidate_qualification" (
  "id" text NOT NULL,
  "generation_id" varchar(128) NOT NULL,
  "status" "WatchSearchCandidateQualificationStatus" NOT NULL,
  "application_revision" varchar(128) NOT NULL,
  "transcript_collection" varchar(255) NOT NULL,
  "transcript_projection_revision" bigint NOT NULL,
  "qrels_revision" varchar(128) NOT NULL,
  "current_bindings" jsonb NOT NULL,
  "evidence" jsonb NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "watch_search_candidate_qualification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "watch_search_candidate_qualification_generation_id_fkey"
    FOREIGN KEY ("generation_id")
    REFERENCES "watch_search_candidate_generation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "watch_search_candidate_qualification_identity_check"
    CHECK (
      length(btrim("application_revision")) > 0
      AND length(btrim("transcript_collection")) > 0
      AND "transcript_projection_revision" >= 0
      AND length(btrim("qrels_revision")) > 0
      AND jsonb_typeof("current_bindings") = 'array'
      AND jsonb_array_length("current_bindings") > 0
      AND jsonb_typeof("evidence") = 'object'
    )
);

CREATE INDEX "watch_search_candidate_qualification_generation_status_created_at_idx"
  ON "watch_search_candidate_qualification"(
    "generation_id",
    "status",
    "created_at"
  );

CREATE TABLE "watch_search_candidate_lease" (
  "resource_key" varchar(128) NOT NULL,
  "kind" "WatchSearchCandidateLeaseKind" NOT NULL,
  "holder_token" varchar(128) NOT NULL,
  "generation_id" varchar(128) NOT NULL,
  "application_revision" varchar(128) NOT NULL,
  "transcript_collection" varchar(255) NOT NULL,
  "transcript_projection_revision" bigint NOT NULL,
  "current_bindings" jsonb NOT NULL,
  "acquired_at" timestamp(3) NOT NULL,
  "renewed_at" timestamp(3) NOT NULL,
  "expires_at" timestamp(3) NOT NULL,

  CONSTRAINT "watch_search_candidate_lease_pkey" PRIMARY KEY ("resource_key"),
  CONSTRAINT "watch_search_candidate_lease_generation_id_fkey"
    FOREIGN KEY ("generation_id")
    REFERENCES "watch_search_candidate_generation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "watch_search_candidate_lease_window_check"
    CHECK (
      "expires_at" > "renewed_at"
      AND "renewed_at" >= "acquired_at"
      AND jsonb_typeof("current_bindings") = 'array'
      AND jsonb_array_length("current_bindings") > 0
    )
);

CREATE INDEX "watch_search_candidate_lease_generation_expires_at_idx"
  ON "watch_search_candidate_lease"("generation_id", "expires_at");
CREATE INDEX "watch_search_candidate_lease_transcript_identity_expires_at_idx"
  ON "watch_search_candidate_lease"(
    "transcript_collection",
    "transcript_projection_revision",
    "expires_at"
  );
CREATE INDEX "watch_search_candidate_lease_expires_at_idx"
  ON "watch_search_candidate_lease"("expires_at");

-- Identity columns never change after the BUILDING owner is created. Mutable
-- lifecycle evidence is deliberately outside this list and changes only by CAS.
CREATE FUNCTION "reject_watch_search_candidate_identity_update"()
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
    OR NOT (NEW."deletion_progress"->'deletedCollections' @> NEW."owned_collections")
    OR NOT (NEW."owned_collections" @> NEW."deletion_progress"->'deletedCollections')
  ) THEN
    RAISE EXCEPTION 'retired watch search candidate requires complete deletion progress';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "watch_search_candidate_generation_identity_guard"
BEFORE UPDATE ON "watch_search_candidate_generation"
FOR EACH ROW
EXECUTE FUNCTION "reject_watch_search_candidate_identity_update"();

-- Qualification evidence is append-only; a new run creates a new row.
CREATE FUNCTION "reject_watch_search_candidate_qualification_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'watch search candidate qualification evidence is append-only';
END
$$;

CREATE TRIGGER "watch_search_candidate_qualification_update_guard"
BEFORE UPDATE OR DELETE ON "watch_search_candidate_qualification"
FOR EACH ROW
EXECUTE FUNCTION "reject_watch_search_candidate_qualification_mutation"();
