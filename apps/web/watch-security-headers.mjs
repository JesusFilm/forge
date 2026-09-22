// Baseline security headers for every /watch response.
//
// These used to live in `src/proxy.ts`'s `applyWatchSecurityHeaders`, which is
// only reachable from the two rewrite call sites inside `proxy()`. The exact
// basePath root (`/watch`) never takes that path, so it shipped with no CSP
// and no Referrer-Policy at all (Linear FGE-235 / audit W-099). `headers()` in
// next.config.mjs is evaluated by the routing layer for every request,
// including the root, so it is the only placement that covers the whole app.
//
// Consumed by next.config.mjs. Keep this file dependency-free: it is imported
// from an `.mjs` config that runs before the app's module graph exists, the
// same constraint `watch-base-path.mjs` carries.

/**
 * Capabilities denied outright. `fullscreen`, `autoplay`, `picture-in-picture`
 * and `encrypted-media` are deliberately ABSENT: the Watch hero player calls
 * `requestFullscreen` (HeroPlayerControls.tsx) and autoplays muted, and an
 * omitted directive keeps the permissive browser default. Listing them as
 * `()` would break playback with no console error on the server side.
 */
const DENIED_BROWSER_FEATURES = [
  "accelerometer",
  "browsing-topics",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "idle-detection",
  "interest-cohort",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "serial",
  "usb",
]

/**
 * Google Analytics and Datadog RUM are required to keep working on configured
 * deployments (docs/analytics-and-recommendation-policy.md). They are listed
 * explicitly so the report-only policy does not become an outage the day it is
 * enforced.
 */
const ANALYTICS_SCRIPT_HOSTS = [
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://*.datadoghq-browser-agent.com",
]

const ANALYTICS_CONNECT_HOSTS = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
  "https://*.browser-intake-datadoghq.com",
  "https://*.datadoghq.com",
]

/** Mux delivers the hero video, its thumbnails and its playback telemetry. */
const MEDIA_HOSTS = [
  "https://image.mux.com",
  "https://stream.mux.com",
  "https://*.litix.io",
]

function originOf(rawUrl) {
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

/**
 * The full policy we intend to enforce later. Shipped REPORT-ONLY first so the
 * reports tell us what a real enforcement would have broken; the enforcement
 * point follows rollback capability, never the same deploy that introduces the
 * policy.
 *
 * `'unsafe-inline'` / `'unsafe-eval'` in `script-src` are load-bearing today:
 * the App Router emits inline bootstrap and flight-data scripts, and a nonce
 * would force every route dynamic, which this app's ISR caching depends on.
 */
export function buildWatchContentSecurityPolicy({ adminGraphqlUrl } = {}) {
  const adminOrigin = originOf(adminGraphqlUrl)

  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'self'"],
    "form-action": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      ...ANALYTICS_SCRIPT_HOSTS,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Editors author arbitrary image URLs, and the optimizer is separately
    // constrained by images.remotePatterns, which is the real allowlist.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:", "https://stream.mux.com"],
    "worker-src": ["'self'", "blob:"],
    // QuizButton renders an editor-authored iframe src, so this cannot be
    // enumerated to a fixed host list without breaking authored content.
    "frame-src": ["'self'", "https:"],
    "connect-src": [
      "'self'",
      ...MEDIA_HOSTS,
      ...ANALYTICS_CONNECT_HOSTS,
      ...(adminOrigin ? [adminOrigin] : []),
    ],
    "upgrade-insecure-requests": [],
  }

  return Object.entries(directives)
    .map(([name, values]) =>
      values.length > 0 ? `${name} ${values.join(" ")}` : name,
    )
    .join("; ")
}

/**
 * The clickjacking policy `proxy.ts` already enforced on rewrite paths. It
 * stays enforced and simply widens to every route; the richer policy above
 * rides alongside it as report-only until it is deliberately promoted.
 */
export const WATCH_ENFORCED_CSP = "frame-ancestors 'self'"

export function buildWatchSecurityHeaders({
  adminGraphqlUrl,
  enforceContentSecurityPolicy = false,
} = {}) {
  const policy = buildWatchContentSecurityPolicy({ adminGraphqlUrl })

  return [
    {
      // Two years, subdomains included. Sending the header does NOT enrol the
      // domain in the browser preload list; that is a separate, deliberate
      // submission at hstspreload.org.
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Same value proxy.ts sent on rewrite paths. This widens the coverage; it
    // does not change the policy.
    { key: "Referrer-Policy", value: "strict-origin" },
    {
      key: "Permissions-Policy",
      value: DENIED_BROWSER_FEATURES.map((feature) => `${feature}=()`).join(
        ", ",
      ),
    },
    // `-allow-popups` keeps `target="_blank"` links and any future OAuth popup
    // working while still isolating the browsing-context group.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    // `same-site` rather than `same-origin`: the WordPress half of
    // jesusfilm.org is a different origin on the same site and does embed
    // Watch assets.
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    ...(enforceContentSecurityPolicy
      ? // The full policy already carries `frame-ancestors 'self'`, so
        // promoting it replaces the narrow enforced header rather than
        // stacking a second one the browser would have to intersect.
        [{ key: "Content-Security-Policy", value: policy }]
      : [
          { key: "Content-Security-Policy", value: WATCH_ENFORCED_CSP },
          { key: "Content-Security-Policy-Report-Only", value: policy },
        ]),
  ]
}
