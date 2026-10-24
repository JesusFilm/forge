---
title: "Admin-Owned Watch Route Manifest"
date: "2026-05-30"
category: "architecture-patterns"
module: "apps/admin watch routing"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
applies_when:
  - "A public route needs cheap admission checks before expensive content lookup or ISR cache work"
  - "Admin owns the canonical route data, but a consumer app needs a compact read contract"
  - "The full route space would explode if content-language permutations were materialized"
  - "Route metadata can be refreshed from publish, archive, or sync events instead of generated on request"
related_components:
  - "database"
  - "authentication"
  - "development_workflow"
  - "testing_framework"
tags:
  - "admin"
  - "watch-route"
  - "route-manifest"
  - "route-admission"
  - "consumer-bearer"
  - "jsonb-snapshot"
  - "revalidation"
  - "operator-smoke"
---

# Admin-Owned Watch Route Manifest

## Context

Forge needed a bounded admission gate for public `/watch` routes before the web app moved deeper into static route rewrites. Prior static-route work showed that random or hostile paths could otherwise create expensive admin lookups, ISR/notFound cache entries, and revalidation noise before the page renderer had enough information to reject them (session history).

The route truth already lives in `apps/admin`: videos, dubs, languages, parent-child relations, and `Experience` publish/archive lifecycle all flow through admin. The reusable pattern is to let admin generate and serve a compact manifest of possible watch routes, then let consumers use that manifest as an admission contract instead of rediscovering route possibility on every request.

## Guidance

Use an admin-owned manifest when route validity depends on admin state but admission needs to be cheap in a consumer app.

Keep the manifest as bounded sets, not URL records:

```ts
type WatchRouteManifest = {
  version: string
  generatedAt: string
  contentSlugs: string[]
  oneSegmentSlugs: string[]
  episodePairsByParent: Record<string, string[]>
  audioLanguageSlugs: string[]
}
```

The implementation shape that worked:

- Generate deterministic admission data in `apps/admin/src/services/watch-route-manifest.service.ts`.
- Filter to public/playable candidates from canonical admin tables: published locales, non-deleted videos/languages, published HLS dubs, and non-archived non-template experiences.
- Version the manifest with a stable content hash that excludes `generatedAt`, so consumers can use cache validators without churn from generation time alone.
- Persist the latest snapshot in a singleton Postgres JSONB table through `WatchRouteManifestSnapshot`.
- Serve the latest snapshot from `GET /api/watch-route-manifest`; do not generate the manifest in the request path.
- Require the existing consumer bearer from `WEB_ADMIN_API_KEYS`, return `401` for missing or invalid auth, and return `503` when no snapshot exists yet.
- Support `ETag` / `If-None-Match` so consumers can receive `304` without paying payload transfer.
- Refresh after route-relevant Core sync phases (`languages`, `videos`, `video-dubs`) and after `Experience` publish, update, or archive mutations.
- Treat refresh and downstream web revalidation as best effort: log or return failed refresh outcomes instead of throwing through editorial or sync flows.
- Provide an operator script for explicit regeneration after migrations, imports, or sync repairs.

The manifest should stay an admission contract. It should not include rendering payloads, localized route permutations, full video metadata, or any data that makes the API a replacement for the page resolver.

## Why This Matters

Without a compact admission contract, each impossible `/watch` path can fan out into the slowest parts of the system: admin lookups, high-cardinality cache keys, broad revalidation work, and repeated misses from crawlers or malicious path exploration.

Centralizing admission data in admin keeps the producer/consumer boundary clean:

- Admin remains the source of truth for published watch availability.
- Web can reject impossible paths before deeper content fetching.
- Snapshot reads avoid request-time aggregate recomputation.
- Conditional requests make the manifest cheap to poll or reuse.
- Operators have one deterministic regeneration path when source data changes outside normal publish flows.

The compact shape also avoids the mistake of materializing every content-by-language route. Prior catalog sizing already showed enough video and dub volume that full permutation storage would be the wrong abstraction (session history).

## When to Apply

- A public route surface needs fast negative admission before expensive rendering or API calls.
- Route possibility is derived from producer-owned data in another app or service.
- The valid route space can be represented as compact sets or parent-child relations.
- Refresh events are known, such as publish/archive hooks or sync phases.
- The consumer can authenticate as a known internal caller.
- Stale admission data is safer than request-time recomputation, and an operator can regenerate snapshots.

Avoid this pattern when route validity is personalized, too volatile to snapshot, or so large that a manifest becomes a hidden data export. In those cases, use a narrower admission endpoint or a consumer-local index.

## Examples

The read contract should preserve this behavior:

```text
GET /api/watch-route-manifest without bearer token -> 401
GET /api/watch-route-manifest with a valid WEB_ADMIN_API_KEYS bearer -> 200
GET /api/watch-route-manifest with matching If-None-Match -> 304
GET /api/watch-route-manifest before the first snapshot exists -> 503
```

Operator regeneration should use the package script in a configured admin checkout:

```bash
pnpm --filter @forge/admin watch-route-manifest:generate
```

In a fresh or isolated smoke environment, that package script can fail if `apps/admin/.env` is absent because it invokes `tsx --env-file=.env`. For one-off smoke tests, run the script target directly with explicit environment variables and then verify the endpoint against the isolated database.

The runtime smoke that proved the pattern should remain the bar for similar changes:

```text
1. Apply the manifest migration against an isolated database.
2. Seed route-relevant videos, dubs, languages, parent-child links, and experiences.
3. Generate the manifest and confirm a WatchRouteManifestSnapshot row exists.
4. Start admin with WEB_ADMIN_API_KEYS set.
5. Confirm unauthenticated endpoint access returns 401.
6. Confirm authenticated access returns 200 with the expected compact sets.
7. Confirm conditional access returns 304 for a matching ETag.
```

## Related

- `docs/plans/2026-05-29-002-feat-watch-route-manifest-admin-plan.md`
- `docs/roadmap/platform/feat-149-watch-route-manifest-admin.md`
- `apps/admin/src/services/watch-route-manifest.service.ts`
- `apps/admin/src/services/watch-route-manifest-store.ts`
- `apps/admin/src/services/watch-route-manifest-refresh.service.ts`
- `apps/admin/src/app/api/watch-route-manifest/route.ts`
- `apps/admin/src/scripts/generate-watch-route-manifest.ts`
- `apps/admin/prisma/migrations/0025_watch_route_manifest_snapshot/migration.sql`
- `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`
- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md`
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`
