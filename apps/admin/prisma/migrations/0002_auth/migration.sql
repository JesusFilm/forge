-- =============================================================================
-- Better Auth tables (Unit 5)
-- =============================================================================

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

CREATE TABLE "user" (
    "id"              TEXT        PRIMARY KEY,
    "name"            TEXT        NOT NULL,
    "email"           TEXT        NOT NULL,
    "email_verified"  BOOLEAN     NOT NULL DEFAULT FALSE,
    "image"           TEXT,
    "role"            "UserRole"  NOT NULL DEFAULT 'VIEWER',
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX "user_email_key" ON "user"("email");
CREATE UNIQUE INDEX "user_email_lower_key" ON "user"(LOWER("email"));

CREATE TABLE "session" (
    "id"          TEXT        PRIMARY KEY,
    "expires_at"  TIMESTAMPTZ NOT NULL,
    "token"       TEXT        NOT NULL UNIQUE,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL,
    "ip_address"  TEXT,
    "user_agent"  TEXT,
    "user_id"     TEXT        NOT NULL,
    CONSTRAINT "session_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "session_user_id_idx" ON "session"("user_id");

CREATE TABLE "account" (
    "id"                         TEXT        PRIMARY KEY,
    "account_id"                 TEXT        NOT NULL,
    "provider_id"                TEXT        NOT NULL,
    "user_id"                    TEXT        NOT NULL,
    "access_token"               TEXT,
    "refresh_token"              TEXT,
    "id_token"                   TEXT,
    "access_token_expires_at"    TIMESTAMPTZ,
    "refresh_token_expires_at"   TIMESTAMPTZ,
    "scope"                      TEXT,
    "password"                   TEXT,
    "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                 TIMESTAMPTZ NOT NULL,
    CONSTRAINT "account_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "account_provider_id_account_id_key"
    ON "account"("provider_id", "account_id");
CREATE INDEX "account_user_id_idx" ON "account"("user_id");

CREATE TABLE "verification" (
    "id"          TEXT        PRIMARY KEY,
    "identifier"  TEXT        NOT NULL,
    "value"       TEXT        NOT NULL,
    "expires_at"  TIMESTAMPTZ NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL
);

CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");
