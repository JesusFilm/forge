---
title: "Use a statusless proxy rewrite and fixed not-found sentinel for App Router 404s"
date: "2026-07-13"
category: "integration-issues"
module: "apps/web Watch routing"
problem_type: "integration_issue"
component: "frontend_stimulus"
symptoms:
  - "Proxy-rejected Watch URLs returned an empty 404 body instead of the locale-scoped not-found experience"
  - "Resolver-level misses rendered the framework default because the locale route had no not-found boundary"
  - "Adding status 404 to the intermediate middleware rewrite broke App Router soft navigation"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/proxy.ts"
  - "apps/web/src/app/[locale]/[htmlLang]/404/page.tsx"
  - "apps/web/src/app/[locale]/[htmlLang]/not-found.tsx"
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

# Use a statusless proxy rewrite and fixed not-found sentinel for App Router 404s

## Problem

Watch rejects impossible public URLs in Next.js Proxy before they reach a
force-static catch-all. Returning a terminal `new NextResponse(null, { status:
404 })` preserved the admission and cache-spray boundary, but viewers received
an empty response. Resolver-level `notFound()` calls had a different failure
mode: without a locale-scoped boundary they rendered Next.js's default page.

Both paths needed one useful page without letting arbitrary invalid URLs become
internal App Router or ISR keys. The final document also had to remain a true
404 during direct loads and client-side navigation.

## Symptoms

- Structurally invalid or manifest-rejected URLs produced an empty body.
- Admitted routes whose content resolver missed produced a framework-default
  page instead of the Watch design.
- Setting `{ status: 404 }` on `NextResponse.rewrite()` appeared correct for a
  direct document request, but App Router soft navigation no longer handled the
  rewrite as a normal React Server Component navigation response.
- Rewriting each miss to an internal version of its original path would have
  created unbounded internal identities and weakened the existing admission
  guard.

## What Didn't Work

- **Returning the 404 directly from Proxy.** This is cheap and semantically
  correct, but Proxy cannot render the locale layout and not-found component.
- **Putting status 404 on the intermediate rewrite.** The rewrite is transport
  into the App Router, not the final error response. A status-bearing
  intermediate response conflicts with the RSC soft-navigation protocol even
  when a hard navigation appears to work.
- **Letting every invalid path reach the catch-all and call `notFound()`.** That
  would restore UI at the cost of Admin resolver work and potentially unbounded
  static not-found cache entries—the exact behavior the route manifest prevents.

## Solution

Keep Proxy's negative classification and manifest admission intact, but make
every page-level negative branch rewrite to one fixed internal sentinel. Reuse
the normal internal rewrite helper so the request marker, security headers, and
locale layout behavior remain consistent:

```ts
function buildNotFound(request: ProxyRequest): NextResponse {
  return rewriteToInternal(request, {
    kind: "rewrite",
    locale: DEFAULT_LOCALE,
    htmlLang: DEFAULT_LOCALE,
    pathname: "/404",
  })
}
```

The helper deliberately does **not** set an HTTP status on
`NextResponse.rewrite()`:

```ts
return applyWatchSecurityHeaders(
  NextResponse.rewrite(url, {
    request: { headers: requestHeaders },
  }),
)
```

The fixed destination calls `notFound()` before rendering or streaming:

```tsx
export default function WatchNotFoundSentinel() {
  notFound()
}
```

A sibling locale boundary renders the shared page:

```tsx
export default function NotFound() {
  return <WatchNotFound />
}
```

Test the two stages according to their separate contracts. Proxy unit tests
assert a normal intermediate rewrite to the fixed path plus the request marker
and security headers:

```ts
expect(response.status).toBe(200)
expect(rewritePath(response)).toBe("/en/en/404")
expect(
  rewrittenRequestHeaders(response).get(WATCH_INTERNAL_REWRITE_HEADER),
).toBe("1")
```

Production HTTP and browser tests—not the Proxy unit test—assert the final
document contract: HTTP 404, `noindex`, original public URL retained, custom
body rendered, and successful hard and soft navigation.

## Why This Works

The statusless rewrite and the sentinel have different responsibilities:

1. Proxy classifies the public URL and keeps invalid paths outside the
   force-static resolver boundary.
2. One fixed rewrite destination prevents invalid public paths from becoming
   distinct internal cache identities.
3. The intermediate response remains compatible with App Router's RSC
   navigation protocol.
4. `notFound()` at the fixed destination throws before streaming, allowing
   Next.js to select the locale-scoped boundary and own the final HTTP 404 plus
   automatic `noindex` metadata.

This separation is why a Proxy unit test should expect a 200 rewrite while the
end-to-end document must still be 404. Treating those statuses as if they
described the same response stage recreates the soft-navigation bug.

## Prevention

- Keep all proxy-owned page misses converged on one fixed sentinel. Do not
  interpolate the rejected pathname into the internal destination.
- Never infer the final document status from the `NextResponse.rewrite()` unit
  response. Prove it against a production Next.js server.
- Include both a direct document request and App Router link navigation in
  browser proof whenever rewrite status or not-found routing changes.
- Assert the original URL, `noindex`, security headers, and absence of page
  resolver or remote-media work on the invalid path.
- Preserve separate characterization tests for valid rewrites, canonical
  redirects, reserved assets/APIs, and manifest-rejected routes.
- If a page needs a shared layout, place `not-found.tsx` at the segment whose
  layout should remain visible; keep the sentinel inside that same segment.

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
- Roadmap tickets `feat-250` and `feat-251` track the custom Watch 404 and the
  separate route-scoping of inherited media resource hints.
