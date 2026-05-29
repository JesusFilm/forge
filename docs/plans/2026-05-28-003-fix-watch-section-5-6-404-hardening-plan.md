---
title: Harden /watch resolution to 404 the §5.6 must-404 URL shapes
type: fix
status: completed
date: 2026-05-28
origin: todos/030-pending-p1-watch-section-5.6-404-hardening.md
---

# 🐛 Harden /watch resolution to 404 the §5.6 must-404 URL shapes

## Overview

The Phase 6 cutover probe (`pnpm --filter @forge/web probe:watch-urls`,
www.jesusfilm.org vs watch.jesusfilm.org) surfaced **7 genuine hard
regressions**: forge renders a fallback **HTTP 200** for URL shapes the
production contract (`docs/research/jesusfilm-watch-url-patterns.md` §5.6,
§3) requires to be a hard **404**. These are soft-404s — they cause
duplicate-content dilution, crawl-budget waste, and let junk URLs index.
This is the last blocker before the /watch cutover gate goes green.

This plan hardens content resolution to `notFound()` those shapes **without
over-404ing** legitimate pages — the central risk, because the same code
paths serve real collections (`easter.html`), localized homes
(`english.html`), and ~2300 slug-form dubs (`spanish-castilian`).

## Problem Statement

### The 7 shapes (all: prod 404 → forge 200, confirmed by curl)

| URL                                    | Must 404 because (§ ref)                           | Guard |
| -------------------------------------- | -------------------------------------------------- | ----- |
| `/watch/jesus.html/en.html`            | bcp47 locale; only English-name slugs valid (§5.6) | A     |
| `/watch/jesus.html/pt-br.html`         | bcp47 locale (§5.6)                                | A     |
| `/watch/jesus.html/français.html`      | non-ASCII locale (§3)                              | A     |
| `/watch/easter.html/non-existent.html` | bad locale on existing collection (§5.6)           | A     |
| `/watch/JESUS.html/english.html`       | uppercase slug — case-sensitive (§3)               | B     |
| `/watch/.html`                         | empty slug (§3)                                    | B     |
| `/watch/jesus.html` (+ trailing `/`)   | single-video, missing locale (§5.6)                | C     |

### Root cause (grounded in code)

Two mechanisms in `apps/web/src/app/[slug]/[...rest]/page.tsx` +
`apps/web/src/app/[slug]/page.tsx`:

1. **Locale is never validated as an audio-language identifier.**
   `classify()` (`[...rest]/page.tsx:76-105`) keeps `rawLocale` verbatim and
   derives only the _UI chrome_ locale via `resolveUiLocale(rawLocale) ??
DEFAULT_LOCALE`. Resolution then:
   - tries the experience-template path **locale-agnostically** (a collection
     like `easter` renders for ANY locale segment), then
   - `resolveWatchVideoBySlug(slug, rawLocale)` which matches `rawLocale`
     against `variant.language.slug` **OR `variant.language.bcp47`**
     (`:331`, comment `:327-330`) — so `en` matches the english variant's
     bcp47 and resolves, then
   - falls through to `resolveWatchPage(locale, slug)` (`:403`) which resolves
     the **slug regardless of locale**, so `jesus` renders even with a junk
     locale segment.

2. **Missing content renders `<ExperienceEmpty />` at HTTP 200, not
   `notFound()`.** Both routes return `<ExperienceEmpty />` on
   `isWatchPageMissingError` and on `!blocks.length`
   (`[slug]/page.tsx:47-48,60-61`; `[...rest]/page.tsx:405-406,418`). This is
   intentional for _published-but-empty_ experiences (editor in progress) —
   which is exactly why we cannot blindly swap it for `notFound()`.

### Why the probe gates on this

The cutover gate is **0 hard regressions**. Today: 7 hard. The probe
(`apps/web/src/lib/watch-url-probe.ts`, `scripts/probe-watch-urls.ts`) is the
acceptance harness — re-run after each guard.

## Proposed Solution

Three guards, **ordered by risk**, landing as three reviewable commits (or
PRs). A and B are pure URL-shape validation in `classify()` (which already
maps `kind: "unknown"` → `notFound()` at `[...rest]/page.tsx:191`); C is a
content-type-aware change to the 1-segment route.

