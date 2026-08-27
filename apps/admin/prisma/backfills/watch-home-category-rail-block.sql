-- Reviewed post-deploy activation for the Watch homepage category rail.
-- Run only after the new Admin schema is healthy and every old Admin instance
-- has drained. The row updates and durable completion marker are atomic,
-- idempotent, and intentionally leave malformed JSON untouched.
DO $$
DECLARE
  category_block jsonb := jsonb_build_object(
    't', 'watchHomeCategoryRail',
    'sectionKey', 'watch-home-category-rail',
    'categoryIds', jsonb_build_array(
      'jesus',
      'gospels',
      'short-videos',
      'family',
      'relationships',
      'women',
      'students',
      'sports',
      'good-news',
      'hope',
      'training',
      'easter',
      'christmas'
    )
  );
BEGIN
  -- Serialize activation attempts and make the durable marker the one-shot
  -- boundary. A later rerun must not recreate a rail an admin intentionally
  -- removed after activation.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('watch-home-category-rail-backfill-v1', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM sync_state
    WHERE phase = 'watch-home-category-rail-backfill-v1'
  ) THEN
    RETURN;
  END IF;

  WITH canonical_targets AS (
    SELECT
      locale.id,
      locale.blocks,
      (
        SELECT min(item.ordinality)::integer - 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS item(value, ordinality)
        WHERE item.value ->> 't' = 'watchHomeHero'
      ) AS hero_index
    FROM experience_locale AS locale
    WHERE locale.is_homepage = true
      AND jsonb_typeof(locale.blocks) = 'array'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(locale.blocks) = 'array' THEN locale.blocks
            ELSE '[]'::jsonb
          END
        ) AS item(value)
        WHERE item.value ->> 't' = 'watchHomeCategoryRail'
      )
  )
  UPDATE experience_locale AS locale
  SET blocks = CASE
    WHEN target.hero_index IS NULL THEN
      jsonb_insert(target.blocks, '{0}', category_block, false)
    ELSE
      jsonb_insert(
        target.blocks,
        ARRAY[target.hero_index::text],
        category_block,
        true
      )
    END
  FROM canonical_targets AS target
  WHERE locale.id = target.id;

  WITH draft_targets AS (
    SELECT
      revision.id,
      revision.snapshot,
      revision.snapshot #> '{data,blocks}' AS blocks,
      (
        SELECT min(item.ordinality)::integer - 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
              THEN revision.snapshot #> '{data,blocks}'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS item(value, ordinality)
        WHERE item.value ->> 't' = 'watchHomeHero'
      ) AS hero_index
    FROM content_revision AS revision
    INNER JOIN experience_locale AS locale
      ON locale.id = revision.entity_id
    WHERE revision.entity_type = 'ExperienceLocale'
      AND revision.status = 'draft'
      AND jsonb_typeof(revision.snapshot) = 'object'
      AND jsonb_typeof(revision.snapshot -> 'data') = 'object'
      AND jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
      AND COALESCE(
        CASE
          WHEN jsonb_typeof(revision.snapshot #> '{data,isHomepage}') = 'boolean'
            THEN (revision.snapshot #>> '{data,isHomepage}')::boolean
          ELSE NULL
        END,
        locale.is_homepage
      ) = true
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(revision.snapshot #> '{data,blocks}') = 'array'
              THEN revision.snapshot #> '{data,blocks}'
            ELSE '[]'::jsonb
          END
        ) AS item(value)
        WHERE item.value ->> 't' = 'watchHomeCategoryRail'
      )
  )
  UPDATE content_revision AS revision
  SET snapshot = jsonb_set(
    target.snapshot,
    '{data,blocks}',
    CASE
      WHEN target.hero_index IS NULL THEN
        jsonb_insert(target.blocks, '{0}', category_block, false)
      ELSE
        jsonb_insert(
          target.blocks,
          ARRAY[target.hero_index::text],
          category_block,
          true
        )
    END,
    false
  )
  FROM draft_targets AS target
  WHERE revision.id = target.id;

  INSERT INTO sync_state (phase, last_synced_at, stats, updated_at)
  VALUES (
    'watch-home-category-rail-backfill-v1',
    CURRENT_TIMESTAMP,
    '{"completed":true,"artifact":"watch-home-category-rail-block.sql"}'::jsonb,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (phase) DO NOTHING;
END $$;
