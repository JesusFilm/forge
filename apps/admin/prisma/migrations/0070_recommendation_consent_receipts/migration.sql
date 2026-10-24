-- U4: recommendation-personalization consent is separate from the protected
-- profile token and from the purpose-limited 24-hour operational session.
CREATE TYPE "RecommendationConsentChoice" AS ENUM (
  'essential_only',
  'personalization'
);
CREATE TYPE "RecommendationConsentReceiptState" AS ENUM (
  'active',
  'revoked',
  'expired'
);

CREATE TABLE "recommendation_consent_receipt" (
  "id" TEXT NOT NULL,
  "token_digest" CHAR(64),
  "contract_version" VARCHAR(64) NOT NULL,
  "choice" "RecommendationConsentChoice" NOT NULL,
  "state" "RecommendationConsentReceiptState" NOT NULL DEFAULT 'active',
  "profile_id" TEXT,
  "privacy_generation" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoke_reason" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_consent_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_consent_receipt_choice_generation_check" CHECK (
    (
      "choice" = 'essential_only'
      AND "profile_id" IS NULL
      AND "privacy_generation" = 0
    ) OR (
      "choice" = 'personalization'
      AND "privacy_generation" >= 1
      AND (
        ("state" = 'active' AND "profile_id" IS NOT NULL)
        OR ("state" IN ('revoked', 'expired') AND "profile_id" IS NULL)
      )
    )
  ),
  CONSTRAINT "recommendation_consent_receipt_state_check" CHECK (
    (
      "state" = 'active'
      AND "token_digest" IS NOT NULL
      AND "revoked_at" IS NULL
      AND "revoke_reason" IS NULL
    ) OR (
      "state" IN ('revoked', 'expired')
      AND "token_digest" IS NULL
      AND "revoked_at" IS NOT NULL
      AND "revoke_reason" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "recommendation_consent_receipt_token_key"
  ON "recommendation_consent_receipt"("token_digest");
CREATE INDEX "recommendation_consent_receipt_state_expiry_idx"
  ON "recommendation_consent_receipt"("state", "expires_at");
CREATE INDEX "recommendation_consent_receipt_profile_generation_idx"
  ON "recommendation_consent_receipt"("profile_id", "privacy_generation");
CREATE UNIQUE INDEX "recommendation_consent_receipt_active_profile_generation_key"
  ON "recommendation_consent_receipt"("profile_id", "privacy_generation")
  WHERE "state" = 'active'
    AND "choice" = 'personalization';

ALTER TABLE "recommendation_consent_receipt"
  ADD CONSTRAINT "recommendation_consent_receipt_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "recommendation_consent_receipt" IS
  'Server authority for the versioned Watch recommendation-personalization choice. Stores only a one-way opaque receipt digest. Essential-only rows have no profile link; revoked or expired rows cannot authorize serving.';
