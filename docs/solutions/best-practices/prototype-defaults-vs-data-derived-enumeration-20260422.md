---
title: "Prototype defaults vs data-derived enumeration: when a hardcoded language list becomes load-bearing, replace it with a query"
last_updated: 2026-04-22
problem_type: best_practice
component: service_object
root_cause: logic_error
resolution_type: workflow_improvement
severity: low
module: apps/admin
tags:
  - defaults
  - enumeration
  - language-handling
  - admin-migration
  - prototype-to-production
related_features:
  - feat-009
  - feat-041
related:
  - "docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md"
date_learned: 2026-04-22
---

## Problem

Prototype code tends to reach for hardcoded defaults (`["en", "es",
"fr"]`, `fallback = "en"`) because they're the path of least
resistance during early validation. When the prototype becomes
production, those defaults silently become API contract: every caller
inherits "this service covers en/es/fr" regardless of what the data
says. The shipped behavior makes promises about the corpus the code
cannot actually verify.

## Symptoms

Observed on PR #828 (R2 transcript embeddings, admin-migration
playbook) after the reviewer asked for `languages` to default to
"all the locales that exist for videos" instead of a prototype-era
hardcoded set:

### Before — prototype defaults

```ts
// transcriptEmbeddingBackfill.ts (prototype)
const DEFAULT_LANGUAGE_FALLBACK = "en" as const

// inside stepEnumerateTargets:
const rows = await prisma.$queryRaw<...>`
  SELECT DISTINCT v.id, e.id, v.core_id, l.bcp47
  FROM video v
  JOIN video_dub d ON d.video_id = v.id
  JOIN video_edition e ON e.id = d.video_edition_id
  LEFT JOIN language l ON l.id = v.primary_language_id
  WHERE v.deleted_at IS NULL AND d.deleted_at IS NULL AND e.deleted_at IS NULL
`

targets.push({
  ...,
  language: row.bcp47 ?? DEFAULT_LANGUAGE_FALLBACK,
})
```

The sibling R1 had `DEFAULT_LOCALES = ["en", "es", "fr"] as const` —
same shape, same problem. Two issues compounded:

1. **One language per video.** A video with subtitles in 5 languages
   still only produced a transcript for its primary language. The API
   advertised "filter by `languages`" but the enumeration never
   produced targets for the languages a caller might ask for.
2. **Silent 'en' fallback.** A video with no primary language still
   produced a target, stamped as 'en' regardless of what the audio
   actually was. Downstream search would return "this is English
   content" for something that isn't.

The `languages` arg appeared to work — passing `["es"]` silently
dropped everything because no video's resolved language was `es`
(either it was the primary or it was the fallback to en).

### After — data-derived enumeration

```sql
-- One row per (video, edition, bcp47) triple, where bcp47 comes
-- from the union of three content sources the video actually uses.
WITH edition_languages AS (
  -- Primary language (authored source)
  SELECT DISTINCT v.id, e.id, v.core_id, l.bcp47
  FROM video v
  JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
  JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
  JOIN language l ON l.id = v.primary_language_id
  WHERE v.deleted_at IS NULL AND l.bcp47 IS NOT NULL

  UNION

  -- Subtitle languages on this edition
  SELECT DISTINCT v.id, e.id, v.core_id, l.bcp47
  FROM video v
  JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
  JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
  JOIN video_subtitle s ON s.video_edition_id = e.id AND s.deleted_at IS NULL
  JOIN language l ON l.id = s.language_id
  WHERE v.deleted_at IS NULL AND l.bcp47 IS NOT NULL

  UNION

  -- Dub languages on this edition
  SELECT DISTINCT v.id, e.id, v.core_id, l.bcp47
  FROM video v
  JOIN video_dub d ON d.video_id = v.id AND d.deleted_at IS NULL
  JOIN video_edition e ON e.id = d.video_edition_id AND e.deleted_at IS NULL
  JOIN language l ON l.id = d.language_id
  WHERE v.deleted_at IS NULL AND l.bcp47 IS NOT NULL
)
SELECT video_id, video_edition_id, core_id, bcp47
FROM edition_languages
ORDER BY core_id, bcp47
```

The workflow returns one target per `(video, edition, bcp47)` triple
drawn from the content itself. `DEFAULT_LANGUAGE_FALLBACK` is gone.
A video with no language attestation anywhere produces no targets —
a data-quality signal, not a silent default.

## What Didn't Work

- **Keeping the prototype defaults + adding the API filter.** The
  `languages` arg was added before the enumeration matured. Callers
  saw an arg-shaped promise that didn't match runtime behavior
  (filter to `es` → zero targets → silent no-op report).
