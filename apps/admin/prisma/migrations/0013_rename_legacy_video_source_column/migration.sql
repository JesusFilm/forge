DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'video'
      AND column_name = 'videoSource'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'video'
      AND column_name = 'video_source'
  ) THEN
    ALTER TABLE "video" RENAME COLUMN "videoSource" TO "video_source";
  END IF;
END $$;
