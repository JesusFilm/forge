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

See root `CLAUDE.md` for cross-app patterns and the broader data-layer-flip plan reference.
