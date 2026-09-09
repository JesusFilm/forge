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
