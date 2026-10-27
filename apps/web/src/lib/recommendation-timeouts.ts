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

// On 27 Oct successful Admin surface writes had sampled p95 1.63 seconds.
// Allow the write to finish without encouraging an immediate ambiguous retry.
// Admission can take up to 500 ms; the browser leaves another 500 ms for Web
// work and transit. These budgets do not block page or player navigation.
export const RECOMMENDATION_SURFACE_EXPOSURE_UPSTREAM_TIMEOUT_MS = 2_000
export const RECOMMENDATION_SURFACE_EXPOSURE_BROWSER_DEADLINE_MS = 3_000

// Issuing a served-surface window uses the 3-second evidence upstream budget.
// Keep the browser boundary after that budget and admission/transit headroom.
export const RECOMMENDATION_SURFACE_DELIVERY_BROWSER_DEADLINE_MS = 4_500

// A selection click waits at most 800 ms before navigating to the trusted
// href. Its keepalive request may finish later, so Admin can acknowledge a
// normal slow write without holding navigation or retrying a different event.
// Leave admission and transit headroom beyond the Web-to-Admin timeout.
export const RECOMMENDATION_SELECTION_NAVIGATION_DEADLINE_MS = 800
export const RECOMMENDATION_SELECTION_UPSTREAM_TIMEOUT_MS = 2_000
export const RECOMMENDATION_SELECTION_REQUEST_DEADLINE_MS = 3_000
