# apps/web — Next.js App

## Stack

- Next.js 16+ App Router (`next@^16.1.6`)
- React Server Components (default)
- `@forge/admin-graphql` for all data fetching (admin's GraphQL surface)
- Tailwind CSS

## Conventions

- Route groups for layout boundaries: `(marketing)`, `(app)`, `(auth)`.
- Loading states: always add `loading.tsx` for async routes.
- Error boundaries: `error.tsx` at each route segment.
- Data fetching: RSC async components calling resolvers in `src/lib/content.ts` / `recommendations.ts` / `demo-search.ts`, which use `adminGraphql()` from `@forge/admin-graphql` + the default Apollo client at `src/lib/admin-client.ts`. `src/lib/search.ts` uses the semantic-search Admin client from the same module so production semantic search gets a longer bounded timeout without widening every Admin GraphQL call.
- Client components that need data go through a `"use server"` action (e.g. `src/lib/search-actions.ts`) — admin's bearer is server-only and must never reach the browser bundle.
- Metadata: export `metadata` or `generateMetadata` from every page.
- Watch video and episode metadata must not emit page-head hreflang alternates.
  Canonical, Open Graph, Twitter, robots, and JSON-LD stay in page metadata;
  localized Watch hreflang belongs to sitemap XML only.

## Data layer

Web reads from admin via the typed `adminGraphql()` factory exported from `@forge/admin-graphql`. The package consumes admin's committed SDL (`apps/admin/schema.graphql`); SDL drift breaks codegen at the package level, not at the app level.

- `src/lib/admin-client.ts` — lazy Apollo clients pointed at `env.ADMIN_GRAPHQL_URL` with `Authorization: Bearer ${env.WEB_ADMIN_API_KEYS.split(",")[0]}`. The default export keeps the 15 s timeout for general Admin GraphQL calls; `semanticSearchAdminClient` uses a 45 s bounded timeout for `src/lib/search.ts` only.
- `src/lib/content.ts` — `resolveWatchPage`, `resolveWatchVideo*`, `resolveSeriesBySlug`, plus the 6 synthetic-watch-block builders. Returns admin shapes flattened via `normalizeAdminVideo`.
- `src/lib/fragments/watch-experience.ts` — re-exports `adminWatchExperienceFragment` from `@forge/admin-graphql/fragments` (the root composition over admin's 17 block fragments).
- `src/lib/fragments/watch-video.ts` — local `WatchVideo` fragment + the two query operations on admin's `Video` with field aliases bridging vocab (`documentId: id`, `variants: dubs`, `value: text`).
- `src/lib/{search,recommendations,demo-search,enrichment,experience-metadata}.ts` — all read from admin.

Required env vars (both flipped from `.optional()` in U13):

- `ADMIN_GRAPHQL_URL` — admin's GraphQL endpoint. Host-allowlist rejects `auth.jesusfilm.org` (PR #909 trap).
- `WEB_ADMIN_API_KEYS` — single key or CSV; web reads the first entry as the outbound bearer so traffic identifies as `consumer:<key>` at admin's rate limiter.

`REVALIDATION_SECRET` remains required for the `/api/revalidate` route. `STRAPI_PREVIEW_SECRET` remains required for the `/api/preview` Next draft-mode entry token (Strapi-era surface that hasn't migrated yet; out of data-layer scope).

## Common Pitfalls

- Don't import server-only code in client components.
- `'use client'` is a boundary — everything imported below it is also client.
- The admin bearer (`WEB_ADMIN_API_KEYS`) is in the server-only env block. Never reference it from a client component or `NEXT_PUBLIC_*` var.
- For browser-initiated data calls, write a `"use server"` action that wraps the resolver — see `src/lib/search-actions.ts`. The browser hits the action; the action hits admin with the bearer.
- ISR cache: static watch routes under `src/app/[locale]/[htmlLang]/**` use route-level `revalidate = 3600`. Watch resolver `unstable_cache` wrappers in `src/lib/content.ts` / `src/lib/watch-home.ts` keep short data TTLs (`60` seconds, except child dub languages at `1h`) and attach coarse tags from `src/lib/watch-cache-tags.ts`. `/api/revalidate` must invalidate both layers: `revalidatePath` for route output and `revalidateTag(tag, { expire: 0 })` for resolver data so webhook-triggered renders do not serve stale Data Cache first. The 1 hour route TTL is the fallback for a missed webhook or process-local invalidation miss; do not raise resolver TTLs until production cache topology and webhook reliability are proven.
- 15 orphaned Strapi block fragment files remain at `src/lib/fragments/*` because section components in `src/components/sections/*.tsx` still derive prop types via `FragmentOf<typeof strapiFragment>`. Runtime data is admin-shape via the renderer's `as unknown as` cast bridge. Migrating section components to admin fragment imports is a clean follow-up bundle.
- **Static locale root layout**: cacheable watch surfaces live under the internal route tree `src/app/[locale]/[htmlLang]/**`. `src/proxy.ts` rewrites public `/watch` URLs into that tree, so the root layout gets static params for both the next-intl message catalog key (`[locale]`) and `<html lang>` (`[htmlLang]`) without calling `headers()` or `cookies()`. Keep request-time dynamic APIs out of this tree unless the route is intentionally dynamic.

## i18n

Locale propagation flow: public URL (`/watch/{slug}.html/{raw-audio-slug}.html`) → `src/proxy.ts` canonicalizes, derives `resolveWatchLocaleIdentity(raw-audio-slug)`, and internally rewrites to `/{messageLocale}/{htmlLang}/{original-public-path}` → `src/app/[locale]/[htmlLang]/layout.tsx` calls `setRequestLocale(params.locale)` and renders `<html lang={params.htmlLang}>`. The raw audio slug stays in `params.rest` for dub selection. The URL is the sole public locale carrier — no cookie and no visible `/[locale]` URL prefix.

Public watch links must always use the raw audio language slug, never the message-catalog key. Any button, card, carousel, modal, or component that emits a `/watch` href should pass `variant.language.slug`, `languageSlug`, or `currentLanguageSlug` into the route builders in `src/lib/routes.ts`. For English, the public URL is `/watch/{slug}.html/english.html`; `/watch/{slug}.html/en.html` is an internal-locale leak and should be treated as a bug.

Watch chapter/sibling carousel links should keep `next/link` and the public
audio-language href, but normal left-clicks may optimistically make the clicked
card the visual current item while the next route resolves. Preserve modified
click browser behavior, keep pending state scoped to the source video/language,
and derive the visual active card from that pending payload so it self-invalidates
when the route commits. See
`docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`.

Adding a UI locale: drop `messages/{locale}.json`, then run `pnpm --filter @forge/web generate:ui-locales` or any build/test script that runs it. The generated edge-safe catalog module drives middleware, route helpers, and next-intl catalog membership without a manual TypeScript whitelist. CI runs `check:ui-locales` during lint before build/test scripts can regenerate the file, and the drift gate in `src/i18n/__tests__/messages-parity.test.ts` verifies the generated list matches filesystem catalogs. The structural-parity test also enforces every namespace key exists in every catalog.

Critical: `src/i18n/generated-ui-locales.ts` is the only catalog list safe to import from middleware, route helpers, and client-reachable modules. Do NOT copy filesystem discovery into request-path modules (filesystem I/O in the request path is a regression), and do NOT import `src/i18n/locales.ts` into middleware or client-safe helpers because it is a server-only re-export for next-intl request configuration. Keep the internal `[locale]` segment bounded to generated message catalogs; use `[htmlLang]` only for the static HTML language tag.

## Watch cache invalidation

Admin sends semantic revalidation webhooks to `src/app/api/revalidate/route.ts`.
The receiver maps each semantic model to both paths and Data Cache tags:

- `watch-setting` invalidates home/settings/experience/video/series/child-dub tags plus the watch layouts and homepage paths.
- `experience` invalidates experience/home tags plus the current slug matrix.
- `video` invalidates video/series/child-dub/home tags; slug-less payloads are valid broad invalidations for Core sync and revalidate the watch layouts.
- `watch-route-manifest` clears the receiving process's in-memory manifest cache, invalidates the route-manifest tag, and revalidates the watch layouts.
- `watch-seo-manifest` clears the receiving process's in-memory SEO manifest cache, invalidates the SEO manifest tag, and revalidates the sitemap index plus child sitemap routes.

The route manifest cache in `src/lib/watch-route-manifest.ts` is process-local. The webhook clears only the process that receives it; other web instances rely on the 60 second manifest TTL unless production uses shared cache storage or all-instance webhook fan-out.

The SEO sitemap manifest cache in `src/lib/watch-seo-manifest.ts` follows the
same process-local pattern. Sitemap routes read the cached snapshot and return
a controlled 503 when no valid snapshot is available; Watch page metadata does
not depend on this manifest and continues to render without page-head hreflang.

Production proof on 2026-06-10 showed `@forge/web` online in Railway US West behind Cloudflare, live watch HTML served with `cf-cache-status: DYNAMIC`, and authorized `experience`, broad `video`, and `watch-route-manifest` webhooks returning healthy first post-webhook renders. The Railway CLI path available here did not expose exact web replica count.

See `docs/plans/2026-06-10-001-fix-watch-cache-invalidation-plan.md`.

## Datadog observability

`src/instrumentation.ts` configures `dd-trace` for the Node runtime and enables
Datadog's built-in `graphql` plugin with source and variables disabled. Keep
query source, variables, bearer keys, cookies, IPs, slugs, and user identifiers
out of trace tags.

`src/observability/datadog-logs.ts` forwards server console logs to the shared
Datadog Agent over syslog UDP when `DD_AGENT_HOST` is configured. Railway still
receives normal stdout. Forwarded logs include service/env/version plus active
trace/span ids when a span is active.

Production Web Railway config lives in `apps/web/railway.toml` once the
service's Config-as-code Path is set to that file. For server APM, production
must set Datadog service env (`DD_SERVICE=forge-web`, `DD_ENV=prod`,
`DD_VERSION=<git sha>`), point at the private Datadog Agent
(`DD_AGENT_HOST`, `DD_TRACE_AGENT_PORT=8126`, `DD_AGENT_SYSLOG_PORT=514`), and
load the tracer before application modules through the `startCommand`:
`cd apps/web && NODE_OPTIONS='--require ./node_modules/dd-trace/init' pnpm start`.
Do not set `NODE_OPTIONS` as a global Railway service variable because service
variables are also present during Railpack setup before dependencies are
installed.

## Feature flags

LaunchDarkly server-side feature flag evaluation is available through
`src/lib/feature-flags.ts`, backed by the shared `@forge/feature-flags`
package. `LAUNCHDARKLY_SDK_KEY` is optional; when it is absent, helpers fall
back to `FORGE_*_DEFAULT` env vars and then to the existing local defaults.
Never expose the LaunchDarkly server-side SDK key to client components or
`NEXT_PUBLIC_*` env vars. Add new LaunchDarkly flag keys to
`packages/feature-flags/src/registry.ts` before using them in an app.

One `NEXT_PUBLIC_*` toggle still controls the inline watch player surface:

- `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` (default `false`) — selects the
  player backend for the inline section components (`VideoHero`, `Video`,
  `CarouselVideo`). `false` keeps the video.js path via
  `useVideoPlayerCore`; `true` renders `<MuxVideo>` from
  `@forge/video-player`. Sunset gate for the video.js drop (R19).

The watch-page hero (`HeroPlayer`) always renders the optimized `<MuxVideo>`
backend from `@forge/video-player/mux-video` after poster-first activation.
Do not reintroduce a MuxPlayer hero fallback or a
`NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` build flag; that rollout graduated in
the non-Cloudflare performance hardening work.

The remaining inline player flag is per-environment / per-build — set via
Railway env vars and baked at `next build` time. It does NOT support
per-request override. LaunchDarkly runtime evaluation does not replace this
build-time branch yet because the inactive inline player implementation is
intentionally dead-code eliminated by `process.env.NEXT_PUBLIC_*`
substitution.

`forge.watch.ctaTextCopy` is a temporary LaunchDarkly-backed production smoke
flag for the watch-page Download CTA copy. `false` keeps `Download`; `true`
renders `Save Video`. Keep `FORGE_WATCH_CTA_TEXT_COPY_DEFAULT=false` in local
and Railway envs unless intentionally testing the fallback path.

`forge.watch.youVersionBibleQuotes` is a temporary LaunchDarkly-backed rollout
flag for the server-rendered YouVersion passage panel below the watch-page
Bible Quotes carousel. `false` preserves the existing carousel-only behavior
and skips YouVersion API calls; `true` enables the server fetch when
`YOUVERSION_APP_KEY` is configured. Keep
`FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT=false` unless intentionally
smoke-testing the panel locally.

`forge.watch.hideBibleQuotes` is a temporary LaunchDarkly-backed release flag
for hiding the full watch-page Bible Quotes band. `false` keeps the existing
band, including quote cards, promo card, and section-local Share button;
`true` hides that band on synthetic watch pages. Keep
`FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT=false` unless intentionally testing the
hidden state locally.

`forge.watch.questionPanel` is a temporary LaunchDarkly-backed release flag
for the watch-page floating question panel. `false` hides the panel;
`true` renders the floating input and message-type selector. Keep
`FORGE_WATCH_QUESTION_PANEL_DEFAULT=false` in local and Railway envs unless
intentionally testing the panel.

See root `CLAUDE.md` for cross-app patterns and the broader data-layer-flip plan reference.
