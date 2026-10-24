// Browser-safe consent signal names. Kept apart from `recommendation-consent.ts`
// because that module imports `node:crypto` for its cookie helpers, and one
// client import of it made Turbopack ship the crypto-browserify polyfill
// (~450 KB decoded) on every Watch route (feat-779). Values are shared with
// already-open tabs through the BroadcastChannel; keep them byte-identical.
export const RECOMMENDATION_CONSENT_CHANGED_EVENT =
  "forge:recommendation-consent-changed" as const
export const RECOMMENDATION_CONSENT_CHANNEL =
  "forge-recommendation-consent-v1" as const
export const RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT =
  "forge:recommendation-cookie-settings-open" as const
