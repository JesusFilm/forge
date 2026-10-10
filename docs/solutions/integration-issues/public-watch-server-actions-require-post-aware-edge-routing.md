---
title: "Public Watch Server Actions require POST-aware edge routing"
date: "2026-07-23"
category: "integration-issues"
module: "apps/web watch"
problem_type: "integration_issue"
component: "nextjs_route_handler"
severity: "high"
applies_when:
  - "A client interaction dynamically imports a Next.js Server Action from a public Watch page"
  - "GET requests reach the self-hosted Watch app through Cloudflare but POST requests to the same page return before Next.js"
  - "A read-only client interaction can use the existing /watch/api ingress"
related_components:
  - "apps/web/src/lib/watch-interaction-loader.ts"
  - "apps/web/src/app/api/language-options/route.ts"
  - "apps/web/src/components/watch/GlobalLanguagePickerModal.tsx"
tags:
  - "watch"
  - "nextjs"
  - "server-actions"
  - "cloudflare"
  - "route-handler"
  - "language-picker"
---

# Public Watch Server Actions require POST-aware edge routing

## Context

The provider-owned global language picker opened correctly on
`/watch/english-british.html` but always showed its localized connection error.
The client loader dynamically imported a `"use server"` function, so Next.js
submitted the catalog request as a POST to the current public page URL.

The document GET succeeded through the public Watch route, but browser network
capture showed the action POST receive `404 text/plain` from Cloudflare. No
Next.js or Admin response headers were present, and the Admin GraphQL query
never ran. The same origin returned `200 application/json` for an existing GET
under `/watch/api/*`, establishing the working ingress boundary.

## Guidance

### Diagnose the transport before changing the query

When a lazy interaction reports a generic connection failure, capture the
request method, URL, status, response content type, and response owner on the
exact public route. A page that renders successfully proves only the GET path;
it does not prove that the edge forwards the POST used by Server Actions.

Do not optimize or split the downstream query until the request is known to
reach the application. In this incident, the original language query and its
five-minute server cache were healthy and never executed.

### Use the admitted read boundary for read-only interactions

For the global catalog, a force-dynamic GET route under
`/watch/api/language-options` matches the public edge's admitted route family.
The route keeps Admin credentials server-only, reuses the existing cached
metadata source, projects only public routing identity, sets private no-store
headers, and collapses failures to a fixed 503 response.

The client keeps the existing interaction-loader contract:

- no request during initial render or disabled catalog warmup;
- concurrent calls share one promise;
- successful options remain in memory;
- HTTP, JSON, or shape failures reject and evict the pending promise;
- Retry performs a new GET.

Validate the JSON shape at the transport boundary, then let the picker apply its
stronger public-slug validation before rendering or navigation.

### Keep the repair narrow

Moving one read-only catalog does not prove that every Server Action should
become a route handler. Preserve page-specific actions unless they reproduce the
same public-edge failure, and avoid widening public API surface without a
concrete caller. Long term, either make public edge routing POST-aware for
Next.js pages or audit other Watch interactions that still depend on
page-bound action POSTs.

## Verification

Use both source-level and real-browser evidence:

1. A default-loader test must fail while the client imports the Server Action
   and pass only when it issues `GET /watch/api/language-options`.
2. Route tests cover compact success, private no-store headers, and a fixed
   safe 503 response.
3. Loader tests cover malformed payloads and HTTP failure followed by a
   successful retry.
4. Before opening the picker, browser/server logs show no catalog request.
5. After opening, network capture shows one catalog `GET 200` and no page POST.
6. Block the GET once, observe the localized error, unblock it, select Retry,
   and confirm the full catalog returns.
7. Apply a language and wait for the canonical destination plus translated UI,
   rather than treating the source-page pending state as navigation proof.

## Related

- `docs/plans/2026-07-23-001-fix-watch-global-language-catalog-loading-plan.md`
- `docs/roadmap/platform/feat-300-watch-global-language-options-api.md`
- `docs/solutions/architecture-patterns/provider-owned-watch-language-fallback-and-page-overrides.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
