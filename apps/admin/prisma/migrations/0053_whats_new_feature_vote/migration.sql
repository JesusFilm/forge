-- Anonymous sticker votes from /watch/whats-new.
CREATE TABLE "whats_new_feature_vote" (
    "id" TEXT NOT NULL,
    "ballot_id" VARCHAR(80) NOT NULL,
    "placement_id" VARCHAR(80) NOT NULL,
    "feature_id" VARCHAR(64) NOT NULL,
    "sticker_id" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retracted_at" TIMESTAMP(3),

    CONSTRAINT "whats_new_feature_vote_pkey" PRIMARY KEY ("id")
);

-- Makes a cast idempotent: a retried send lands on the same row.
CREATE UNIQUE INDEX "whats_new_feature_vote_ballot_placement_key"
ON "whats_new_feature_vote"("ballot_id", "placement_id");

-- Tally reads filter on retracted_at IS NULL.
CREATE INDEX "whats_new_feature_vote_feature_idx"
ON "whats_new_feature_vote"("feature_id", "retracted_at");

-- Budget checks count a ballot's live votes.
CREATE INDEX "whats_new_feature_vote_ballot_idx"
ON "whats_new_feature_vote"("ballot_id", "retracted_at");
