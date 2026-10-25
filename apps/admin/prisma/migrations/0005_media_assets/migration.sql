-- Admin media asset library.
--
-- MediaAsset is the canonical editorial identity for uploaded/reusable media.
-- Storage keys, Mux IDs, local fallback paths, and preview keys are backend
-- details. This deliberately does not replace VideoImage, which remains
-- Core/video-derived poster and still metadata.

CREATE TYPE "MediaAssetKind" AS ENUM ('image', 'video', 'pdf', 'file');
CREATE TYPE "MediaAssetBackend" AS ENUM ('local', 's3', 'mux');
CREATE TYPE "MediaAssetStatus" AS ENUM (
    'pending',
    'uploading',
    'processing',
    'ready',
    'failed',
    'missing'
);
CREATE TYPE "MediaAssetVisibility" AS ENUM ('private', 'public');

CREATE TABLE "media_asset" (
    "id"                TEXT                   PRIMARY KEY,
    "kind"              "MediaAssetKind"       NOT NULL,
    "backend"           "MediaAssetBackend"    NOT NULL,
    "status"            "MediaAssetStatus"     NOT NULL DEFAULT 'pending',
    "visibility"        "MediaAssetVisibility" NOT NULL DEFAULT 'private',
    "display_name"      TEXT                   NOT NULL,
    "description"       TEXT,
    "alt_text"          TEXT,
    "mime_type"         TEXT                   NOT NULL,
    "byte_size"         BIGINT,
    "width"             INTEGER,
    "height"            INTEGER,
    "duration_ms"       BIGINT,
    "original_filename" TEXT,
    "checksum_sha256"   TEXT,
    "object_key"        TEXT,
    "preview_object_key" TEXT,
    "mux_asset_id"      TEXT,
    "mux_upload_id"     TEXT,
    "mux_playback_id"   TEXT,
    "error_code"        TEXT,
    "error_message"     TEXT,
    "created_by_id"     TEXT,
    "created_at"        TIMESTAMPTZ            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ            NOT NULL,
    CONSTRAINT "media_asset_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL
);

CREATE INDEX "media_asset_kind_status_updated_at_idx"
    ON "media_asset"("kind", "status", "updated_at");

CREATE INDEX "media_asset_backend_status_idx"
    ON "media_asset"("backend", "status");

CREATE INDEX "media_asset_visibility_idx"
    ON "media_asset"("visibility");

CREATE INDEX "media_asset_created_by_id_idx"
    ON "media_asset"("created_by_id");

CREATE INDEX "media_asset_display_name_idx"
    ON "media_asset"("display_name");
