ALTER TABLE recommendation_request ALTER COLUMN seed_media_id DROP NOT NULL;
ALTER TABLE recommendation_request ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'seeded';
ALTER TABLE recommendation_request ADD CONSTRAINT recommendation_request_purpose_seed_check CHECK ((purpose = 'seeded' AND seed_media_id IS NOT NULL) OR (purpose = 'user' AND seed_media_id IS NULL));
CREATE TABLE recommendation_viewer (
 token_digest CHAR(64) PRIMARY KEY,
 profile_digest CHAR(64),
 consent_receipt_digest CHAR(64) NOT NULL,
 expires_at TIMESTAMP(3) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX recommendation_viewer_expires_at_idx ON recommendation_viewer(expires_at);
