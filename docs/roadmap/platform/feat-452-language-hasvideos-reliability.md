---
id: "feat-452"
title: "Make admin Language.hasVideos a reliable video-availability signal"
owner: "tanflem"
priority: "P1"
status: "not-started"
start_date: "2026-09-08"
duration: 5
depends_on: []
blocks: []
tags:
  - "graphql"
  - "i18n"
  - "watch"
  - "pgvector"
---

## Problem

`Language.hasVideos` (exposed on the public core GraphQL API and mirrored into admin) under-reports.
feat-450's audit of the watch-language allowlist found `blang` (admin id `139769`, bcp47 `blr`) reading
`hasVideos: false` while independently confirmed, via the JESUS video's (`1_jf-0-0`)
`variantLanguagesWithSlug`, to have a genuinely live, playable `jesus/blang` variant. `blang` is also
absent entirely from the general paginated `languages(offset, limit)` listing, even though a direct
`language(id: "139769", idType: databaseId)` lookup returns it correctly — suggesting whatever backs
`hasVideos` (and possibly the general listing's own filter) is not derived directly from the presence of
published video variants.

This matters beyond the one-off manual patch in feat-450: any future tooling (feat-451's generator
rebuild, admin search/filtering, mobile/TV catalog surfaces) that wants to gate on "does this language
have real content" cannot trust this field today, and has to fall back on slow, manual, per-language
video-variant cross-checks instead.

## Entry Points — Read These First

1. Whatever resolver/service backs `Language.hasVideos` on the core API — likely in the Core
   monorepo/service that owns the `Language` table (this field is exposed through
   `https://api-gateway.central.jesusfilm.org/`, not through `apps/admin`'s own Pothos schema — confirm
   which system of record actually computes it before assuming it's an `apps/admin` fix).
2. `apps/admin/src/graphql/types/` — check whether admin's own GraphQL surface re-exposes or caches this
   field anywhere, in case admin needs a corresponding fix once the source is corrected.
3. `docs/roadmap/platform/feat-450-watch-language-allowlist-missing-blang.md` — Resolution section has the
   concrete repro (`blang`, id `139769`) and the live-query evidence trail.
4. `docs/roadmap/platform/feat-451-watch-language-allowlist-generator-rebuild.md` — sibling ticket that
   would ideally consume a corrected `hasVideos` directly instead of re-deriving its own inclusion
   heuristic. Not a hard dependency (feat-451 can proceed independently with its own heuristic), but
   coordinate sequencing if both are being picked up around the same time.

## Grep These

- `hasVideos`
- `variantLanguagesWithSlug`

## What To Build

1. Identify where `hasVideos` is actually computed (which service, which query/table join) and determine
   why it can read `false` for a language with a confirmed live, published video variant.
2. Fix the computation so `hasVideos` reflects actual published-variant presence — likely by deriving it
   directly from the same join a video's `variantLanguagesWithSlug` uses, rather than whatever separate
   mechanism it currently uses.
3. Investigate whether the general paginated `languages(offset, limit)` listing shares the same root
   cause as its omission of `blang` (a language confirmed real and content-bearing via direct-id lookup)
   — if so, fix both together; if they're unrelated, document why and file a follow-up.
4. Add regression coverage: a fixture language with a published variant but a stale/absent `hasVideos`
   cache (if the bug is caching-related) must read `true` after the fix.

## Constraints

- Do not weaken `hasVideos` into an even-more-approximate heuristic (e.g. "any transcript exists") — the
  goal is a field other tools can trust as a hard signal, not a softer one.
- This is a data-correctness fix at the source, not a `apps/web`/`apps/admin` consumer-side workaround —
  do not attempt to patch this by adding another allowlist/heuristic in `apps/web` or
  `packages/watch-url-policy`; that just re-creates feat-450's stale-snapshot problem one layer over.
- Out of scope: rebuilding the watch-language allowlist generator itself (feat-451) and resolving the
  `lala` duplicate-slug anomaly (also tracked under feat-451) — this ticket is scoped to the `hasVideos`
  field's correctness only.

## Verification

- A live query for `language(id: "139769", idType: databaseId) { hasVideos }` (the `blang` repro from
  feat-450) returns `true` after the fix.
- Regression test(s) added at the source service covering the false-negative case.
- `pnpm --filter @forge/admin-graphql generate` (or the equivalent codegen for whichever surface changed)
  run and its artifacts committed if the field's resolution logic lives in this repo.
