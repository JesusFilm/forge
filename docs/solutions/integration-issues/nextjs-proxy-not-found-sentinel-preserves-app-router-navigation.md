---
title: "Use a statusless localized sentinel for Watch App Router 404s"
date: "2026-07-13"
last_updated: "2026-08-19"
category: "integration-issues"
module: "apps/web Watch routing"
problem_type: "integration_issue"
component: "frontend_stimulus"
symptoms:
  - "Proxy-rejected Watch URLs returned an empty 404 body instead of the locale-scoped not-found experience"
  - "Resolver-level misses rendered the framework default because the locale route had no not-found boundary"
  - "Adding status 404 to the intermediate middleware rewrite broke App Router soft navigation"
  - "Recognized non-English Watch routes rendered the English ordinary 404"
  - "Localized cards opened playback or recovery pages with English metadata"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/admin/src/services/video.service.ts"
  - "apps/web/src/proxy.ts"
  - "apps/web/src/proxy.test.ts"
  - "apps/web/src/app/[locale]/[htmlLang]/404/page.tsx"
  - "apps/web/src/app/[locale]/[htmlLang]/not-found.tsx"
  - "apps/web/src/components/watch/WatchUnavailableLanguage.tsx"
  - "apps/web/src/lib/watch-unavailable-recovery-actions.ts"
tags:
  - "nextjs"
  - "app-router"
  - "proxy"
  - "not-found"
  - "rewrite"
  - "soft-navigation"
  - "http-status"
  - "watch"
---

# Use a statusless localized sentinel for Watch App Router 404s

## Problem

Watch rejects impossible public URLs in Next.js Proxy before they reach its
force-static content resolver. Those requests still need a localized Watch
error page, but the original sentinel sent every ordinary miss to
`/en/en/404`. A valid Chinese, Russian, or Arabic route therefore lost the
locale Proxy had already resolved.

The internal route must remain bounded: rejected content slugs cannot become
App Router or cache keys. The final document must also retain the original
public URL, HTTP 404, and `noindex` behavior.

## Symptoms

- A recognized non-English route for unknown content displayed the English
  ordinary 404.
- Malformed paths and unknown language identities still needed a safe English
  fallback.
- The ordinary unknown-content 404 had to remain separate from the
  known-content/missing-language recovery page.

## What Didn't Work

- Returning an empty 404 directly from Proxy cannot render the Watch layout.
- Putting status 404 on the intermediate rewrite breaks App Router soft
  navigation because that rewrite is transport, not the final document.
- Rewriting each miss with its rejected content slug creates unbounded internal
  identities and weakens the route-manifest boundary.
- Treating a known-content/missing-language route as an ordinary 404 removes
  the recovery choices introduced by PR #1929.

## Solution

After `classifyRewrite` resolves a valid public language and manifest admission
returns `not-found`, pass only the validated `locale` and `htmlLang` identity to
`buildNotFound`. The missing content slug is never included:

```ts
function buildNotFound(
  request: ProxyRequest,
  identity?: Pick<
    Extract<RewriteDecision, { kind: "rewrite" }>,
    "locale" | "htmlLang"
  >,
) {
  return rewriteToInternal(request, {
    kind: "rewrite",
    locale: identity?.locale ?? DEFAULT_LOCALE,
    htmlLang: identity?.htmlLang ?? DEFAULT_LOCALE,
    pathname: "/404",
  })
}
```

This produces a bounded localized target such as `/zh-Hans/zh-Hans/404` while
malformed paths and unknown language identities continue to use `/en/en/404`.
The request marker carries the fixed claim `/404`, not the rejected public
pathname.

On Proxy re-entry, accept only exact paths in a finite set derived from the
public Watch language-slug corpus. A broad BCP-47 resolver is not sufficient
for this check: it deliberately maps valid-looking tags such as `en-AA` to the
English UI catalog, even though Proxy can never generate `/en/en-AA/404` from
a public Watch language slug. Exact set membership rejects both mismatched
pairs such as `/zh-Hans/en/404` and synthetic same-family tags while avoiding a
second route-manifest read.

