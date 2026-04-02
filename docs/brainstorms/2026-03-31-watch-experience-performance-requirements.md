---
date: 2026-03-31
topic: watch-experience-performance
---

# Watch Experience Page Performance

## Problem Frame

All `/watch/*` experience pages (including `/watch/easter`) load slowly because every visitor triggers a fresh GraphQL round-trip to Strapi, despite an on-demand revalidation webhook already existing. The root cause is `fetchPolicy: "no-cache"` on the Apollo query, which opts the underlying `fetch` out of Next.js's data cache — making the webhook-based revalidation pointless. Additionally, there are no `loading.tsx` files, so users see a blank page until the full server render completes.

## Requirements

- R1. **Fix data caching**: Remove `fetchPolicy: "no-cache"` from the `GET_WATCH_EXPERIENCE` Apollo query so Next.js's built-in fetch cache stores the GraphQL response. The existing `revalidatePath()` webhook at `/api/revalidate` will control cache invalidation on publish.
- R2. **Add time-based revalidation safety net**: Set `revalidate = 60` (or similar short interval) on experience pages as a fallback in case a Strapi webhook is missed or fails. This ensures pages are never stale for more than ~60 seconds even if the webhook infrastructure has issues.
- R3. **Add content-aware loading skeletons**: Add `loading.tsx` files to the `[slug]` and root page routes that render a skeleton mimicking the general page layout (hero area + content block placeholders). This gives users immediate visual feedback while the server render streams in.
- R4. **Apply consistently across all experience routes**: The caching fix and loading skeletons must apply to all experience page routes: `/` (homepage), `/[slug]`, and `/[slug]/[locale]`.

## Success Criteria

- Repeat visits to `/watch/easter` serve a cached page (no Strapi round-trip) until content is published or the revalidation interval expires
- First paint shows a skeleton within ~200ms instead of a blank page
- Publishing content in Strapi still triggers near-instant page updates via the existing webhook
- No regression in content freshness — pages update within 60s even if webhook fails

## Scope Boundaries

- **Not in scope**: Splitting the monolithic GraphQL query or adding Suspense boundaries for progressive streaming (future improvement)
- **Not in scope**: Cloudflare edge caching or CDN-level Cache-Control headers
- **Not in scope**: Changes to the Strapi CMS or webhook configuration
- **Not in scope**: Apollo client-side caching strategy (only affects server-side fetch behavior)

## Key Decisions

- **Remove `no-cache` rather than switching to a different Apollo fetch policy**: The goal is to let Next.js control caching via its fetch cache + `revalidatePath()`. Apollo's cache layer is secondary on the server.
- **60-second revalidation as safety net**: Short enough to catch webhook failures quickly, long enough to avoid unnecessary Strapi load.
- **Content-aware skeleton over minimal spinner**: Better perceived performance is worth the small maintenance cost given these are high-traffic pages.

## Dependencies / Assumptions

- The existing `/api/revalidate` webhook is correctly configured in Strapi and fires on experience publish events
- Apollo's `HttpLink` respects Next.js fetch caching when `fetchPolicy` is not set to `no-cache`

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Verify that removing `fetchPolicy: "no-cache"` from Apollo correctly allows Next.js fetch caching — may need to explicitly set `fetchOptions: { cache: 'force-cache' }` or use `next: { revalidate }` on the fetch
- [Affects R3][Technical] Determine the right skeleton layout — inspect the most common block patterns on experience pages to design a representative skeleton
- [Affects R2][Technical] Confirm whether `revalidate = 60` on the page conflicts with or complements the webhook-based `revalidatePath()` calls

## Next Steps

-> `/ce:plan` for structured implementation planning
