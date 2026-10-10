---
title: "Migrating Next.js App Router route shapes: avoiding silent contract drift across URL builders, tests, and middleware"
date: 2026-04-30
last_refreshed: 2026-05-28
category: docs/solutions/best-practices/
module: apps/web
problem_type: best_practice
component: frontend_stimulus
severity: high
applies_when:
  - "Changing a Next.js App Router route shape (segment count, segment order, or segment semantics)"
  - "Modifying any cross-cutting contract encoded as URL templates at multiple call sites — router.push, share/canonical URLs, embed iframe snippets, deep links, OG tags"
  - "Widening a prop type to nullable and threading an empty-string fallback through URL or route construction"
  - "Deleting a route whose siblings (proxy CSP rules, sitemaps, redirects, share/embed surfaces) still reference it"
  - "Refactoring discriminated-union narrowing in a SectionRenderer-style dispatcher whose downstream consumers depend on a specific kind being threaded"
symptoms:
  - "Share/embed URLs 404 in production while colocated unit tests pass green"
  - "Tests pin the pre-migration contract shape and silently mask drift across the refactor"
  - "router.push lands on a non-existent route after a route refit"
  - "Empty-string fallback for a missing slug produces double-slash (`/watch//foo/en`) or protocol-relative (`//foo/en`) URLs"
  - "Video-template Experiences silently lose their video record after a route handler refactor"
  - "URL [locale] segment ignored despite being part of the unstable_cache key (cache bloat without locale-aware data)"
tags:
  - nextjs-app-router
  - route-migration
  - url-builders
  - cross-cutting-refactor
  - test-pinning
  - watch-page
  - share-embed
  - locale-routing
  - code-review
related_components:
  - testing_framework
  - tooling
---

# Migrating Next.js App Router route shapes: avoiding silent contract drift across URL builders, tests, and middleware

## Context

A route-shape refactor on `feat/watch-page-mux-parity` migrated the dedicated watch page from `/watch/[collection]/[video]/[locale]` (3-segment) to the project's existing convention `/watch/[video]/[locale]` (2-segment). The route handler updated cleanly, `tsc --noEmit` was clean, the watch test suite was green, and the page rendered correctly when loaded directly. But a multi-agent code review (`/ce-code-review`) surfaced a coherent cluster of silently-stale defects across the surfaces that _quoted_ the route shape — modal URL builders, embed iframe snippets, the proxy CSP/locale-redirect logic, and a `routeVideo` extraction in the Experience fallback path. None of these were caught by colocated tests, type-checking, or the U-by-U execution model that built the feature unit by unit.

