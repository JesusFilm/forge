---
title: "Bound Watch Static Route Admission with the Admin Route Manifest"
date: "2026-05-29"
last_updated: "2026-07-25"
category: "performance-issues"
module: "apps/web watch routing"
problem_type: "performance_issue"
component: "frontend_stimulus"
symptoms:
  - "Safe-looking random watch URLs such as /anything.html/english.html could reach the force-static catch-all"
  - "Revalidation emitted catalog-key public paths such as /jesus.html/en.html instead of real audio slugs"
  - "The one-segment /watch/german.html language home resolved to English identity"
  - "One-segment language-home metadata canonicalized to /watch instead of the public language URL"
  - "Static/ISR behavior was implemented but not proven with build and runtime cache evidence"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "service_object"
  - "testing_framework"
  - "development_workflow"
tags:
  - "watch-route"
  - "route-manifest"
  - "nextjs-isr"
  - "locale-routing"
  - "revalidatepath"
  - "static-rendering"
  - "hostile-paths"
  - "audio-slugs"
---

# Bound Watch Static Route Admission with the Admin Route Manifest

## Problem

The watch static locale rewrite moved public URLs through static App Router routes, but several route identities were still conflated across proxy, revalidation, metadata, and locale helpers. That left syntactically safe but nonexistent paths able to reach static resolution, revalidation targeting URLs the public guard now rejects, and one-segment language homes losing their SEO/user-facing identity.

The performance risk was that hostile paths such as `/watch/anything.html/english.html` could drive admin/page resolution and potentially mint unbounded ISR or notFound cache entries. The correctness risk was that public audio slugs, UI catalog keys, and `<html lang>` values drifted into one another.

A later compatibility gap exposed a second admission requirement: durable
language-less Video URLs such as `/watch/jesus.html` needed to mean English
without redirecting or weakening the fixed-404 boundary for random one-segment
slugs.

## Symptoms

- `/anything.html/english.html` and unknown episode pairs were safe-looking enough to proceed past proxy classification toward the force-static catch-all.
- `/api/revalidate` produced paths like `/jesus.html/en.html` and `/en/en/jesus.html/en.html`, even though public audio slots accept slugs such as `english`, not catalog keys such as `en`.
- `/watch/german.html` was recognized as a home-only language URL, but `resolveWatchLocaleIdentity("german")` fell back to `{ locale: "en", htmlLang: "en" }`.
- One-segment language-home metadata called `getWatchPageMetadata(shape.locale)` without `pathLocale`, so `/german.html` and similar pages canonicalized back to the watch root.
- The route config set `dynamic = "force-static"`, but the branch still needed `next build` and runtime `x-nextjs-cache` proof.

## What Didn't Work

- Treating `[locale]` as a universal language identifier was the core mistake. The public route segment may be a raw audio slug (`english`, `spanish-castilian`, `german-standard`), the internal `[locale]` segment is a message catalog key (`en`, `es`, `de`), and the internal `[htmlLang]` segment can be a finer BCP-47 tag (`es-419`). Collapsing these into one value produced invalid public revalidation paths.
- Delegating every safe-looking path to the catch-all was too permissive. Syntax validation only proves a string is safe to parse; it does not prove the content/audio or parent/episode pair exists.
- Redirecting a language-less Video to `/english.html` changed the durable
  public URL instead of honoring the compatibility contract that an omitted
  language means English.
- Teaching the catch-all page to guess that any one-segment slug was a Video
  would have bypassed the proxy's manifest admission boundary and made
  collection/Video identity ambiguous.
- Generating or storing every possible watch URL was rejected in the prior admin manifest work because the content-language permutation space would grow too large. The durable decision was compact admission dimensions instead: content slugs, one-segment slugs, episode pairs, and audio language slugs. (session history)

## Solution

Wire the admin-owned watch route manifest into proxy admission before rewriting to the internal static route tree.

