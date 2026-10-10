import { Prisma } from "@prisma/client"

/** Named scalars only; use with the recommendation_shadow_nomination alias. */
export const shadowSlateProvenanceSql = Prisma.sql`COALESCE((
  SELECT jsonb_object_agg(entry.key, CASE
    WHEN jsonb_typeof(entry.value) = 'string'
      THEN to_jsonb(left(entry.value #>> '{}', 512))
    ELSE entry.value
  END)
  FROM jsonb_each(nomination.provenance) entry
  WHERE entry.key IN (
    'slatePolicy', 'slateRank', 'slatePosition', 'slateReasons',
    'slateScore', 'slateThemeSimilarity', 'slateSourceGain',
    'slateInterestGain', 'slateFallback', 'slateDecision',
    'slateLatencyMs', 'slateSourceCoverage', 'slateInterestCoverage',
    'slateHistory', 'slateEditorial', 'slateThemeCoverage'
  )
  AND jsonb_typeof(entry.value) IN ('string', 'number')
  AND (jsonb_typeof(entry.value) = 'string' OR length(entry.value::text) <= 32)
), '{}'::jsonb)`
