# Web Production Readiness

Status as of 2026-07-02: local code/build/start gates pass for `apps/web` when
the required Web env shape is present. Live-environment gates remain before
production launch: Railway config verification, production/preview URL parity,
authorized revalidation smoke, Datadog monitor/source-map evidence, and
YouVersion prod-like smoke if the Bible Quotes panel will be enabled.

## Scope

This runbook covers the `@forge/web` Railway service and the public Watch
surface under `/watch`.

It does not rotate secrets, enable Cloudflare HTML caching, or change the public
Watch URL contract. The dynamic collection JSON route has a separate optional
shared-edge gate below.

## Required Launch Evidence

| Gate                    | Evidence                                                                 | Status                                                                             |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Local tests             | `pnpm --filter @forge/web test`                                          | Passed 2026-07-02: 99 files, 1562 passed, 2 todo                                   |
| TypeScript              | `pnpm --filter @forge/web typecheck`                                     | Passed 2026-07-02                                                                  |
| Lint                    | `pnpm --filter @forge/web lint`                                          | Passed 2026-07-02                                                                  |
| Production build        | `pnpm --filter @forge/web build` with required local placeholder env     | Passed 2026-07-02                                                                  |
| Production start smoke  | `cd apps/web && pnpm start`, then `curl -I http://127.0.0.1:3000/watch`  | Passed 2026-07-02: `200 OK`, `x-nextjs-prerender: 1`, `Cache-Control: s-maxage=60` |
| Dynamic API scan        | Search cacheable app routes for `next/headers`, `headers()`, `cookies()` | Passed 2026-07-02 for cacheable pages; only `/api/preview` uses `draftMode()`      |
| JSON console scan       | Search Web source for JSON-shaped `console.log`, `warn`, and `error`     | Passed 2026-07-02: no matches                                                      |
| Working tree whitespace | `git diff --check`                                                       | Passed 2026-07-02                                                                  |

## Required Environment

These are always-on production requirements:

| Variable                       | Purpose                                              | Launch check                                                                                                    |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ADMIN_GRAPHQL_URL`            | Admin GraphQL endpoint for Web SSR/RSC data reads    | Present, points at admin GraphQL, not `auth.jesusfilm.org`; production should prefer Railway private networking |
| `WEB_ADMIN_API_KEYS`           | Consumer bearer used by Web when calling Admin       | Present; first CSV entry is accepted by Admin's `WEB_ADMIN_API_KEYS`                                            |
| `REVALIDATION_SECRET`          | Token for `/watch/api/revalidate`                    | Present; matches Admin's `WEB_REVALIDATE_TOKEN`                                                                 |
| `WEB_AUTH_BASE_URL`            | Auth service for server-side download account checks | Present or default intentionally accepted                                                                       |
| `NEXT_PUBLIC_CANONICAL_ORIGIN` | Public Watch origin and browser-write origin policy  | Set to the browser-visible production origin; `/watch/api/recommendations/profile` accepts that exact origin    |

Optional integrations must be either configured and smoked or intentionally
disabled/defaulted:

| Variable or flag                                                          | Default posture                                            | Launch check                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `LAUNCHDARKLY_SDK_KEY`                                                    | Optional; local defaults used when unset                   | Confirm production targeting for temporary Watch flags                             |
| `NEXT_PUBLIC_DATADOG_APPLICATION_ID` + `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN` | RUM disabled unless both are set                           | Confirm RUM initializes in production only when configured                         |
| `DD_AGENT_HOST`, `DD_SERVICE`, `DD_ENV`, `DD_VERSION`                     | Server APM/log forwarding enabled when agent is configured | Confirm service/env/version tags in Datadog                                        |
| `DATADOG_API_KEY`                                                         | Needed only for source-map upload                          | Use only during `pnpm --filter @forge/web datadog:sourcemaps`                      |
| Admin `YOUVERSION_APP_KEY`                                                | Optional Admin-only integration                            | Required before expecting `BibleCitation.passage` data in Web                      |
| Admin `YOUVERSION_PASSAGE_CACHE_TTL_SECONDS`                              | Defaults to `1209600`                                      | Confirm TTL is acceptable for provider/content update expectations                 |
| `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `ALGOLIA_INDEX`               | Optional server-only search path                           | If Algolia flag is enabled, confirm configured; otherwise verify graceful fallback |
| `OPENROUTER_API_KEY`                                                      | Optional demo-search generator                             | Confirm demo generator is intentionally enabled or gracefully unavailable          |
| `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_CACHE_PURGE_TOKEN`                     | Dynamic collection edge cache disabled unless both are set | Configure both or neither; token needs only cache-purge access to the named zone   |

Do not record secret values in this document. Record only presence, source, and
environment.

## Railway Gate

Before launch, verify the live `@forge/web` service:

1. Railway deployment metadata has `configFile` pointing at
   `apps/web/railway.toml`, or the dashboard override is documented as the
   canonical production config.
2. Effective build command matches the intended shape:
   `pnpm install --frozen-lockfile && pnpm --filter @forge/web build`.
3. Effective start command keeps Datadog tracer preload scoped to runtime:
   `cd apps/web && HOSTNAME=0.0.0.0 NODE_OPTIONS='--require ./node_modules/dd-trace/init' pnpm start`.
4. Healthcheck path is `/watch`, timeout is at least 60 seconds, and restart
   policy is `ON_FAILURE`.
