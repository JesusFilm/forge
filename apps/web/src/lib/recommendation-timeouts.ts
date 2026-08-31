// Profile transitions write several privacy-fenced records in one Admin
// transaction. Production p95 can exceed the sub-second evidence budget, so
// keep this control-plane timeout separate from fire-and-forget evidence calls.
export const RECOMMENDATION_PROFILE_UPSTREAM_TIMEOUT_MS = 3_000

// Leave room for admission, Web execution, and browser-to-edge transit around
// the upstream budget. The browser deadline must remain the larger boundary.
export const RECOMMENDATION_PROFILE_BROWSER_DEADLINE_MS = 5_000