The intermediate rewrite remains statusless. The fixed sentinel then calls
`notFound()` synchronously, allowing the locale boundary to render
`WatchNotFound` and Next.js to produce the final HTTP 404 and `noindex` metadata.

Both public failure URLs finish with HTTP 404 and `noindex`. The distinction is
the rendered body: unknown content uses the ordinary localized 404, while
a manifest-proven video route admitted to missing-audio recovery uses the
specialized recovery page and includes playable alternatives when recovery
data resolves successfully.

## Why This Works

The request has two stages with separate responsibilities:

1. Proxy classifies the URL, checks the route manifest, and rewrites a proven
   miss to one locale-prefixed `/404` sentinel.
2. The sentinel throws `notFound()` before page rendering; the nearest locale
   boundary renders the complete localized 404 in the first server response.

`WatchNotFound` has no client data request or loading state, so its title,
artwork, and actions do not get replaced after hydration. The separate
known-content/missing-language sentinel follows the same first-render rule:
its server boundary reads the Proxy-verified public path, resolves title,
artwork, and exact manifest-admitted audio options, and passes that final data
to the client component. Browser storage may help the Back to search action,
but it cannot replace visible recovery data after hydration.

Content lookup has a separate identity boundary from URL and HTML language
formatting. Web keeps canonical BCP-47 formatting such as `zh-Hans` and
`pt-PT`, while Admin's Watch route snapshot uses `languageSlug` as the exact
public content identity. BCP-47 `locale` remains the broad content fallback,
followed by English. This handles `zh-Hans` versus `zh-hans` without a
case-insensitive database filter, forcing every stored tag to lower case, or
collapsing distinct languages. A localized inventory card, its normal playback
page, and the unavailable-language recovery page can therefore select the same
exact metadata.

## Prevention

- Keep every ordinary miss on the fixed `/404` suffix. Vary only a previously
  validated locale/html-language prefix.
- Keep malformed paths, unknown identities, and forged internal claims on the
  English fallback.
- Test both cross-locale forgeries and same-family synthetic BCP-47 tags when
  an internal sentinel accepts a locale/html-language pair.
- Never infer the final document status from the `NextResponse.rewrite()` unit
  response. Prove it against a production Next.js server.
- Verify HTTP 404, `noindex`, original URL, localized HTML, and a stable first
  render in production mode.
- Preserve `/unavailable/404` for content proven to exist without the requested
  audio language; it is not an ordinary unknown-content 404.
- Resolve unavailable-language display data on the server and avoid a
  route-local loading screen that would reintroduce an intermediate visible
  state.
- Use exact language slugs for Watch route-snapshot metadata. Keep BCP-47
  locales as broad fallback selectors; do not solve metadata misses with
  browser title hints, case-insensitive database filters, or per-language
  special cases.

## Related Issues

- [Bound Watch Static Route Admission with the Admin Route Manifest](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md)
  explains why impossible URLs must be rejected before the force-static page
  resolver. This document extends that boundary with a rendered response.
- [Migrating Next.js App Router route shapes](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md)
  covers the broader route-contract surface across middleware, URL builders,
  metadata, tests, and page files.
- [Frontend changes require page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
  describes the timing and waterfall proof required when routing or rendering
  changes.
- [Keep unavailable search evidence separate from playback identity](../logic-errors/watch-search-unavailable-evidence-playback-identity.md)
  documents the adjacent known-content/missing-language recovery contract.
- [Key content language identity on exact slugs, not BCP-47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
  explains why exact Watch metadata selection must use the public language
  slug before applying broader locale fallbacks.
- Roadmap tickets `feat-250`, `feat-251`, `feat-361`, `feat-397`, and `feat-398`
  cover the custom 404, resource hints, unavailable-language recovery,
  localized ordinary 404 behavior, and stable recovery first render.