5. Watch patterns include `apps/web`, shared packages consumed by Web, and root
   package/lock/workspace config.

Why this is a hard gate: a previous Railway incident showed that committed
per-service `railway.toml` can be silently ignored unless Config-as-code Path is
set. See
`docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`.

## Public URL Gate

Run preview-vs-production parity once a launch candidate is deployed:

```bash
pnpm --filter @forge/web probe:watch-urls \
  --production <production-origin> \
  --preview <preview-origin> \
  --json output/watch-url-parity.json
```

Expected result:

- Representative healthy Watch URLs preserve status class and final path.
- Expected 404s remain 404s.
- No redirect loops.
- Canonical and social metadata continue to use
  `https://www.jesusfilm.org/watch/...`.

Use this gate instead of a simple `200` crawl because SEO regressions can hide
in final-path or redirect behavior.

## Revalidation Gate

Against the launch candidate, send authorized payloads to
`/watch/api/revalidate` for:

- `watch-setting`
- `experience`
- `video` with a representative slug
- broad `video` without slug
- `watch-route-manifest`
- `watch-seo-manifest`

Expected result:

- Unauthorized payloads fail.
- Authorized payloads invalidate both route output and data-cache tags.
- The first post-webhook request renders fresh data or an expected controlled
  fallback.
- Admin publish/editor flows are not blocked by Web revalidation failures.
- With Cloudflare purge configured, `watch-setting`, `experience`, and `video`
  payloads purge the `watch-dynamic-collections` cache tag; a purge failure is
  logged but does not change the successful local invalidation response.

## Dynamic Collection Edge Cache Gate

Enable this only after the optional Cloudflare variables above are present:

1. With the Cloudflare rule disabled, load the live Watch homepage and capture
   its canonical dynamic-feed URL. Confirm it contains one server-issued
   `cacheSignature`, receives `Cache-Control: no-store`, and reuses one Redis
   Data Cache entry across separate Web requests or instances. Confirm an
   unsigned or altered URL succeeds without shared cache admission rather than
   creating another 24-hour Redis key.
2. Add a Cloudflare Cache Rule for the exact GET path
   `/watch/api/dynamic-collections`. Make it cache-eligible, respect the
   origin's `Cloudflare-CDN-Cache-Control`, and preserve the full query string
   in the cache key.
3. Confirm the canonical signed live `200` response carries Cloudflare
   freshness and the `watch-dynamic-collections` cache tag at the origin.
   Confirm unsigned, invalid-signature, reordered-query, alternate-encoding,
   explicit `scope=live`, `scope=preview`, `400`, `429`, and `503` responses
   expose no shared edge policy.
4. Request the same live URL twice and record `CF-Cache-Status: MISS` followed
   by `HIT`. Change one legitimate variant (locale, language, profile, cursor,
   or exclusions) and confirm it does not reuse the prior object.
5. Publish a representative video or homepage Experience. Confirm the
   authenticated revalidation returns success, the next feed request is no
   longer the pre-publish `HIT`, and the refreshed payload is current.
6. Record end-to-end revalidation latency below Admin's five-second webhook
   budget and verify the fixed purge-failure warning is visible to production
   operations. For rollback, disable the Cache Rule and purge
   `watch-dynamic-collections` before reverting Web code.

Do not use a rule that ignores the query string: those parameters are the
content identity, not user personalization. Do not rotate
`REVALIDATION_SECRET` independently: it also signs cache admission. If it must
rotate, invalidate Watch output and purge `watch-dynamic-collections` so newly
rendered pages immediately carry signatures from the new key.

## Observability Gate

Use `docs/operations/watch-datadog-availability-incidents.md` as the detailed
runbook for availability monitors. The launch check must confirm:

- Public Watch canaries are installed for the agreed production URLs.
- Server log monitor covers production Watch 5xx/timeout signals.
- Composite monitor requires both outside-in canary failure and corroborating
  server evidence.
- `service`, `env`, and `version` tags match the deployed Web service.
- Server logs avoid JSON-stringified console payloads; use production-visible
  plain-string breadcrumbs or the Datadog structured syslog sender.
- Browser source maps are uploaded for the deployed version when RUM is enabled:

```bash
pnpm --filter @forge/web datadog:sourcemaps
```

## Gated Integration Gate

Before relying on Admin-resolved `BibleCitation.passage` for production
traffic, complete `todos/006-pending-p1-youversion-app-key-smoke.md`.

Minimum evidence:

- `YOUVERSION_APP_KEY` exists in the target Admin environment only.
- The code-approved launch English BSB version is authorized for that key.
- The code-approved language slug/Core language id table in Admin covers launch
  languages that should use non-default versions.
- A live Admin GraphQL smoke for a video citation returns `passage { content
copyright humanReference reference versionId }`.
- The panel renders server-side passage text and attribution on desktop and
  mobile.
- Selecting another citation updates the panel.
- Selecting the promo slide hides the panel.
- Browser network does not expose `api.youversion.com` requests.
- No app key appears in browser JS, headers, logs, or screenshots.

Keep the flag off by default until this evidence exists.

## Known Current Blockers

- Live Railway config has not been verified from this workspace.
- Live Datadog monitor/source-map/RUM evidence has not been verified from this
  workspace.
- Production/preview URL parity has not been run because live origins were not
  provided in this session.
- YouVersion prod-like smoke remains pending if Bible Quotes panel launch is in
  scope.
