// The 2026-09-08 audit measured successful evidence p95 at 1.91 seconds.
// Allow ~1 second of upstream headroom and 2 seconds for admission, transit,
// Web work and full acknowledgement parsing. This provisional budget must be
// verified by the production canary; it does not change ranking's service budget.
export const RECOMMENDATION_EVIDENCE_UPSTREAM_TIMEOUT_MS = 3_000
export const RECOMMENDATION_EVIDENCE_BROWSER_DEADLINE_MS = 5_000

// Profile transitions write several privacy-fenced records in one Admin
// transaction. Production p95 can exceed the original sub-second evidence budget, so
// keep this control-plane timeout separate from fire-and-forget evidence calls.
export const RECOMMENDATION_PROFILE_UPSTREAM_TIMEOUT_MS = 3_000

// Leave room for admission, Web execution, and browser-to-edge transit around
// the upstream budget. The browser deadline must remain the larger boundary.
export const RECOMMENDATION_PROFILE_BROWSER_DEADLINE_MS = 5_000

// Content actions are idempotent and best-effort. The browser deadline leaves
// room for bounded admission and upstream plus a provisional transit reserve,
// so it does not abort and retry a write the route is about to acknowledge:
//   admission 500 ms (production worker: 250 ms connect + 250 ms commands,
//   see recommendation-admission-worker-client.ts)
// + Admin upstream 900 ms
// + 100 ms provisional reserve for session minting, body parse and transit
// = 1,500 ms. The reserve is an assumption, not a guarantee: a blocked event
// loop or slow transit can still exceed it.
// recommendation-content-action-timing.test.ts derives the admission term from
// the real constants. An upstream timeout is not a rollback and does not
// deduplicate an Admin write; the retry stays bounded to one.
export const RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS = 900
export const RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS = 1_500

// Surface exposure keeps its own original Admin budget. Its browser deadline is
// still the 700 ms literal in WatchExposureBoundary.tsx (tracked by feat-688).
export const RECOMMENDATION_SURFACE_EXPOSURE_UPSTREAM_TIMEOUT_MS = 900
