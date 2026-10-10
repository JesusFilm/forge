-- Read-only optimistic inventory ceiling for UI locale en. Includes uncurated
-- content and does not subtract title/Core-prefix/embedding duplicates. A result
-- below six therefore proves an inventory gap; a result above six proves no
-- recommendation guarantee. Run inside a READ ONLY transaction.
SELECT lang.slug AS "audioLanguageSlug", lang.core_id AS "coreLanguageId",
  count(DISTINCT v.id)::int AS "eligibleVideoIdsUpperBound"
FROM language lang
LEFT JOIN video_dub d ON d.language_id = lang.id
  AND d.deleted_at IS NULL AND d.published
LEFT JOIN mux_video m ON m.id = d.mux_video_id AND m.deleted_at IS NULL
  AND NULLIF(BTRIM(m.playback_id), '') IS NOT NULL AND LENGTH(m.playback_id) <= 512
LEFT JOIN video_edition edition ON edition.id = d.video_edition_id
LEFT JOIN video v ON v.id = d.video_id AND m.id IS NOT NULL
  AND (d.video_edition_id IS NULL OR edition.deleted_at IS NULL)
  AND v.deleted_at IS NULL AND NOT ('watch' = ANY(v.restrict_view_platforms))
  AND v.slug ~ '^[a-z0-9_-]+$'
  AND EXISTS (
    SELECT 1 FROM video_locale l WHERE l.video_id = v.id AND l.locale = 'en'
      AND l.status = 'published' AND l.deleted_at IS NULL
      AND NULLIF(BTRIM(l.title), '') IS NOT NULL AND LENGTH(l.title) <= 512
  )
  AND EXISTS (
    SELECT 1 FROM video_image i WHERE i.video_id = v.id AND i.deleted_at IS NULL
      AND COALESCE(NULLIF(BTRIM(i.mobile_cinematic_high), ''),
        NULLIF(BTRIM(i.video_still), ''), NULLIF(BTRIM(i.thumbnail), ''),
        NULLIF(BTRIM(i.url), '')) ~ '^https://'
  )
WHERE lang.deleted_at IS NULL AND lang.slug IS NOT NULL
GROUP BY lang.slug, lang.core_id
ORDER BY lang.slug;
