ALTER TABLE "video_subtitle"
  ADD COLUMN "vtt_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "srt_version" INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN "video_subtitle"."vtt_version" IS
  'Core VTT source version used by subtitle checksum parity reconciliation.';

COMMENT ON COLUMN "video_subtitle"."srt_version" IS
  'Core SRT source version used by subtitle checksum parity reconciliation.';
