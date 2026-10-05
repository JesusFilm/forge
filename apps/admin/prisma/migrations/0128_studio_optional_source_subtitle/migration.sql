-- Missing captions do not change playable source identity or retention.
ALTER TABLE "short_source_snapshot" ALTER COLUMN "track_id" DROP NOT NULL;