The deepest defects (per the review's auto-resolve, run artifact `/tmp/compound-engineering/ce-code-review/20260430-105923-06170264/`):

- `ShareModal` emitted `${origin}/watch/${parentSlug}/${videoSlug}/${currentLanguageSlug}` and a matching `+ "/embed"` iframe snippet — every share link 404'd, every embed pasted into a partner site 404'd. Tests pinned the dead shape and passed.
- `LanguagePickerModal.router.push(\`/${parentSlug}/${videoSlug}/${slug}?t=${t}\`)` — selecting a language navigated to a 404. Tests pinned the dead shape.
- `WatchPageClient` widened `canonicalParent` to `WatchParent | null` and threaded `parentSlug=""` to both modals when null, producing `${origin}/watch//${videoSlug}/${lang}` (double-slash) and `//${videoSlug}/${slug}` (protocol-relative — browsers treat as cross-origin to `https://videoSlug`).
- `page.tsx` hardcoded `routeVideo={null}` instead of extracting `routeVideo = page.kind === "video-template" ? page.routeVideo : null`. Every Experience using a video-template (`<MediaCollection>`, `<VideoHero>`, `<Video>`, `<Container>`) silently lost its video record on the fallback path.
- `resolveWatchVideoBySlug(slug, locale)` had `void locale // currently informational`. URL `[locale]` was in the `unstable_cache` key (cache bloat) but not in variant selection — `/watch/considering-christmas/spanish` always rendered English.
- The dedicated embed route was deleted with no replacement; the proxy still carried a dead `embed` CSP branch; `ShareModal` still emitted iframe snippets to the dead URL.
- `proxy.ts` `detectWatchRoute` returned `"watch"` for _any_ 2-segment path post-basePath-strip — applied watch-CSP and skipped locale-redirect for non-locale paths like `/easter/some-non-locale-tag`.

The 3-segment shape itself was inherited from the live `jesusfilm.org` URL (`/watch/christmas.html/considering-christmas/english.html`) — never a Forge route, but a developer mental model carried into modal link-building logic. (session history) The brainstorm at `docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md` had locked the 2-segment decision before any file was touched, but the modal builders drifted toward the live-site reference shape during implementation.

## Guidance

When changing the shape of a Next.js App Router route, treat it as a **cross-cutting contract migration**, not a single-file refactor. The route handler is the only place the shape is _named_; every URL builder elsewhere just concatenates strings, so the type system has no opinion on whether `/watch/${a}/${b}/${c}` matches the route or not. Drift propagates as convention, not as type — and conventions silently rot.

The single highest-leverage prevention: **centralize URL builders in one module** so the route shape lives in one file. Replace ad-hoc templates with a builder:

```ts
// apps/web/src/lib/routes.ts
export const routes = {
  watch: {
    video: (videoSlug: string, locale: string) =>
      `/${videoSlug}/${locale}` as Route, // basePath '/watch' is auto-prepended
    canonical: (videoSlug: string, locale: string) =>
      `${env.NEXT_PUBLIC_CANONICAL_ORIGIN}/watch/${videoSlug}/${locale}`,
  },
}
```

Refactoring the route shape becomes a one-line change in `routes.ts`; type-safety propagates because the builder's signature changes and every call site fails to compile until updated. Until you have this, every `\`/${...}/${...}\`` in the codebase is a silent-staleness candidate.

Until centralization lands, before promoting a route-shape change, **grep the repo** for URL templates that quote the old shape:

```bash
rg -n '`/watch/' apps/web/src
rg -n 'router\.push\(`/' apps/web/src
rg -n '\$\{origin\}/watch/' apps/web/src
rg -n 'href=`/' apps/web/src
```

Run these in the route-shape PR description as a checklist artifact. The grep is the safety net the type system can't provide.

**Add at least one integration test per major user flow that crosses the seam.** Share, language switch, and embed each need a test that hits the actual route handler — not just the component. A Playwright test that clicks Share, copies the URL, then `fetch`es it and asserts 200 would have caught all three of the modal/canonical-URL/embed defects in one assertion. Colocated unit tests can't catch route-shape drift because they're written from the same mental model as the source: refactoring the source updates the test in lockstep — they're in the same commit, same file pair. The unit-test boundary is, by construction, the wrong boundary to detect that the unit's _contract with another unit_ has changed.

**Use `/ce-code-review` before promoting URL-shape refactors.** Type-checking and unit tests are blind to URL-template drift. Multi-agent review holds the whole-PR diff in one context and catches cross-cutting invariants — exactly the failure class above. This single PR turned up sixteen auto-resolvable fixes that all passed local CI.

**When deleting a route, treat it as a multi-surface checklist, not a file delete.** Standard checklist:

- [ ] Route handler files deleted
- [ ] Proxy/middleware CSP branch for that route removed (`apps/web/src/proxy.ts`)
- [ ] Every component emitting URLs to that route updated (search, embed, share, etc.)
- [ ] Tests for the deleted route deleted; tests for builders that emitted to it updated
- [ ] Any iframe / external-snippet emission removed (these leak broken URLs onto **other people's sites**)
- [ ] Orphan files (components only used by the deleted route) deleted
- [ ] Webhook revalidation paths updated (Strapi `revalidatePath()` calls now reference the new shape)

**Drop the prop, don't patch the fallback.** When a route shape changes such that one segment becomes optional or removable (here: `parentSlug` no longer exists in the URL), don't widen the prop to nullable and add an empty-string fallback. Drop the prop entirely from downstream consumers. `parentSlug=""` producing `${origin}/watch//${videoSlug}/${lang}` is a class of bug that becomes structurally impossible if the prop never existed.

**Default to "more specific" not "more permissive" in middleware route detectors.** When tightening a route-segment match, re-derive the predicate from the route handler's preconditions — don't inherit the previous matcher. `detectWatchRoute` returning `"watch"` for any 2-seg path was a stale assumption from when 3-seg was the only watch shape. After the refactor, the matcher should agree with the page handler's locale shape — so the proxy and the route handler agree on what a watch URL looks like.

The exact predicate is **necessary but not sufficient** when the route accepts more than one locale shape. The watch route accepts both bcp47 codes (`en`, `fr-CA`) and slug-form language identifiers (`english`, `spanish-castilian`), so `isLocale(last)` alone (bcp47-only) is too narrow. The current matcher unions both forms: `return isLocale(last) || PREFERRED_LANG_SLUG.test(last)`. See the updated code example below, and the worked recurrence in `docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md` — the same `isLocale`-as-language-validator mistake silently substituted `DEFAULT_LOCALE` on every non-bcp47 series URL because the downstream client component received the bcp47-normalised `locale` instead of the raw URL segment.

## Why This Matters

Three compounding root causes make route-shape drift a uniquely insidious failure class:

1. **URL templates are strings, and the type system has no opinion.** The route handler at `app/[slug]/[locale]/page.tsx` is the only place the route shape is named. Every call site that builds a URL to that route just concatenates strings. There is no compiler-enforced link between the file-system shape and a `\`/watch/${...}\`` string anywhere else in the repo. Refactoring the file system propagates as a _convention_, not as a _type_.

2. **Colocated unit tests can't catch route-shape drift because they're written from the same mental model as the source.** When the engineer who wrote `ShareModal.tsx` writes `ShareModal.test.tsx`, both files encode "the route is 3 segments" as a shared assumption. They're in the same commit, same head-state — the test is the regression's twin, not its check. You need a test that crosses the seam: an integration test that sends the share URL through the actual route handler.

3. **The U-by-U review model treats each surface as independent, but route shape is a cross-cutting invariant.** Reviewing `ShareModal`, `LanguagePickerModal`, `WatchPageClient`, `page.tsx`, `content.ts`, embed-route deletion, and `proxy.ts` as separate units — each was internally consistent. The 3-seg → 2-seg invariant is a property of the _union_, not of any single member. No unit-level review can see it. This is the seam where multi-agent code review (which holds the whole-PR diff in one context) outperforms unit-level review.

A general way to state this: **route-shape changes are fan-out refactors masquerading as fan-in refactors.** The route handler looks like a single file change; it is actually a multi-surface change to every URL builder that _quotes_ that route. Until the route shape lives in one place, every fan-out point is a silent-staleness candidate. The blast radius extends past the app: dead embed snippets pasted into partner sites silently host broken iframes long after the refactor ships.

This learning extends — and is concretely demonstrated by — the methodological precedent in `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md` (sibling call sites of the same pattern silently rot when round-1 fix lands at one site) and `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` (invariants survive syntactically but lose semantic content after refactor — `parentSlug=""` is technically valid but semantically dead-after-reshape; `void locale` is an assertion intact with semantic protection gone).

## When to Apply

- Whenever an App Router route's segment count, order, or semantics change
- Whenever a route is deleted and any sibling surface (proxy CSP, sitemaps, redirects, share/embed snippets) might still reference it
- When a prop on a deeply-threaded component widens to nullable and any downstream consumer concatenates it into a URL
- When a discriminated-union narrowing is refactored in a SectionRenderer-style dispatcher and downstream consumers depend on a particular `kind` being threaded with its associated payload (e.g., the `routeVideo` regression on the video-template fallback)
- When a resolver's argument list grows to include `locale` (or any URL-derived parameter) — verify it actually drives selection, not just the cache key
- Before every PR that includes both a route-handler file rename/delete _and_ a same-PR commit titled like "U-N: refit modals" — that combination is the canonical fan-out refactor and warrants a `/ce-code-review` pass before merge
- **When a URL canonicalizer / normalizer is guarded by an idempotence property test** (`f(f(x)) === f(x)`) — that property holds VACUOUSLY for malformed inputs that no rule's precondition matches (they're their own fixed point). Add an output-shape contract property test that inspects both `kind: "redirect"` AND `kind: "canonical"` outputs against each downstream invariant. See [idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md](idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md) for the worked instance (forge#1049 Rule 4 episode-bare contract miss caught during `/ce:review`).

## Examples

### Modal URL builders — drop the obsolete segment, drop the prop entirely

```tsx
// Before — ShareModal.tsx
export type ShareModalProps = {
  parentSlug: string
  videoSlug: string
  currentLanguageSlug: string
  // ...
}
const canonicalUrl = `${origin}/watch/${parentSlug}/${videoSlug}/${currentLanguageSlug}`
const embedSnippet = `<iframe src="${origin}/watch/${parentSlug}/${videoSlug}/${currentLanguageSlug}/embed" .../>`
```

```tsx
// After — drop parentSlug from props, drop embed section entirely
//   (route was deleted; shipping a 404'ing snippet would leak broken
//   iframes onto partner sites)
export type ShareModalProps = {
  videoSlug: string
  currentLanguageSlug: string
  // ...
}
const canonicalUrl = `${origin}/watch/${videoSlug}/${currentLanguageSlug}`
```

```tsx
// Before — LanguagePickerModal.tsx
const href = `/${parentSlug}/${videoSlug}/${slug}?t=${t}` as Route
router.push(href)
```

```tsx
// After
// 2-segment route: /[video]/[locale]. basePath '/watch' is auto-prepended.
const href = `/${videoSlug}/${slug}?t=${t}` as Route
router.push(href)
```

`WatchPageClient` no longer accepts or threads `canonicalParent` to either modal. The merge layer in `page.tsx` (server-side) still uses it to build the SiblingCarousel block. Removing the prop from the client makes the `parentSlug=""` defects structurally impossible, not just patched.

### Restore the discriminated-union narrowing — and drop the cast that hid it

```tsx
// Before — page.tsx
const blocks = (experienceLike.blocks ?? []).filter(
  (b): b is Section =>
    b !== null && (b as { __typename?: string }).__typename !== "Error",
)
return blocks.map((block) => (
  <SectionRenderer section={block} routeVideo={null} />
))
```

```tsx
// After — extract routeVideo from the kind discriminator; drop the cast
const routeVideo = page.kind === "video-template" ? page.routeVideo : null
const blocks = (experienceLike.blocks ?? []).filter(
  (b): b is Section => b !== null && b.__typename !== "Error",
)
return blocks.map((block) => (
  <SectionRenderer section={block} routeVideo={routeVideo} />
))
```

The cast `(b as { __typename?: string }).__typename` silently downgraded the literal-union discriminator to `string | undefined`, so a misspelled tag (`"Errror"`) would have compiled. The source type already carries the discriminator; the cast was structurally unnecessary AND weakened the check.

### Wire URL params through to selection, not just the cache key

```ts
// Before — content.ts
const fetchResolvedWatchVideoBySlug = unstable_cache(
  async (videoSlug: string, locale: string) => {
    // ...pick variant...
    void locale // currently informational; locale already drives Strapi i18n
    return resolved
  },
  ["watch-video-by-slug"],
  { revalidate: 60 },
)
```

```ts
// After — explicit 4-tier priority that actually consumes the locale arg
//   1. URL [locale] match by language.slug   (e.g. "spanish")
//   2. URL [locale] match by language.bcp47  (e.g. "en", "fr")
//   3. Video's primary language
//   4. First playable variant (last-resort fallback)
const localeMatch =
  playableVariants.find((v) => v.language?.slug === locale) ??
  playableVariants.find((v) => v.language?.bcp47 === locale)
const primaryMatch = primaryLanguageId
  ? playableVariants.find((v) => v.language?.coreId === primaryLanguageId)
  : null
const selectedVariant =
  localeMatch ?? primaryMatch ?? playableVariants[0] ?? null
```

If the resolver receives an arg, that arg should drive selection — _or_ the arg should be removed. `void locale` with the arg still in the cache key bloats the cache with redundant slots holding identical data.

### Tighten middleware route detectors — agree with the route handler's preconditions

```ts
// Before — proxy.ts
function detectWatchRoute(pathname: string): WatchRouteKind | null {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 2) return "watch"
  if (segments.length === 3 && segments[2] === "embed") return "embed"
  return null
}
```

```ts
// After — match what page.tsx actually accepts. The watch route admits
//   BOTH bcp47 codes ("en", "fr-CA") AND slug-form language identifiers
//   ("english", "spanish-castilian") because the language picker writes
//   slug-form URLs. `isLocale` is bcp47-only by design, so the union
//   with PREFERRED_LANG_SLUG is required — using `isLocale` alone here
//   was a regression in an earlier revision of this fix. Embed branch
//   removed alongside the deleted route.
const PREFERRED_LANG_SLUG = /^[a-z0-9-]+$/
function isWatchRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length !== 2) return false
  const last = segments[1]
  if (last == null) return false
  return isLocale(last) || PREFERRED_LANG_SLUG.test(last)
}
```

A general rule that survives the bcp47-vs-slug-form distinction: when a
helper named like a generic "is this a valid X" check is actually scoped
to one specific form (`isLocale` accepts only bcp47), rename it to
disambiguate (`isBcp47Locale`) or wrap it in a broader matcher at every
call site. Don't lean on the narrower helper as if it answered the
broader question.

### Tag "single-line revert" hides with a positive assertion

When you hide a feature via `return null` in a dispatch case (rather than ripping it out), add a test that asserts the feature is _still produced_ by the layer below — so the single-line revert promise is structurally protected against future drift.

```tsx
// WatchSectionRenderer.test.tsx
expect(rendered).not.toContain("SiblingCarousel")
// The block IS still emitted by `mergeWatchExperience` even though the
// renderer skips dispatch — protect that contract so a future change to
// the merge layer doesn't silently drop it.
expect(blocks.some((b) => "kind" in b && b.kind === "SiblingCarousel")).toBe(
  true,
)
```

### Strict-form `aria-hidden` checks in a11y tests

```tsx
// Before — permits "", "true", "false", "junk"
expect(svg.getAttribute("aria-hidden")).not.toBeNull()
```

```tsx
// After — assert the literal "true"; ban rotate/transition classes
//   that imply expand-on-click affordance
expect(svg.getAttribute("aria-hidden")).toBe("true")
const cls = svg.getAttribute("class") ?? ""
expect(cls).not.toMatch(/\brotate-/)
expect(cls).not.toMatch(/\btransition\b/)
```

## Related

- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md` — the architectural precedent this learning's defects mutated. Defines the original `resolveWatchPage` flow, `routeVideo` injection, and the rule "Keep all watch route precedence in one server-side resolver shared by page rendering and metadata" that the route-shape change literally violated.
- `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md` — the methodological precedent. The cluster documented here is a fresh worked example of "round-1 fix lands at one site, sibling call sites of the same pattern silently rot." The grep-for-pattern checklist in that doc is exactly what would have caught all the modal/test/embed/proxy stragglers in one pass.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` — `parentSlug=""` is technically valid but semantically dead-after-reshape; `void locale` is an assertion intact with semantic protection gone. Same family.
- `docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md` — worked recurrence of the `isLocale`-as-language-validator mistake on a different page-route consumer (the series page received `locale={locale}` instead of `locale={rawLocale}`, so slug-form locales silently fell back to `DEFAULT_LOCALE` and the UI displayed "English" despite the URL). Same root cause as the proxy-side example above; demonstrates that the bcp47-vs-slug-form gap can recur on any new client component added under `[slug]/[locale]/page.tsx` if the pattern isn't carried forward.
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md` — adjacent middleware/proxy concern. The `headers()` grep recipe in that doc is worth running before any route-shape change ships, since `revalidate = 60` is silently nullified by a stray `headers()` import.
- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — webhook revalidation paths must be updated to the new shape; verify Strapi `revalidatePath()` callers reference the new 2-segment URL.
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — cross-app analog of silent contract drift.
- Run artifact: `/tmp/compound-engineering/ce-code-review/20260430-105923-06170264/` — full per-reviewer JSON for the multi-agent review that surfaced this cluster.

A second learning is buried in this work and warrants a separate `design_pattern` doc: **top-zone vs. body-zone split as a watch-page composition pattern.** The fixes around `TOP_ZONE_KINDS: Set<WatchBlock["kind"]>`, `mergeWatchExperience`'s block array, and the body-zone wrapper duplication from `Section.tsx:140-176` (deferred — flagged for extraction) all describe the same emerging pattern: watch pages compose from a top zone (player + sibling strip) and a body zone (sectioned content with shared default styling). Recommend `/ce-compound-refresh design-patterns` after the body-zone wrapper is extracted, to capture that pattern alongside the broader `apps/web` design-pattern corpus.