### Guard A — locale-segment validation (fixes 4/7, low–medium risk)

In `classify()`, reject a `rawLocale` that is not a **known audio-language
slug** → return `{ kind: "unknown" }` → `notFound()`. This runs **before** any
of the three locale-agnostic resolution fallbacks, so it uniformly covers
videos, collections, and (mirror in `renderEpisode`) episodes.

**The predicate must use the COMPLETE `Language.slug` set — not
`LANGUAGE_BCP47_MAP` keys.** `LANGUAGE_BCP47_MAP`
(`src/lib/language-bcp47-map.ts`) deliberately skips **39 admin languages
missing bcp47** (per its header). Validating against its keys would wrongly
404 those 39 dubs. Decision (see Alternatives): generate a separate
`KNOWN_LANGUAGE_SLUGS: ReadonlySet<string>` from admin `Language.slug` (~2302
rows, including the 39), with a drift test mirroring
`language-bcp47-map.test.ts`.

```ts
// src/lib/locale.ts (new)
import { KNOWN_LANGUAGE_SLUGS } from "./known-language-slugs" // codegen'd
/** True iff `slug` is a real admin audio-language slug (English-name, e.g.
 *  `english`, `spanish-castilian`). Rejects bcp47 codes (`en`, `pt-br`),
 *  non-ASCII, and unknown tokens. This is the §5.6 locale-segment gate. */
export function isKnownLanguageSlug(slug: string): boolean {
  return KNOWN_LANGUAGE_SLUGS.has(slug)
}
```

```ts
// [...rest]/page.tsx classify() — both rest.length === 1 and === 2 branches
const rawLocale = stripHtmlSuffix(rest[at])
if (!isKnownLanguageSlug(rawLocale)) return { kind: "unknown" } // → notFound()
```

- `english`, `spanish-castilian` → in set → resolve ✓
- `en`, `pt-br`, `français`, `non-existent` → not in set → 404 ✓

### Guard B — slug charset/case validation (fixes 2/7, low risk)

In `classify()` (and the 1-seg `[slug]/page.tsx`), reject a slug that is empty
or fails `SAFE_SLUG_PATTERN` (lowercase ASCII kebab, `src/lib/url-shape.ts`).
`SAFE_SLUG_PATTERN` already exists and is the canonical slug shape.

```ts
import { SAFE_SLUG_PATTERN } from "@/lib/url-shape"
const slug = stripHtmlSuffix(rawSlug)
if (!slug || !SAFE_SLUG_PATTERN.test(slug)) return { kind: "unknown" } // → notFound()
```

- `JESUS` (uppercase) → fails pattern → 404 ✓
- ``(empty, from`/watch/.html`) → falsy → 404 ✓
- `jesus`, `lumo-the-gospel-of-john` → pass → resolve ✓

For the 1-seg route, the empty/uppercase slug must `notFound()` too — but note
`isLocale(slug)` is checked first there (localized-home), so apply the guard
to the content-slug branch only.

### Guard C — 1-seg single-video → 404 (fixes 1/7, HIGHER risk)

`/watch/jesus.html` (1-seg) currently resolves `jesus` as content and renders 200. §5.6 requires single videos to 404 without a locale, while 1-seg
**collections** (`easter.html` → 200 per §1.4) and **localized homes**
(`english.html` → 200) must keep working. This requires distinguishing the
resolved content **type**.

Approach: in `[slug]/page.tsx`, after resolving, if the page resolves to a
**single playable video** (`kind: "video-template"` with a `routeVideo`) —
i.e. a thing that _needs_ a locale — call `notFound()` instead of rendering.
Collections/experiences (`kind: "experience"`) and localized-homes (the
`isLocale(slug)` branch) are unaffected.

```ts
// [slug]/page.tsx, after `const page = result.data`
if (page?.kind === "video-template") notFound() // single video needs a locale
```

**Open question for implementation:** confirm `resolveWatchPage(DEFAULT_LOCALE,
"easter")` returns `kind: "experience"` (not `video-template`) and
`"women-resources"` returns a missing-error → must verify against real data
before shipping C (see Acceptance Criteria). If a collection ever resolves as
`video-template`, this guard would over-404 it.