`apps/web/src/lib/watch-route-manifest.ts` models the compact shape and converts it into indexed sets:

```ts
export type WatchRouteManifest = {
  version: string
  generatedAt: string
  contentSlugs: string[]
  oneSegmentSlugs: string[]
  episodePairsByParent: Record<string, string[]>
  audioLanguageSlugs: string[]
  audioLanguageIndexesByContent?: Record<string, number[]>
  audioLanguageIndexesByEpisode?: Record<string, Record<string, number[]>>
}
```

The admission helper rejects unknown one-segment slugs, unknown content slugs,
unknown audio slugs, unknown episode pairs, and—when the exact indexes are
present—content/audio or episode/audio combinations that do not exist. Older
manifests without the optional exact indexes retain the global-audio fallback.

```ts
export function isWatchRouteAdmittedByManifest(
  manifest: WatchRouteManifest,
  route: WatchRouteManifestRoute,
): boolean {
  const index = getManifestIndex(manifest)
  if (route.kind === "one-segment") {
    return index.oneSegmentSlugs.has(route.slug)
  }
  if (route.kind === "video") {
    return (
      index.contentSlugs.has(route.contentSlug) &&
      isContentAudioLanguageAdmitted(
        index,
        route.contentSlug,
        route.audioLanguageSlug,
      )
    )
  }
  return (
    (index.episodePairsByParent.get(route.parentSlug)?.has(route.childSlug) ??
      false) &&
    isEpisodeAudioLanguageAdmitted(
      index,
      route.parentSlug,
      route.childSlug,
      route.audioLanguageSlug,
    )
  )
}
```

`apps/web/src/proxy.ts` carries the classified manifest route through rewrite decisions and calls the admission check before `rewriteToInternal()`:

```ts
const rewrite = classifyRewrite(pathname)
if (rewrite.kind === "pass") return NextResponse.next()
if (rewrite.kind === "not-found") return buildNotFound()
if (!(await isRewriteAdmittedByManifest(rewrite))) return buildNotFound()
return rewriteToInternal(request, rewrite)
```

For an omitted Video language, validate the same slug as a standalone Video in
the default public audio language. A slug may be present in both
`oneSegmentSlugs` and `contentSlugs`—production `jesus` exposed that collision.
When the manifest has an exact content/audio entry for the slug, the exact
English Video result wins. Without that exact entry, preserve one-segment
Experience admission first so collection-only slugs and older manifests do not
get misclassified as Videos. An admitted Video overrides only the internal
pathname; `NextResponse.rewrite` keeps the browser on the language-less URL and
preserves its query string.

```ts
if (decision.manifestRoute.kind === "one-segment") {
  const { slug } = decision.manifestRoute
  const videoAdmission = defaultLanguageVideoAdmission(manifest, slug)
  const hasExactVideoLanguages = Object.hasOwn(
    manifest.audioLanguageIndexesByContent ?? {},
    slug,
  )

  if (hasExactVideoLanguages) {
    return videoAdmission ?? { kind: "not-found" }
  }
  if (isWatchRouteAdmittedByManifest(manifest, decision.manifestRoute)) {
    return { kind: "admit" }
  }
  return videoAdmission ?? { kind: "not-found" }
}
```

This maps `/watch/jesus.html` internally through the existing
`/watch/en/en/jesus.html/english.html` render path without a `Location`
response header. Unknown slugs, Videos without admitted English audio, and
manifest-unavailable non-collection paths remain fixed 404s.

When the manifest is available, tests pin the cheap negative path:

```ts
it("404s safe-looking unknown content slugs before catch-all page resolution", async () => {
  const response = await proxy(makeRequest("/anything.html/english.html"))
  expect(response.status).toBe(404)
  expect(rewritePath(response)).toBeNull()
})
```

Revalidation now maps UI catalog locales to public slugs before calling `revalidatePath()`:

```ts
const audioLanguageSlug = publicWatchAudioLanguageSlugForLocale(locale)
pushTwoSeg(slug, audioLanguageSlug)
```

The mapping deliberately distinguishes content audio URLs from one-segment home URLs:

```ts
const PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE = Object.freeze({
  en: "english",
  es: "spanish-castilian",
  fr: "french",
  pt: "portuguese-brazil",
  de: "german-standard",
})

const PUBLIC_WATCH_HOME_LANGUAGE_SLUG_BY_UI_LOCALE = Object.freeze({
  ...PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE,
  de: "german",
})
```

That keeps `/watch/german.html` valid as a language home without making `/watch/jesus.html/german.html` a valid content audio URL.

One-segment language-home metadata now preserves the public segment for canonical/OG output:

```ts
return shape.isLanguageHome
  ? getWatchPageMetadata(shape.locale, { pathLocale: shape.slug })
  : getWatchPageMetadata(shape.locale, { slug: shape.slug })
```

The route segment also gained a sibling error boundary at `apps/web/src/app/[locale]/[htmlLang]/error.tsx` so root, home, and videos surfaces are covered by the same segment convention as the catch-all route.

## Why This Works

The fix separates three identities that travel together but are not interchangeable:

- Public route slug: `english`, `spanish-castilian`, `german`, `german-standard`.
- UI message catalog key: `en`, `es`, `de`.
- Static HTML language tag: `en`, `es-419`, `de`.

Keeping these separate prevents catalog keys from leaking into public audio slots and prevents home-only slugs from becoming valid content audio slugs.

The manifest check also moves negative route admission ahead of the expensive/static boundary when web has a fresh or stale cached manifest. Instead of letting every safe-looking path become a potential ISR key and page resolver miss, proxy can reject known-impossible route dimensions before the request reaches the force-static catch-all.

The language-less compatibility path does not create another page resolver. It
proves the English target through the same route manifest, then reuses the
existing two-segment English render path. That preserves one implementation
for content, metadata, structured data, and UI while keeping the durable
public address unchanged.

The implementation intentionally preserves availability if
`getWatchRouteManifest()` returns `null`: known one-segment collections fall
back to the legacy `isOneSegmentCollectionSlug` allowlist, while unknown
one-segment paths—including language-less Videos—fail closed. Existing
two-/three-segment routes still fail open to the page resolver. The manifest
remains an admission gate, not a rendering payload or content resolver; admin
still owns the lifecycle and web still resolves content normally for admitted
paths. (session history)

## Prevention

- Keep route identity tests at every boundary:

  ```ts
  expect(revalidatePathMock).toHaveBeenCalledWith("/jesus.html/english.html")
  expect(revalidatePathMock).not.toHaveBeenCalledWith("/jesus.html/en.html")
  ```

  ```ts
  expect(resolveWatchLocaleIdentity("german")).toEqual({
    locale: "de",
    htmlLang: "de",
  })
  expect(isPublicWatchLanguageSlug("german")).toBe(false)
  ```

- Add hostile route fixtures against proxy, not only the catch-all page:

  ```ts
  const contentResponse = await proxy(
    makeRequest("/anything.html/english.html"),
  )
  expect(contentResponse.status).toBe(404)
  expect(rewritePath(contentResponse)).toBeNull()

  const episodeResponse = await proxy(
    makeRequest("/lumo-the-gospel-of-john.html/anything/english.html"),
  )
  expect(episodeResponse.status).toBe(404)
  expect(rewritePath(episodeResponse)).toBeNull()
  ```

- Pin the language-less compatibility outcome at the proxy boundary:

  ```ts
  const response = await proxy(
    makeRequest("/jesus.html?utm_source=legacy&ref=printed"),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("location")).toBeNull()
  expect(rewritePath(response)).toBe("/en/en/jesus.html/english.html")
  ```

  Pair that positive case with exact no-English and manifest-unavailable 404
  cases. This prevents a future route migration from silently removing the
  English default or reopening arbitrary one-segment paths.

