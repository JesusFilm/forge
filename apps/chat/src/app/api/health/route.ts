/**
 * `GET /api/health` — Railway's deploy healthcheck (feat-305), the gate that
 * stops a boot-but-broken deployment from being promoted over a working one.
 *
 * Deliberately SHALLOW: no env read, no Mastra call, no session decode, no gate
 * resolution — nothing but this process answering HTTP. It therefore succeeds
 * on chat's default-off boot (no Seeker config at all), and a Mastra outage
 * never becomes a chat rollback.
 *
 * Load-bearing coupling — keep this route dependency-free AND never make it
 * survive a process-wide boot failure. When instrumentation `register()` throws
 * (the feat-306 case), Next keeps listening but returns 500 on EVERY route,
 * this one included, because `prepare()` fails process-wide — not because of
 * anything in this handler. That shared-`prepare()` fate is what arms the gate:
 * the probe gets 500, so Railway refuses to promote. Serving `/api/health` from
 * middleware, a sidecar, or anything that outlives a failed `prepare()` would
 * make it answer 200 while the app is broken — silently disarming feat-306.
 */

export const dynamic = "force-dynamic"

export function GET(): Response {
  // Railway's prober is unauthenticated and this route is publicly reachable,
  // so the body stays a fixed literal — no env-derived value can leak through
  // it, not even a "harmless" base-URL echo.
  return Response.json({ ok: true, service: "forge-chat" }, { status: 200 })
}