Also fold in: when `isWatchPageMissingError` fires for a 1-seg **content**
slug (not a localized-home, not a known collection), prefer `notFound()` over
`<ExperienceEmpty />` — but ONLY when we can distinguish "slug doesn't exist"
from "experience exists but unpublished/empty". If that distinction isn't
cleanly available from the resolver, keep `<ExperienceEmpty />` and accept that
`women-resources.html`-style 404s require the missing-error path. Decide
during implementation with the resolver's actual error shapes in hand.

## Technical Approach

### Files to modify / add

- `apps/web/src/lib/known-language-slugs.ts` (**NEW**, codegen'd) —
  `KNOWN_LANGUAGE_SLUGS` set from admin `Language.slug` (~2302). Generator
  script `scripts/generate-known-language-slugs.ts` (mirror the existing
  `generate:language-bcp47-map`). Add to ESLint `globalIgnores` (autogenerated,
  like `language-bcp47-map.ts`).
- `apps/web/src/lib/known-language-slugs.test.ts` (**NEW**) — drift test +
  asserts `english`/`spanish-castilian` ∈ set, `en`/`pt-br`/`français` ∉ set.
- `apps/web/src/lib/locale.ts` — add `isKnownLanguageSlug`.
- `apps/web/src/app/[slug]/[...rest]/page.tsx` — guards A + B in `classify()`
  (both 1- and 2-rest branches); episode branch gets guard A on its locale.
- `apps/web/src/app/[slug]/page.tsx` — guard B (content-slug branch) + guard C.
- `apps/web/src/app/[slug]/[...rest]/__tests__/page-routing.test.tsx` — extend
  `classify` tests for the new 404 cases + the must-200 regression set.
- `apps/web/src/lib/watch-url-probe.ts` — (optional) add the must-200 guards
  (`/watch/easter.html` 1-seg as `ok`, `/watch/women-resources.html` as
  `notfound`) so the probe pins the over-404 boundary, not just the §5.6 set.

### Implementation Phases

#### Phase 1 — Guards A + B (the safe 6/7)

- Codegen `KNOWN_LANGUAGE_SLUGS` + drift test.
- `isKnownLanguageSlug` in locale.ts.
- Tighten `classify()` (locale + slug validation) and the 1-seg content-slug
  guard B.
- Unit tests: every §5.6 A/B shape → `unknown`/404; `english`,
  `spanish-castilian`, `jesus`, `lumo-...` → still resolve.
- Re-run probe → expect **1 hard** remaining (`/watch/jesus.html` 1-seg).

#### Phase 2 — Guard C (the 1-seg single-video case)

- Add the `video-template` → `notFound()` guard, gated behind verified
  resolver behavior for `easter` (experience) vs `jesus` (video-template).
- Add fixtures: `easter.html` 1-seg → 200, `jesus.html` 1-seg → 404.
- Re-run probe → expect **0 hard**, and confirm `match`/`acceptable` counts on
  the existing 96 do NOT drop (no new false-404s).

#### Phase 3 — Gate + sign-off

- Final `probe:watch-urls` run: 0 hard, ≤2% soft.
- Stakeholder reviews the `acceptable` set (preview-superset URLs).

## Alternative Approaches Considered

1. **Validate locale against `LANGUAGE_BCP47_MAP` keys (rejected).** Simpler
   (no new artifact) but over-404s the 39 bcp47-less admin languages. The
   complete `Language.slug` set is the correct authority.
2. **Post-resolution "matched-by-slug-not-bcp47" check (rejected as primary).**
   Robust for the video path (reject when the resolved variant matched
   `rawLocale` on bcp47 only), but doesn't cover the locale-agnostic
   experience-template path (`easter/non-existent`), and couples 404 logic to
   resolution internals. Static pre-validation in `classify()` is uniform and
   simpler. (Could be added later as defense-in-depth.)
3. **404 in the proxy (rejected).** The proxy canonicalizes shapes but has no
   content/language knowledge (edge, no DB). 404 is correctly the page's job.

## System-Wide Impact

- **Interaction graph:** `classify()` is the single chokepoint for the
  catch-all; `kind: "unknown"` → `notFound()` already wired (`:191`). Guard C
  touches only the 1-seg route. No proxy/revalidate/builder changes.
- **Error propagation:** `notFound()` throws the Next NOT_FOUND digest →
  renders the nearest `not-found.tsx`. Confirm one exists under the watch
  segment (else the app-level default renders). Distinct from
  `<ExperienceError />` (transient GraphQL failure) — keep those separate.
- **State lifecycle:** none (read-only routing).
- **API-surface parity:** `parseWatchPath` in `lib/routes.ts` is the sibling
  classifier (used by canonicalize). It does NOT need the language-slug gate
  (it classifies shape, not validity) — but document that the _validity_ gate
  lives only in the page `classify()`, so the two don't silently diverge.
- **Integration scenarios (probe-backed):** §5.6 shapes → 404; `easter.html`
  1-seg → 200; `english.html` → 200; every §5.2 slug-form dub → 200;
  `women-resources.html` → 404.

## Acceptance Criteria

### Functional

- [ ] All 7 §5.6 shapes return 404 on forge.
- [ ] `easter.html` (1-seg collection) → 200; `english.html` (localized home)
      → 200; `spanish-castilian` + every §5.2 dub → 200.
- [ ] `women-resources.html` (1-seg, non-collection) → 404 (matches prod).
- [ ] Episode locale validation mirrors guard A (3-seg bad locale → 404).

### Quality gates

- [ ] `KNOWN_LANGUAGE_SLUGS` drift test green; ESLint-ignored as autogenerated.
- [ ] `classify` unit tests cover each new 404 + must-200 case.
- [ ] `pnpm --filter @forge/web test/lint/typecheck` green.
- [ ] **Probe: `probe:watch-urls --production https://www.jesusfilm.org
    --preview <forge>` → 0 hard regressions, soft ≤2%, and the 96 currently
      `match`/7 `acceptable` URLs do not regress into 404.**

## Risks & Mitigation

- **Over-404 (the dominant risk).** Guard C + any `ExperienceEmpty`→
  `notFound()` change can silently 404 real content. Mitigation: gate C behind
  verified resolver type for `easter`/`women-resources`; the probe's must-200
  fixtures are the regression net; ship A+B first (Phase 1) and re-probe before
  C.
- **`KNOWN_LANGUAGE_SLUGS` completeness.** If admin adds a language slug, the
  set must regenerate or that dub 404s. Mitigation: drift test + document the
  regenerate command; it's the same operational contract as
  `language-bcp47-map`.
- **`not-found.tsx` presence.** Verify the watch segment renders a sensible
  404 page, not a broken default.

## Sources & References

### Origin

- **Origin todo:** `todos/030-pending-p1-watch-section-5.6-404-hardening.md`
  — the 7-shape breakdown + 3-guard risk ordering carried forward here.

### Internal references

- `apps/web/src/app/[slug]/[...rest]/page.tsx:76-105` (`classify`), `:191`
  (`unknown → notFound`), `:331` (slug-OR-bcp47 match), `:403-418`
  (locale-agnostic fallback + `ExperienceEmpty` 200).
- `apps/web/src/app/[slug]/page.tsx:38-62` (1-seg resolve + `ExperienceEmpty`).
- `apps/web/src/lib/locale.ts:111` (`slugToBcp47Primary` uses
  `Object.hasOwn(LANGUAGE_BCP47_MAP, slug)`), `:155` (`resolveUiLocale`).
- `apps/web/src/lib/language-bcp47-map.ts` (header: 39 rows skipped — the
  over-404 trap).
- `apps/web/src/lib/url-shape.ts` (`SAFE_SLUG_PATTERN`).
- `apps/web/src/lib/watch-url-probe.ts` + `scripts/probe-watch-urls.ts` (the
  acceptance harness).

### Research

- `docs/research/jesusfilm-watch-url-patterns.md` §5.6 (expected 404s), §3
  (case sensitivity / non-ASCII), §1.4 (1-seg collections: `easter` 200,
  `women-resources` 404).
