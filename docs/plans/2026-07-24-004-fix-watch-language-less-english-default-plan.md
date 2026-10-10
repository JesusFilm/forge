---
title: "fix: Default language-less Watch Videos to English"
type: fix
status: completed
date: 2026-07-24
---

# fix: Default language-less Watch Videos to English

## Summary

Restore the historical English-default behavior for language-less Watch Video
links by rendering the manifest-admitted English Video without changing the
visible URL. Preserve one-segment collections, language homes, and fixed 404s.

## Problem Frame

Forge originally resolved `/watch/{slug}` with `DEFAULT_LOCALE`, so bare Video
links rendered English. The May 2026 `.html` URL migration changed
`/watch/{slug}.html` for single Videos into an intentional 404 to match the
production URL inventory captured at that time.

Durable inbound links still use `/watch/jesus.html`. The current production
response is a cached 404 even though `/watch/jesus.html/english.html` is a
healthy page. The intended compatibility contract is that an omitted language
means English and the browser remains on the language-less URL.

## Requirements

- R1. A language-less slug whose English standalone Video route is admitted by
  the current route manifest returns HTTP 200 without a `Location` header.
- R2. The browser URL and its query string remain language-less.
- R3. Manifest-admitted one-segment collections keep their current internal
  default-locale rewrite.
- R4. Public one-segment language homes keep their current localized-home
  rewrite.
- R5. Unknown slugs and Videos without an admitted English Dub keep the fixed
  Watch 404.
- R6. A missing route manifest does not guess that a safe-looking slug is a
  Video and retains the current non-collection 404 fallback.
- R7. Existing localized Video, episode, canonicalization, and internal-prefix
  behavior remains unchanged.
- R8. The proxy maps an admitted language-less Video onto the existing
  two-segment English internal route so page rendering needs no new branch.

## Key Technical Decisions

- KTD1. **Omitted language is English.** Keep the public language-less URL and
  render the same English Video model used by the explicit English route.
- KTD2. **Exact Video language admission resolves slug collisions.** When a
  slug is both a one-segment Experience and a Video, an exact content/audio
  index selects the English Video. Without an exact Video index, preserve the
  authored one-segment Experience route, including older manifests.
- KTD3. **Validate English availability with the current manifest.** Reuse
  standalone Video admission so exact content/audio indexes reject a slug
  without an English Dub.
- KTD4. **Keep defaulting at the proxy boundary.** The proxy proves that the
  English route exists and rewrites internally to
  `/{slug}.html/english.html`, so the catch-all reuses its normal Video path
  while the public address stays language-less.
- KTD5. **Fail closed without a manifest.** An unavailable manifest cannot
  distinguish a Video from a random slug without adding resolver work to the
  request boundary.

## Implementation Units

### U1. Track and characterize the English-default contract

- **Goal:** Record the compatibility change and add failing proxy and page
  tests for the default-English boundary.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/platform/feat-315-watch-language-less-english-default.md`
  - `docs/roadmap/README.md`
  - `apps/web/src/proxy.test.ts`
- **Approach:** Replace the existing `/jesus.html` fixed-404 expectation with
  a default-English internal rewrite. Add visible-URL preservation and exact
  content/audio rejection coverage while retaining collection and language
  home assertions.
- **Execution note:** Start with the proxy response contract before changing
  admission behavior.
- **Test scenarios:**
  1. `/jesus.html` returns 200 with no `Location` header.
  2. `/jesus.html?utm_source=legacy` remains the visible browser URL.
  3. `/easter.html` remains a one-segment collection rewrite.
  4. `/spanish-castilian.html` remains a language-home rewrite.
  5. An unknown slug and a known Video without exact English admission keep
     the fixed 404.
  6. A missing manifest keeps the existing non-collection 404 fallback.
- **Verification:** Focused proxy tests distinguish every admission outcome.

### U2. Add manifest-validated one-segment English rendering

- **Goal:** Render only an independently admitted English Video target.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/proxy.ts`
  - `apps/web/src/proxy.test.ts`
- **Approach:** Validate the safe slug as a standalone Video with the public
  audio slug mapped from `DEFAULT_LOCALE`. An exact content/audio entry wins a
  collision with a one-segment Experience; otherwise preserve the Experience
  route before using the compatibility fallback. Admit the Video request with
  an internal-path override to the existing two-segment English shape.
- **Patterns to follow:** `classifyManifestAdmission`;
  `publicWatchAudioLanguageSlugForLocale` for the public English slug; the
  existing `watchVideoPath` and `renderVideo` path for data, structured data,
  and UI.
- **Test scenarios:**
  1. Exact content/audio admission produces a default-English rewrite.
  2. Exact content/audio rejection produces the fixed 404.
  3. Exact English Video admission wins an Experience slug collision while
     collection-only slugs remain one-segment routes.
  4. The internal rewrite targets the normal English Video route.
  5. Existing two- and three-segment proxy tests remain unchanged.
- **Verification:** Focused tests, typecheck, lint, HTTP proof, and browser
  navigation all agree that English renders without changing the public URL.

## Sources and Research

- `apps/web/src/app/[slug]/page.tsx` at commit `b028482a` shows the historical
  bare Video route using `DEFAULT_LOCALE` and the single-Video template.
- Commits `2c23056a` and `65c57ac5` document the later one-segment Video 404
  contract introduced during the `.html` URL migration.
- `docs/research/jesusfilm-watch-url-patterns.md` and
  `docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md`
  record the May production inventory that motivated that 404.
- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md`
  defines the manifest admission boundary reused by this change.

## 2026-07-25 Supersession Note

This completed plan restored language-less English rendering without changing
the visible URL. The follow-up canonical contract now also treats eligible
`/watch/{slug}.html` as the emitted English canonical across metadata, sharing,
and sitemap discovery. Explicit `/english.html` remains a direct compatibility
and internal-renderer route; non-English, contextual browser routes, and
public-language-home collisions remain explicit.
