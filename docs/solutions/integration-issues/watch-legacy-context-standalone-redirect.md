---
title: "Recover invalid legacy Watch contexts through admitted standalone routes"
date: "2026-07-24"
category: "integration-issues"
module: "apps/web watch routing"
problem_type: "integration_issue"
component: "service_object"
symptoms:
  - "Legacy contextual Watch URLs returned the shared 404 after their parent-child relationship was removed"
  - "The child Video and requested Dub could still have a valid standalone route"
  - "A blanket contextual redirect would risk flattening currently valid collection navigation"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "testing_framework"
tags:
  - "watch-route"
  - "legacy-url"
  - "route-manifest"
  - "contextual-route"
  - "standalone-route"
  - "redirect"
  - "seo"
---

# Recover invalid legacy Watch contexts through admitted standalone routes

## Problem

Indexed Watch URLs can outlive the Admin relationship that originally placed a
Video under a collection. The Web proxy correctly rejected the stale
parent-child pair, but it always sent that request to the shared 404 even when
the same Video and Dub remained independently available at the canonical
standalone URL.

## Symptoms

- A URL such as
  `/watch/discipleship.html/parable-of-the-sower-and-the-seed/spanish-latin-american.html`
  returned Page not found after the Discipleship relationship disappeared.
- The corresponding standalone URL
  `/watch/parable-of-the-sower-and-the-seed.html/spanish-latin-american.html`
  was still a valid public route.
- Valid parent-child collection URLs had to retain their contextual URL and
  page state rather than being flattened.

## What Didn't Work

- Treating every rejected contextual route as a 404 discarded a valid recovery
  path already represented by the same route manifest.
- Redirecting every three-segment route before contextual admission would
  break valid collection navigation and discard useful parent context.
- Checking only that the child slug existed was insufficient because a Video
  may not have the requested Dub. The redirect target must pass the same
  content-language admission used by direct standalone requests.
- Fetching Admin data or a second manifest for fallback resolution would add
  latency and could make the original and fallback decisions disagree.

## Solution

Make manifest admission an explicit three-outcome decision in the Web proxy:
admit the contextual route, redirect to an admitted standalone route, or use
the fixed 404.

The ordering is the contract:

```ts
if (isWatchRouteAdmittedByManifest(manifest, contextualRoute)) {
  return { kind: "admit" }
}

const standaloneRoute = {
  kind: "video",
  contentSlug: contextualRoute.childSlug,
  audioLanguageSlug: contextualRoute.audioLanguageSlug,
}

if (isWatchRouteAdmittedByManifest(manifest, standaloneRoute)) {
  return {
    kind: "redirect",
    pathname: watchVideoPath(
      asContentSlug(standaloneRoute.contentSlug),
      asLocaleSlug(standaloneRoute.audioLanguageSlug),
    ),
  }
}

return { kind: "not-found" }
```

The proxy clones the incoming URL, replaces only its pathname, and returns a
301 through the shared redirect helper. This preserves query parameters and
the existing private no-cache redirect policy:

```ts
if (admission.kind === "redirect") {
  const url = request.nextUrl.clone()
  url.pathname = admission.pathname
  return buildRedirect(url, 301)
}
```

Keep the existing availability behavior when the manifest cannot be loaded. A
missing manifest cannot prove either that the context is invalid or that the
standalone target is valid, so multi-segment routes continue to fail open to
normal contextual resolution.

## Why This Works

The route manifest already contains both facts needed for a safe decision:
whether the exact parent-child-language tuple is admitted and whether the
child-language tuple is admitted independently. Reusing one fetched snapshot
keeps those decisions consistent and avoids adding Admin resolver work.

Exact contextual admission runs first, so every valid parent-child route keeps
its URL and collection state. Only the negative contextual branch can flatten,
and only to a destination that passes the existing standalone Video/Dub
admission contract. If neither route is admitted, the fixed 404 remains the
result.

The fallback intentionally applies to any safe rejected contextual pair. The
manifest does not preserve historical relationships, so the proxy cannot
distinguish a deleted parent from a moved Video or a mistyped parent. Requiring
an independently valid standalone destination bounds recovery to a real public
page without maintaining a legacy-parent allowlist.

## Prevention

- Preserve the decision matrix in proxy tests:

  ```text
  exact context admitted                         -> contextual rewrite
  context rejected + standalone admitted         -> 301 standalone
  context rejected + standalone Dub not admitted -> fixed 404
  manifest unavailable                           -> contextual fail-open
  ```

- Assert the redirect status, canonical destination, query preservation,
  cache-control header, absence of an internal rewrite, and one manifest source
  invocation.
- Use the shared Watch route builder for redirect destinations; do not
  concatenate public route strings in proxy code.
- Test exact content-language indexes so a known Video with a missing requested
  Dub cannot redirect to another 404.
- Include direct HTTP and browser proof. A controlled runtime should show one
  301 hop to the standalone page, no redirect for a valid contextual route,
  and a 404 for an invalid standalone target.
- Keep this recovery in the proxy admission layer. The route manifest remains
  an admission contract, not a rendering payload or historical relationship
  store.

## Related Issues

- [Bound Watch static route admission with the Admin route manifest](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md)
- [Admin-owned Watch route manifest](../architecture-patterns/admin-owned-watch-route-manifest-20260530.md)
- [Migrating Next.js App Router route shapes](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md)
- [Public Watch URL two-segment contract](../conventions/public-watch-url-two-segment-contract-20260608.md)
- `docs/plans/2026-07-24-003-fix-watch-legacy-context-redirects-plan.md`
- `docs/roadmap/platform/feat-314-watch-legacy-context-redirects.md`
