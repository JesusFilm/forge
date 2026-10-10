---
title: "Keep runtime feature flags out of static Watch route rendering"
date: 2026-07-21
category: integration-issues
module: apps/web Watch
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "LaunchDarkly changes do not reliably update UI rendered through force-static or ISR Watch routes"
  - "A rebuild or route revalidation is needed before viewers see the new flag value"
root_cause: config_error
resolution_type: code_fix
severity: high
related_components:
  - "Next.js Full Route Cache"
  - "LaunchDarkly server evaluation"
tags:
  - watch
  - launchdarkly
  - nextjs
  - isr
  - feature-flags
  - full-route-cache
---

# Keep runtime feature flags out of static Watch route rendering

## Problem

Watch needed a runtime LaunchDarkly switch for the global beta-tester CTA. A
server-layout evaluation looked like the narrowest implementation, but public
Watch routes are deliberately static or ISR-rendered. That would capture the
evaluated value in the Full Route Cache and make later dashboard flips stale.

## Symptoms

- LaunchDarkly dashboard changes do not affect an already-generated Watch page.
- A rebuild or route-cache revalidation is required before the UI changes.
- Making the shared layout dynamic would fix freshness by sacrificing static
  caching for every public Watch route.

## What Didn't Work

Evaluating the flag in the locale layout and passing a boolean to the client
provider couples the operational decision to static route generation:

```tsx
const showGlobalTrigger = await isWatchGlobalBetaTesterCtaEnabled()

return (
  <BetaTesterModalProvider showGlobalTrigger={showGlobalTrigger}>
    {children}
  </BetaTesterModalProvider>
)
```

The server SDK stays private, but the resulting boolean is still cache-bound.
Making the entire layout dynamic has too large a performance blast radius.

## Solution

Keep the page and layout static. Evaluate the flag through a narrow same-origin
route handler that is explicitly dynamic and non-cacheable:

```ts
export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const

export async function GET(): Promise<NextResponse> {
  try {
    const enabled = await isWatchGlobalBetaTesterCtaEnabled()
    return NextResponse.json({ enabled }, { headers: NO_STORE_HEADERS })
  } catch {
    return NextResponse.json(
      { enabled: false },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
```

The client provider starts from the safe state and requests the evaluated
boolean after hydration:

```tsx
const [showGlobalTrigger, setShowGlobalTrigger] = useState(false)

useEffect(() => {
  let active = true

  void fetch("/watch/api/beta-tester-cta", {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) =>
      response.ok ? ((await response.json()) as { enabled?: unknown }) : null,
    )
    .then((result) => {
      if (active && typeof result?.enabled === "boolean") {
        setShowGlobalTrigger(result.enabled)
      }
    })
    .catch(() => {})

  return () => {
    active = false
  }
}, [])
```

Key the provider-owned state to the pathname when navigation should refresh the
decision. Gate only the floating launcher; keep the shared modal context and
authored entry points mounted. The modal and external embed remain lazy.

## Why This Works

The Watch document remains eligible for static caching, while the small route
handler performs request-time server evaluation. Request and response no-store
directives prevent browsers and intermediaries from reusing an old decision.
Initial false state avoids a CTA flash, and malformed, non-OK, or rejected
evaluations stay hidden without disabling other entry points.

## Prevention

- Treat server-evaluated values read during static/ISR rendering as cache-bound.
- Use a narrow dynamic endpoint when a small UI decision must change
  independently of the page's regeneration lifecycle.
- Apply no-store behavior to both the request and response.
- Default rollout UI to the safe state and validate the response shape.
- Test that the static layout does not evaluate the flag, the endpoint returns
  both variations without caching, failure stays safe, and navigation remounts
  can observe both flip directions.
- Browser-check that the disabled UI is absent and gated lazy resources are not
  requested before activation.

## Related Issues

- [Runtime flags in static App Router components](../runtime-errors/nextjs-force-dynamic-runtime-env-flag-static-optimization-20260626.md)
- [LaunchDarkly feature-flag foundation](../platform/launchdarkly-feature-flag-foundation-20260527.md)
- [Watch static route admission](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md)
