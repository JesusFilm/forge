---
title: "Watch blank localized title fallback"
date: 2026-08-06
category: ui-bugs
module: watch
problem_type: ui_bug
component: service_object
symptoms:
  - "Arabic Watch inventory cards displayed raw content slugs instead of readable titles."
  - "Linked collection headings could be blank while requested-language descriptions remained populated."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - "watch"
  - "localization"
  - "title-fallback"
  - "language-inventory"
  - "rtl"
---

# Watch blank localized title fallback

## Problem

Watch treated the presence of a requested-language locale row as proof that
every localized field was usable. When that row contained an Arabic
description but a blank or whitespace-only title, inventory cards fell through
to the raw slug and linked collection headings could remain blank even though a
published English title existed.

Title fallback must be field-level: requested-language title, published
English title, then a humanized slug. Other fields must continue to come from
the requested-language row.

## Symptoms

- Cards rendered values such as `lumo-the-gospel-of-mark`.
- Inventory cards and linked collection pages disagreed about the same title.
- Arabic descriptions and surrounding RTL UI were present, so replacing the
  whole locale row with English would have discarded valid localized copy.
- Empty and whitespace-only titles behaved differently.

## What Didn't Work

- Selecting title and description from one Admin locale row coupled two fields
  with different availability. `NULLIF(title, '')` also missed whitespace-only
  values.
- Replacing the requested Web locale array with the English array fixed the
  heading but also replaced the requested description, snippet, image alt, and
  other localized metadata.
- Falling directly from a blank requested title to the slug skipped an existing
  published English title and exposed URL formatting in the UI.

## Solution

Admin resolves display titles independently from the metadata locale. After
`prelimited_candidates`, it materializes a bounded set of published, nonblank
title rows and ranks each video by requested language ID, requested language
slug, requested BCP-47 locale, English language slug, and English locale:

```sql
title_locale AS MATERIALIZED (
  SELECT DISTINCT ON (locale.video_id)
    locale.video_id AS "videoId",
    NULLIF(BTRIM(locale.title), '') AS title
  FROM title_video_id title_video
  JOIN video_locale locale ON locale.video_id = title_video.id
  JOIN inventory_language ON TRUE
  WHERE locale.deleted_at IS NULL
    AND locale.status = 'published'
    AND NULLIF(BTRIM(locale.title), '') IS NOT NULL
    AND (
      locale.language_id = inventory_language.id
      OR locale.language_slug = inventory_language.slug
      OR locale.locale = inventory_language.bcp47
      OR locale.language_slug = 'english'
      OR locale.locale = 'en'
    )
  ORDER BY locale.video_id, /* requested identity, then English */
    locale.updated_at DESC, locale.id
)
```

Cards and parent references use the selected title before the final slug
safety fallback:

```sql
COALESCE(
  candidate_title_locale.title,
  NULLIF(
    INITCAP(REGEXP_REPLACE(BTRIM(candidate.slug), '[-_]+', ' ', 'g')),
    ''
  ),
  candidate."coreId",
  candidate.id
) AS title
```

Web keeps exact, broad requested-language, and English locale rows in that
order. It appends a fallback layer only while no preceding row has a nonblank
title, then scans the ordered rows for the first usable title:

```ts
function mergeLocaleTitleFallback(localized, fallback) {
  const localizedRows = [...(localized ?? [])]
  if (firstNonBlankLocaleTitle(localizedRows)) return localizedRows
  return [...localizedRows, ...(fallback ?? [])]
}
```

The first requested row remains the source for non-title fields. Root, parent,
top-level child, and nested child normalizers all use the same final
`humanizeContentSlug(slug)` safety fallback. Unrelated locale titles are never
admitted.

## Why This Works

Locale-row availability no longer stands in for title availability. Requested
metadata remains first and unchanged, while title selection may continue to a
later requested row or to published English. The deterministic slug humanizer
runs only after all permitted authored titles are exhausted.

Keeping Admin title resolution after candidate pre-limiting preserves the flat,
card-ready read model without adding per-card Web requests. On a representative
659-item Arabic inventory, the first resolver request after restart completed
in 0.96 seconds, the warm request in 0.175 seconds, and direct SQL execution in
77 milliseconds.

## Prevention

- Treat localized fields independently when one row can mix present and
  missing values.
- Define blank authored text with trimming, and test empty strings,
  whitespace-only strings, and surrounding whitespace.
- Test the complete ladder: later requested row, published English, unrelated
  locale rejection, and repeated-separator slug humanization.
- Cover root, parent, top-level child, and nested child titles so cards and
  destinations cannot diverge.
- Keep title SQL after candidate reduction and re-profile representative
  inventory data whenever localization joins change.
- Browser-smoke an RTL inventory and a linked collection, including console
  inspection and preservation of requested-language copy.

## Related Issues

- `docs/solutions/performance-issues/watch-language-inventory-candidate-first-sql-20260713.md`
- `docs/solutions/performance-issues/watch-non-cloudflare-performance-hardening-20260611.md`
- `docs/solutions/integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md`
- `docs/solutions/architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md`
- No directly matching GitHub issue was found in the bounded search.
