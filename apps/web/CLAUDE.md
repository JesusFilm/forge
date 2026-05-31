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
- Data fetching: RSC async components calling resolvers in `src/lib/content.ts` / `search.ts` / `recommendations.ts` / `demo-search.ts`, which use `adminGraphql()` from `@forge/admin-graphql` + the singleton Apollo client at `src/lib/admin-client.ts`.
- Client components that need data go through a `"use server"` action (e.g. `src/lib/search-actions.ts`) — admin's bearer is server-only and must never reach the browser bundle.
- Metadata: export `metadata` or `generateMetadata` from every page.

## Data layer

Web reads from admin via the typed `adminGraphql()` factory exported from `@forge/admin-graphql`. The package consumes admin's committed SDL (`apps/admin/schema.graphql`); SDL drift breaks codegen at the package level, not at the app level.

- `src/lib/admin-client.ts` — singleton Apollo client pointed at `env.ADMIN_GRAPHQL_URL` with `Authorization: Bearer ${env.WEB_ADMIN_API_KEYS.split(",")[0]}`. 15 s timeout (temporary headroom for admin's slow `videoBySlug` resolver on COLLECTION rows; see the comment in `admin-client.ts`).
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
- ISR cache: `unstable_cache` wrappers in `src/lib/content.ts` use `revalidate: 60`. `revalidatePath` from `/api/revalidate` does NOT invalidate `unstable_cache` entries — tag-based invalidation is a known follow-up. Today the worst-case staleness is 60 s after a publish.
- 15 orphaned Strapi block fragment files remain at `src/lib/fragments/*` because section components in `src/components/sections/*.tsx` still derive prop types via `FragmentOf<typeof strapiFragment>`. Runtime data is admin-shape via the renderer's `as unknown as` cast bridge. Migrating section components to admin fragment imports is a clean follow-up bundle.
- **Static locale root layout**: cacheable watch surfaces live under the internal route tree `src/app/[locale]/[htmlLang]/**`. `src/proxy.ts` rewrites public `/watch` URLs into that tree, so the root layout gets static params for both the next-intl message catalog key (`[locale]`) and `<html lang>` (`[htmlLang]`) without calling `headers()` or `cookies()`. Keep request-time dynamic APIs out of this tree unless the route is intentionally dynamic.

## i18n

Locale propagation flow: public URL (`/watch/{slug}.html/{raw-audio-slug}.html`) → `src/proxy.ts` canonicalizes, derives `resolveWatchLocaleIdentity(raw-audio-slug)`, and internally rewrites to `/{messageLocale}/{htmlLang}/{original-public-path}` → `src/app/[locale]/[htmlLang]/layout.tsx` calls `setRequestLocale(params.locale)` and renders `<html lang={params.htmlLang}>`. The raw audio slug stays in `params.rest` for dub selection. The URL is the sole public locale carrier — no cookie and no visible `/[locale]` URL prefix.

Public watch links must always use the raw audio language slug, never the message-catalog key. Any button, card, carousel, modal, or component that emits a `/watch` href should pass `variant.language.slug`, `languageSlug`, or `currentLanguageSlug` into the route builders in `src/lib/routes.ts`. For English, the public URL is `/watch/{slug}.html/english.html`; `/watch/{slug}.html/en.html` is an internal-locale leak and should be treated as a bug.

Adding a UI locale: drop `messages/{locale}.json`, then run `pnpm --filter @forge/web generate:ui-locales` or any build/test script that runs it. The generated edge-safe catalog module drives middleware, route helpers, and next-intl catalog membership without a manual TypeScript whitelist. The drift gate in `src/i18n/__tests__/messages-parity.test.ts` fails CI if the generated list and filesystem catalogs disagree. The structural-parity test also enforces every namespace key exists in every catalog.

Critical: `src/i18n/generated-ui-locales.ts` is the only catalog list safe to import from middleware, route helpers, and client-reachable modules. Do NOT copy filesystem discovery into request-path modules (filesystem I/O in the request path is a regression), and do NOT import `src/i18n/locales.ts` into middleware or client-safe helpers because it is a server-only re-export for next-intl request configuration. Keep the internal `[locale]` segment bounded to generated message catalogs; use `[htmlLang]` only for the static HTML language tag.

See `docs/plans/2026-05-28-001-feat-i18n-migration-next-intl-plan.md`.

## Feature flags

LaunchDarkly server-side feature flag evaluation is available through
`src/lib/feature-flags.ts`, backed by the shared `@forge/feature-flags`
package. `LAUNCHDARKLY_SDK_KEY` is optional; when it is absent, helpers fall
back to `FORGE_*_DEFAULT` env vars and then to the existing local defaults.
Never expose the LaunchDarkly server-side SDK key to client components or
`NEXT_PUBLIC_*` env vars. Add new LaunchDarkly flag keys to
`packages/feature-flags/src/registry.ts` before using them in an app.

Two composable `NEXT_PUBLIC_*` toggles control the watch player surface:

- `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` (default `false`) — selects the
  player backend for the inline section components (`VideoHero`, `Video`,
  `CarouselVideo`). `false` keeps the video.js path via
  `useVideoPlayerCore`; `true` renders `<MuxVideo>` from
  `@forge/video-player`. Sunset gate for the video.js drop (R19).
- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` (default `false`) — selects the
  player backend for the watch-page hero (`HeroPlayer`). `false` keeps the
  existing `<MuxPlayer>` path (full `@mux/mux-player-react` chrome bundle,
  including `cast_sender.js`); `true` renders `<MuxVideo>` (smaller, no
  cast, light-DOM poster discoverable as the LCP element). The two
  backends are dynamic-imported through subpath specifiers
  (`@forge/video-player/mux-player` vs `/mux-video`) and the inactive
  branch is build-time DCE'd via `process.env.NEXT_PUBLIC_*` substitution,
  so exactly one ships per build. See
  `docs/plans/2026-05-26-005-refactor-watch-hero-muxplayer-to-muxvideo-beta-plan.md`.

Both flags are per-environment / per-build — set via Railway env vars and
baked at `next build` time. They do NOT support per-request override.
LaunchDarkly runtime evaluation does not replace these build-time branches yet
because the inactive player implementation is intentionally dead-code
eliminated by `process.env.NEXT_PUBLIC_*` substitution.

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

`forge.watch.questionPanel` is a temporary LaunchDarkly-backed release flag
for the watch-page floating question panel. `false` hides the panel;
`true` renders the floating input and message-type selector. Keep
`FORGE_WATCH_QUESTION_PANEL_DEFAULT=false` in local and Railway envs unless
intentionally testing the panel.

See root `CLAUDE.md` for cross-app patterns and the broader data-layer-flip plan reference.