- Revalidate both public and internal route shapes, but derive public language segments from the raw public slug map. Never use `AVAILABLE_UI_LOCALES` directly as the public audio slot.
- Clear the web manifest cache on the `watch-route-manifest` webhook so admin refreshes can propagate without waiting for the polling TTL.
- Prove static behavior with both build output and runtime headers. Build output should show the watch routes as `○ (Static)`, and a second production-server request should return `x-nextjs-cache: HIT` with `Cache-Control: s-maxage=60`.

Verification for this fix:

```bash
pnpm --filter @forge/web test -- src/app/api/revalidate/route.test.ts src/lib/locale.test.ts 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/proxy.test.ts src/lib/watch-route-manifest.test.ts
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
pnpm --filter @forge/web build
pnpm --filter @forge/web exec next start -p 3015
curl -sS -D - -o /dev/null http://localhost:3015/watch/english.html
curl -sS -D - -o /dev/null http://localhost:3015/watch/english.html
```

The production-server proof returned `x-nextjs-cache: MISS` on the first request, then `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`, and `Cache-Control: s-maxage=60, stale-while-revalidate=31535940` on the second.

## 2026-07-25 Canonical URL Supersession

The admission and explicit internal rewrite described above remain current.
What changed is public identity: an admitted, non-colliding English Video now
uses `/watch/{slug}.html` as its canonical, Open Graph, structured-data, share,
and sitemap URL. `/watch/{slug}.html/english.html` remains a direct
compatibility route and the internal renderer target. Non-English and
contextual browser routes remain language-explicit; a Video slug matching a
public language home also keeps explicit English.

## 2026-07-25 Cold Localized-Home Redirect Admission

A cold production build exposed a Next.js 16 edge that warm-cache probes hid:
when a force-static localized-home page discovered that its homepage was
missing and called `redirect()`, the first ISR response could emit the same
`Location` header twice. Node combined those headers into an invalid
comma-separated path; later warm responses emitted only one header.

The durable fix is to decide this route before the static page boundary:

- Admin's Watch route manifest now includes `homepageLocales`, derived from
  published, non-template Experience locales flagged `is_homepage`.
- Web proxy admission redirects an absent localized home to its `/videos`
  index with one `307`, before Next.js creates an ISR entry.
- Old manifests remain readable during deployment overlap. If
  `homepageLocales` is absent, Web loads the existing `watchSetting(locale)`
  GraphQL contract only for the requested locale.
- The fallback coalesces concurrent requests and caches known per-locale
  results. An upstream failure is not cached or treated as proof that a
  homepage is missing.
- Every mutation that can remove a published locale from the route surface,
  including restoring its revision back to draft, refreshes the manifest.
  This keeps both route admission and `homepageLocales` synchronized.

Do not move this redirect back into the force-static page. Test both raw cold
headers and followed behavior: a missing localized home must have one
`Location`, while an available home must remain a direct `200`.

## Related Issues

- [Admin-Owned Watch Route Manifest](../architecture-patterns/admin-owned-watch-route-manifest-20260530.md) - producer-side manifest pattern and lifecycle.
- [Migrating Next.js App Router route shapes](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md) - route-contract drift across proxy, metadata, URL builders, and revalidation.
- [Next.js headers() in page routes silently defeats Full Route Cache](../web/nextjs-headers-defeats-route-cache.md) - original static rendering pitfall that made proxy-owned request logic necessary.
- [Route-Level ISR with Apollo GraphQL and On-Demand Revalidation](../web/nextjs16-cachecomponents-isr.md) - ISR and revalidation background.
- [Series page slug-form locale normalization](../ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md) - earlier recurrence of treating slug-form language identifiers as BCP-47/catalog keys.
- GitHub issue [#497](https://github.com/JesusFilm/forge/issues/497) - historical ISR/revalidation context.
