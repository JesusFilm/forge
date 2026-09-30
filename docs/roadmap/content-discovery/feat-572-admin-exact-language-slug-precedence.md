---
id: "feat-572"
title: "Admin preferred-dub matcher ranks exact language slug above BCP-47 tag"
owner: "unassigned"
priority: "P2"
status: "in-progress"
start_date: "2026-09-29"
duration: 1
depends_on: []
blocks: []
tags:
  - "graphql"
  - "web"
  - "i18n"
---

## Problem

Admin selects a video's preferred dub from `languageSlug` alone, and its
matcher admits a dub when the requested value equals the language's `slug`
**or** its `bcp47` tag, with both matches in the same rank tier. When two
languages share a BCP-47 tag and one of them has a slug equal to that tag, the
longer dub wins regardless of which language the visitor asked for.

Production example: `/watch/jesus.html/yao.html` asks for slug `yao`. Both the
`yao` language (slug `yao`, bcp47 `yao`) and `yao-tanzania` (bcp47 `yao`) match
tier 0, the `yao-tanzania` dub is longer, so admin returns it and web issues a
`307` to `yao-tanzania.html?_lr=1`. Fourteen corpus languages have
`slug === bcp47` (adi, fwe, hre, ife, jeh, luo, oku, omi, rao, tal, tiv, vai,
yao, zia); today only `yao` collides in the catalog, but any future sibling
dialect sharing a tag reproduces it.

Found while landing forge#2291 (feat: web passes runtime-admitted slugs to
admin). Web now sends the right slug; admin must honour it.

## Entry Points — Read These First

1. `apps/admin/src/services/video.service.ts` — `findPreferredPlayableVariantRow` (the Watch route snapshot matcher web hits) and `getPreferredPlayableDub` (scalar sibling, no production caller today). Look for the `ORDER BY CASE … l.slug = requested.audio_language_slug OR l.bcp47 = …` tier. The same file's `getWatchCollectionFeed` has a fourth matcher, the `selected_playback` LATERAL (`playback_language.slug = … OR playback_language.bcp47 = …`), that picks one dub per collection child.
2. `apps/admin/src/services/preferred-playable-dub.service.ts` — `getPreferredPlayableDubs`, the batched DataLoader matcher behind `Video.preferredDub`. Its `exact` LATERAL originally ordered only by duration (pre-fix state).
3. `apps/admin/src/services/search-watchability.db.test.ts` — the real-PostgreSQL suite (`WATCH_SEARCH_DB_TEST=1`) where dub-selection policy is pinned; mocked SQL-shape tests cannot prove tier order.
4. `apps/web/src/lib/content.ts` — `contentIdentityForWatchLanguage`, the web half of this contract (what reaches admin as `languageSlug`).

## Grep These

- `l.bcp47 = requested.audio_language_slug`
- `l.slug = ${language} OR l.bcp47 = ${language}`
- `OR: [{ slug: normalizedLanguageSlug }, { bcp47: normalizedLanguageSlug }]` (pre-fix scalar shape; now a loop over `{ slug }` then `{ bcp47 }`)
- `playback_language.bcp47 =` (collection feed `selected_playback`)
- `getPreferredPlayableDubs(`
- `WITH requested AS`

## What To Build

Rank an exact `language.slug` match strictly above a `language.bcp47` match in
all four matchers (the three above plus the collection feed's per-child
`selected_playback` LATERAL), keeping every other tier (primary language, longest
duration, id tie-break, subtitle-aware ordering) unchanged.

```sql
-- findPreferredPlayableVariantRow ORDER BY, first CASE
CASE
  WHEN requested.audio_language_slug IS NOT NULL
    AND l.slug = requested.audio_language_slug THEN 0
  WHEN requested.audio_language_slug IS NOT NULL
    AND l.bcp47 = requested.audio_language_slug THEN 1
  WHEN v.primary_language_id IS NOT NULL
    AND vd.language_id = v.primary_language_id THEN 2
  ELSE 3
END ASC
```

```sql
-- getPreferredPlayableDubs "exact" LATERAL
ORDER BY (l.slug = ${language}) DESC NULLS LAST, d.duration DESC, d.id ASC LIMIT 1
```

The collection feed's `selected_playback` LATERAL uses the same four-tier CASE
(`playback_language.slug` 0 / `playback_language.bcp47` 1 / primary 2 / else 3).

The scalar `getPreferredPlayableDub` runs the slug lookup first and only falls
through to the bcp47 lookup on a miss.

Add a real-DB case: two languages sharing a bcp47 tag, one whose slug equals
that tag, the other's dub longer; requesting the tag-equal slug must return the
exact-slug language's dub from both `getPreferredPlayableDubs` and
`getWatchRouteSnapshotBySlug`, and requesting the other slug must still return
its own dub. Fixture dubs carry no Mux row so the snapshot path schedules no
poster work.

## Constraints

- Do not drop the bcp47 fallback: a slug that only matches a tag (web sends
  bcp47-shaped values for some legacy routes) must keep resolving.
- No schema change, no migration, no change to `schema.graphql`.
- Do not touch web's `contentIdentityForWatchLanguage`; the web half shipped in
  forge#2291.
- Keep the mocked `video.service.test.ts` SQL-shape assertions honest: pin that
  the slug tier appears before the bcp47 tier, and label them as shape-only.

## Verification

```bash
docker run -d --name forge-admin-test-pg -e POSTGRES_USER=forge -e POSTGRES_PASSWORD=forge \
  -e POSTGRES_DB=forge_admin -p 127.0.0.1:5433:5432 pgvector/pgvector:pg18-trixie
DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
  pnpm --filter @forge/admin exec prisma migrate deploy
DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' WATCH_SEARCH_DB_TEST=1 \
  pnpm --filter @forge/admin test -- src/services/search-watchability.db.test.ts
pnpm --filter @forge/admin test -- src/services/video.service.test.ts src/services/preferred-playable-dub.service.test.ts
pnpm --filter @forge/admin typecheck && pnpm --filter @forge/admin lint
```

Post-deploy: `curl -sI https://www.jesusfilm.org/watch/jesus.html/yao.html`
returns `200` with no `?_lr=1` redirect, and `yao-tanzania.html` still returns
`200`.