- **Expanding the hardcoded list.** Jesus Film content spans 200+
  languages at the catalog scope. Any fixed list is either too
  narrow (misses real content) or too broad (writes 200 identical
  transcripts per video while manager still produces one artifact).
  The data-derived path bounds the fan-out by content reality
  (typically 3–20 languages per video).
- **Inferring from `Video.primaryLanguage` alone.** Primary language
  is the audio-source signal, but a video's locales also live on
  `VideoSubtitle.languageId` and `VideoDub.languageId`. Filtering
  only by primary silently ignores the other two.

## Solution

Three concrete moves:

1. **Remove the hardcoded default list and the fallback constant.**
   Delete them entirely — leave no seam where a reader could think
   "maybe I should default to something."
2. **Query the data for the enumeration set.** A small CTE unioning
   the three content-source columns gives an accurate "every locale
   that exists for this content" result. Bound by the corpus, not by
   an author's guess.
3. **Keep the arg filter as a pure inclusion predicate.** Omitted
   means "all data-derived languages"; specified means "only these
   BCP-47 tags." No secret default floating around.

## Why This Works

**A prototype default encodes an assumption; a data-derived default
encodes a query.** Assumptions drift (the content grows; the caller
base shifts); queries re-run every time. The trade is one extra
join against Postgres per backfill run for an API contract that
actually matches reality.

Three properties make this failure mode specifically worth
documenting:

1. **The prototype defaults look harmless.** They ship as constants
   at the top of a file, easy to grep and easy to "update when we
   know more." They become load-bearing the day a caller filters
   against them.
2. **The API shape hides the default.** GraphQL introspection shows
   `languages: [String!]` with no indication of what happens when
   omitted. The default lives in workflow code the caller can't see.
3. **Tests lock in the prototype state.** Unit tests written
   against the prototype code confirm "filter to `["en"]` returns
   the 'en' target" — behavior that makes sense for the hardcoded
   default but is wrong for the general case.

## Prevention

### For the author

When adding an enumeration or filter arg with a "default = all"
semantic, **derive the "all" set from the data, not from a
constant.** Specifically:

1. Write the SQL/query for "all" before the arg is exposed.
2. Add the arg as a pure inclusion predicate over that set.
3. Never introduce a "fallback when the data is silent" rule —
   if the data is silent, the target shouldn't exist. Silent
   fallbacks hide data-quality signals.

When porting from a sibling module with its own prototype defaults
(`DEFAULT_LOCALES`, `DEFAULT_LANGUAGE_FALLBACK`), treat the
constants as code smells, not conventions to preserve. Copying them
forward perpetuates the prototype assumption.

### For the reviewer

Flag any arg description that ends with "Omitted = [hardcoded
list]" when the domain is intrinsically data-bounded (languages,
regions, content types, user-configurable enums). The hardcoded
list is almost always scaffolding. Ask the author what the data-
derived version of the set is.

The sibling question to ask: **"if a caller passes this arg as an
empty array, do they silently get the hardcoded default back?"** If
yes, the default is hiding in a surprising place and should either
be made visible in the SDL or replaced with "omitted = all".

### For the next enumeration

`apps/admin/src/workflows/sceneEmbeddingBackfill.ts` has the same
`DEFAULT_LOCALES = ["en", "es", "fr"]` pattern. It should get the
same treatment before R1 smoke goes green in production — currently
an R1 backfill run with `locales: omitted` only covers three
languages regardless of what scene content exists. Track as
follow-up work.

## Verification

- `rg -n 'DEFAULT_LANGUAGE|DEFAULT_LOCALES|fallback.*"en"' apps/admin/src/workflows/` —
  the transcript backfill should match zero; the scene backfill is
  the still-pending sibling.
- The enumeration SQL runs on a live disposable DB and produces the
  expected `(video, edition, bcp47)` triples for seeded content.
- The mutation's `languages: ["es"]` filter returns targets only
  when the corpus actually has Spanish content, not as a silent
  no-op.

## Related

- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — R2
  backfill, post-fix. CTE enumerates data-derived languages; no
  hardcoded fallback.
- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — R1
  sibling with `DEFAULT_LOCALES = ["en", "es", "fr"]` still in
  place. Pending the same treatment.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  — sibling learning: prototype scaffolding that survives a port
  can become load-bearing silently. Same family of failure mode,
  different axis (runtime assertions instead of default constants).
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
  — manager's source-language selection falls back to English in
  some cases. The data-derived enumeration here is honest about
  that drift because the fallback is manager's problem, not admin's.
