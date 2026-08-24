-- Better Auth 1.7 persistence expansion. This migration is intentionally
-- additive: the 1.6.2 columns (`public`, `type`, callback arrays, and the
-- provider/account unique key) remain available to a rolled-back runtime.

-- Account issuer is finalized by seed:first-party-apps after it installs an
-- explicit provider mapping and performs collision checks. Leaving it nullable
-- during this SQL phase lets the migration fail safely before application
-- startup when an operator mapping is missing.
ALTER TABLE "account" ADD COLUMN "issuer" TEXT;

CREATE TABLE "auth_account_issuer_mapping" (
    "provider_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_account_issuer_mapping_pkey" PRIMARY KEY ("provider_id")
);

-- Better Auth 1.6.2 does not write Account.issuer. Retain rollback write
-- compatibility by filling it exclusively from the trusted operator map.
-- Unknown providers and mismatched explicit issuers fail closed.
CREATE FUNCTION "set_trusted_account_issuer"() RETURNS trigger AS $$
DECLARE
    trusted_issuer TEXT;
BEGIN
    SELECT "issuer" INTO trusted_issuer
    FROM "auth_account_issuer_mapping"
    WHERE "provider_id" = NEW."provider_id";

    IF trusted_issuer IS NULL THEN
        RAISE EXCEPTION 'No trusted account issuer mapping for provider %', NEW."provider_id";
    END IF;

    IF NEW."issuer" IS NULL THEN
        NEW."issuer" := trusted_issuer;
    ELSIF NEW."issuer" <> trusted_issuer THEN
        RAISE EXCEPTION 'Account issuer does not match trusted mapping for provider %', NEW."provider_id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "account_trusted_issuer"
BEFORE INSERT OR UPDATE OF "provider_id", "issuer" ON "account"
FOR EACH ROW EXECUTE FUNCTION "set_trusted_account_issuer"();

ALTER TABLE "oauth_client"
    ADD COLUMN "client_discovery_id" TEXT,
    ADD COLUMN "client_credentials_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "backchannel_logout_uri" TEXT,
    ADD COLUMN "backchannel_logout_session_required" BOOLEAN,
    ADD COLUMN "application_type" TEXT,
    ADD COLUMN "jwks" TEXT,
    ADD COLUMN "jwks_uri" TEXT,
    ADD COLUMN "dpop_bound_access_tokens" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the observed 1.6.2 public/confidential posture. A null auth method
-- was private-by-default in 1.6.2; only explicitly public clients become none.
UPDATE "oauth_client"
SET "token_endpoint_auth_method" = CASE
        WHEN "public" IS TRUE THEN 'none'
        ELSE 'client_secret_basic'
    END
WHERE "token_endpoint_auth_method" IS NULL;

UPDATE "oauth_client"
SET "client_credentials_scopes" = CASE
        WHEN 'client_credentials' = ANY("grant_types") THEN "scopes"
        ELSE ARRAY[]::TEXT[]
    END;

-- RFC 7591 native clients use loopback/custom-scheme redirects. Empty and
-- ordinary HTTPS registrations retain the 1.6.2 web default; the managed
-- Codex seed explicitly classifies its redirect-less CLI client as native.
UPDATE "oauth_client" client
SET "application_type" = CASE
        WHEN cardinality(client."redirect_uris") > 0
          AND NOT EXISTS (
              SELECT 1
              FROM unnest(client."redirect_uris") AS redirect(uri)
              WHERE redirect.uri ~ '^https?://'
                AND redirect.uri !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/'
          )
        THEN 'native'
        ELSE 'web'
    END
WHERE "application_type" IS NULL;

CREATE TABLE "oauth_resource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token_ttl" INTEGER,
    "refresh_token_ttl" INTEGER,
    "signing_algorithm" TEXT,
    "signing_key_id" TEXT,
    "allowed_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "custom_claims" JSONB,
    "dpop_bound_access_tokens_required" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_resource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_resource_identifier_key"
ON "oauth_resource"("identifier");

CREATE TABLE "oauth_client_resource" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_client_resource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_client_resource_client_id_resource_id_key"
ON "oauth_client_resource"("client_id", "resource_id");
CREATE INDEX "oauth_client_resource_client_id_idx"
ON "oauth_client_resource"("client_id");
CREATE INDEX "oauth_client_resource_resource_id_idx"
ON "oauth_client_resource"("resource_id");

ALTER TABLE "oauth_client_resource"
ADD CONSTRAINT "oauth_client_resource_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_client_resource"
ADD CONSTRAINT "oauth_client_resource_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_refresh_token"
    ADD COLUMN "authorization_code_id" TEXT,
    ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "requested_user_info_claims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "rotated_at" TIMESTAMP(3),
    ADD COLUMN "rotation_replay_response" TEXT,
    ADD COLUMN "rotation_replay_expires_at" TIMESTAMP(3),
    ADD COLUMN "confirmation" JSONB;

CREATE UNIQUE INDEX "oauth_refresh_token_token_key"
ON "oauth_refresh_token"("token");
CREATE INDEX "oauth_refresh_token_authorization_code_id_idx"
ON "oauth_refresh_token"("authorization_code_id");

ALTER TABLE "oauth_access_token"
    ADD COLUMN "authorization_code_id" TEXT,
    ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "requested_user_info_claims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "revoked" TIMESTAMP(3),
    ADD COLUMN "confirmation" JSONB;

CREATE INDEX "oauth_access_token_authorization_code_id_idx"
ON "oauth_access_token"("authorization_code_id");

ALTER TABLE "oauth_consent"
    ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "requested_user_info_claims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "oauth_client_assertion" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertion_pkey" PRIMARY KEY ("id")
);

-- No down migration: application rollback retains this expanded schema, the
-- trusted issuer map, and its compatibility trigger through the soak window.
