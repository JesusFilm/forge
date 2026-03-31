---
title: "fix: Enable route caching and loading skeletons for watch experience pages"
type: fix
status: completed
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-watch-experience-performance-requirements.md
---

# fix: Enable route caching and loading skeletons for watch experience pages

## Overview

All `/watch/*` experience pages render dynamically on every request because `getLocale()` calls `headers()`, which opts the route out of Next.js's Full Route Cache. This means the on-demand revalidation webhook (`/api/revalidate`) and `revalidate = false` setting are both ineffective — there's never a cached route to invalidate. The fix introduces locale-detecting middleware, removes `headers()` from page routes, and adds content-aware loading skeletons.

## Problem Frame

Every visitor to `/watch/easter` (or any experience page) triggers a fresh server render and GraphQL call to Strapi. The root cause chain:

1. `getLocale()` in `apps/web/src/lib/locale.ts` calls `headers()` to read Accept-Language
2. Any use of `headers()` in a route forces Next.js into dynamic rendering
3. Dynamic routes bypass the Full Route Cache entirely
4. `revalidate = false` and `revalidatePath()` only affect statically cached routes
5. Apollo's `fetchPolicy: "no-cache"` compounds the issue by also bypassing Apollo's in-memory cache

The existing revalidation architecture (webhook → `revalidatePath()`) is correctly built but can never work while routes are dynamically rendered.

(see origin: `docs/brainstorms/2026-03-31-watch-experience-performance-requirements.md`)

## Requirements Trace

- R1. **Fix data caching** — Enable Next.js Full Route Cache by removing `headers()` from page routes
- R2. **Add time-based revalidation safety net** — Set `revalidate = 60` as fallback alongside webhook-based invalidation
- R3. **Add content-aware loading skeletons** — `loading.tsx` files with hero + content block placeholders
- R4. **Apply consistently** — All experience routes: `/`, `/[slug]`, `/[slug]/[locale]`

## Scope Boundaries

- Not splitting the monolithic GraphQL query or adding Suspense boundaries
- Not adding Cloudflare edge caching or CDN Cache-Control headers
- Not changing Apollo client-side caching strategy
- Not changing Strapi CMS or webhook configuration
- Middleware only handles locale detection for experience routes under `/watch`

## Context & Research

### Relevant Code and Patterns

| File                                             | Role                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `apps/web/src/lib/locale.ts`                     | `getLocale()` with `headers()` — the root cause               |
| `apps/web/src/lib/content.ts`                    | `getWatchExperience()` with `fetchPolicy: "no-cache"`         |
| `apps/web/src/app/page.tsx`                      | Homepage route — calls `getLocale()`                          |
| `apps/web/src/app/[slug]/page.tsx`               | Slug route — calls `getLocale()`                              |
| `apps/web/src/app/[slug]/[locale]/page.tsx`      | Locale route — does NOT call `getLocale()`, already cacheable |
| `apps/web/src/app/api/revalidate/route.ts`       | Webhook — correctly built, currently ineffective              |
| `apps/web/src/components/sections/index.tsx`     | `ExperienceSectionRenderer` — skeleton must approximate this  |
| `apps/web/src/components/sections/VideoHero.tsx` | Most prominent section — skeleton priority                    |
| `apps/web/next.config.mjs`                       | `basePath: "/watch"`                                          |

### Institutional Learnings

- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — Documents that Apollo Client is incompatible with `"use cache"` directives. Route-level ISR with `revalidate = false` + `revalidatePath()` is the chosen pattern. This plan preserves that pattern while fixing the `headers()` issue that prevented it from working.
- `docs/solutions/graphql/server-side-strapi-queries-nextjs.md` — Documents `fetchPolicy: "no-cache"` rationale: Apollo's InMemoryCache is stale across requests on the server. This fetch policy remains correct — it ensures each render gets fresh Strapi data, while Next.js caches the full rendered route.

## Key Technical Decisions

- **Middleware for locale, not in page routes**: Move Accept-Language detection to Next.js middleware. Middleware runs at the edge before routing, so it can redirect non-English users to `/watch/easter/es` without the page needing `headers()`. English users stay at `/watch/easter` (no redirect).

- **Keep `fetchPolicy: "no-cache"` on Apollo**: The solution docs explicitly chose this because Apollo's InMemoryCache is stale across server requests. The fix is at the route caching level, not the Apollo level. Each render still hits Strapi fresh; Next.js caches the rendered output.

- **`revalidate = 60` as safety net alongside webhook**: Change from `false` to `60`. The webhook provides instant invalidation; the 60s fallback catches missed webhooks. This is compatible because `revalidatePath()` works on time-based ISR routes too.

- **Update webhook to also revalidate `revalidateTag`**: Add tag-based revalidation alongside path-based for more precise cache invalidation. Pass `next: { tags: [...] }` through Apollo's custom fetch.

## Open Questions

### Resolved During Planning

- **Will removing `headers()` from pages break locale detection?** No — middleware handles it before the request reaches the page. English users (the majority) get no redirect. Non-English users redirect once to the locale-explicit URL.

- **Does `revalidate = 60` conflict with `revalidatePath()`?** No — they complement each other. `revalidatePath()` immediately marks the route stale; `revalidate = 60` ensures staleness is bounded even if the webhook fails.

- **Should we pass a custom fetch to Apollo for Next.js cache integration?** No — the solution docs explicitly document that Apollo's fetch is opaque to Next.js. The correct layer for caching is the Full Route Cache, not the fetch cache. Keeping `fetchPolicy: "no-cache"` is intentional.

### Deferred to Implementation

- **Exact skeleton dimensions**: The skeleton should approximate VideoHero (full-viewport hero) + generic content blocks. Exact sizing will be determined by inspecting the most common experience page layouts.
- **Middleware matcher pattern**: Need to verify the correct `config.matcher` pattern given the `basePath: "/watch"` in next.config.mjs — middleware matchers may or may not account for basePath.

## Implementation Units

- [ ] **Unit 1: Add locale-detecting middleware**

  **Goal:** Move Accept-Language detection from page routes to middleware. Redirect non-English users to the locale-explicit URL; let English users pass through unchanged.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Create: `apps/web/src/middleware.ts`
  - Modify: `apps/web/src/lib/locale.ts` (export helper for middleware reuse)

  **Approach:**
  - Create middleware that reads Accept-Language header
  - If detected locale is not English and URL has no locale segment, redirect to `/{slug}/{locale}`
  - If English or locale already in URL, pass through with `NextResponse.next()`
  - Reuse `isLocale` and `SUPPORTED_LOCALES` from locale.ts
  - Configure `matcher` to only run on experience routes, excluding API routes, static assets, and `_next`
  - Middleware uses `headers()` — this is fine because middleware is edge-only and does not affect page route caching

  **Patterns to follow:**
  - `apps/web/src/lib/locale.ts` for Accept-Language parsing logic
  - Next.js middleware conventions for App Router

  **Test scenarios:**
  - English Accept-Language → no redirect, passes through to `/watch/easter`
  - Spanish Accept-Language → redirects `/watch/easter` to `/watch/easter/es`
  - Already has locale in URL (`/watch/easter/fr`) → no redirect
  - No Accept-Language header → no redirect (defaults to English)
  - Homepage `/watch` with French Accept-Language → redirects to `/watch/fr` (handled by existing `[slug]` route which treats known locales as homepage locale)
  - API routes and static assets → middleware does not run

  **Verification:**
  - Middleware correctly detects and redirects non-English users
  - English users see no redirect or URL change

- [ ] **Unit 2: Remove `headers()` from page routes**

  **Goal:** Stop calling `getLocale()` (which uses `headers()`) in page components and `generateMetadata`, enabling Full Route Cache.

  **Requirements:** R1, R4

  **Dependencies:** Unit 1 (middleware handles locale detection)

  **Files:**
  - Modify: `apps/web/src/app/page.tsx`
  - Modify: `apps/web/src/app/[slug]/page.tsx`

  **Approach:**
  - In `page.tsx` (homepage): replace `getLocale()` with `DEFAULT_LOCALE`. Middleware ensures non-English users are already redirected to a locale-specific URL before this page renders.
  - In `[slug]/page.tsx`: when slug is a known locale (e.g., `/watch/en`), use it as the locale. When slug is a content slug (e.g., `easter`), use `DEFAULT_LOCALE`. Remove the `getLocale()` import and call.
  - `[slug]/[locale]/page.tsx` already uses `DEFAULT_LOCALE` and does not call `headers()` — no changes needed.
  - Both `generateMetadata` and the page component in each file must stop using `getLocale()`.

  **Patterns to follow:**
  - `apps/web/src/app/[slug]/[locale]/page.tsx` — already uses `isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE` without `headers()`

  **Test scenarios:**
  - `/watch/easter` renders with English locale, no `headers()` call
  - `/watch/es` renders homepage in Spanish (slug is a locale)
  - `/watch` renders homepage in English
  - `generateMetadata` returns correct metadata without `headers()`

  **Verification:**
  - Pages render correctly with DEFAULT_LOCALE
  - Next.js build output shows routes as static/ISR (not dynamic)

- [ ] **Unit 3: Add time-based revalidation safety net**

  **Goal:** Change `revalidate` from `false` to `60` on all experience page routes as a fallback for missed webhooks.

  **Requirements:** R2, R4

  **Dependencies:** Unit 2 (routes must be statically cacheable first)

  **Files:**
  - Modify: `apps/web/src/app/page.tsx`
  - Modify: `apps/web/src/app/[slug]/page.tsx`
  - Modify: `apps/web/src/app/[slug]/[locale]/page.tsx`

  **Approach:**
  - Change `export const revalidate = false` to `export const revalidate = 60` in all three files
  - The existing `/api/revalidate` webhook continues to provide instant invalidation via `revalidatePath()`
  - The 60s fallback ensures pages are never stale for more than a minute even if a webhook is missed

  **Test scenarios:**
  - Page is cached after first request
  - After 60s, next request triggers background revalidation
  - `revalidatePath()` from webhook still works for instant invalidation

  **Verification:**
  - Repeat requests within 60s serve cached content (no Strapi hit)
  - After 60s, stale-while-revalidate behavior kicks in

- [ ] **Unit 4: Add content-aware loading skeletons**

  **Goal:** Add `loading.tsx` files so users see a skeleton UI immediately while the page streams in.

  **Requirements:** R3, R4

  **Dependencies:** None (independently valuable)

  **Files:**
  - Create: `apps/web/src/app/loading.tsx`
  - Create: `apps/web/src/app/[slug]/loading.tsx`
  - Create: `apps/web/src/app/[slug]/[locale]/loading.tsx`

  **Approach:**
  - Create a shared `ExperienceSkeleton` component that mimics the general experience page layout:
    - Full-viewport hero placeholder (matching VideoHero's aspect ratio) with shimmer animation
    - 2-3 content block placeholders below (rectangular shimmer blocks)
    - Use `bg-stone-900` background to match the page background
    - Tailwind `animate-pulse` for shimmer effect
  - Each `loading.tsx` exports this skeleton as the default
  - All three route segments get the same skeleton since they share the same page structure

  **Patterns to follow:**
  - `apps/web/CLAUDE.md` convention: "Loading states: always add `loading.tsx` for async routes"
  - Page background: `bg-stone-900` (used in all experience page `<main>` elements)
  - VideoHero: full-viewport height with gradient overlay

  **Test scenarios:**
  - Navigating to `/watch/easter` shows skeleton before content loads
  - Skeleton background matches page background (no flash)
  - Skeleton disappears when content renders

  **Verification:**
  - `loading.tsx` files exist for all three route segments
  - Skeleton renders immediately on navigation
  - No layout shift when real content replaces skeleton

- [ ] **Unit 5: Update solution documentation**

  **Goal:** Update the existing solution doc to reflect the corrected architecture with middleware.

  **Requirements:** None (documentation hygiene)

  **Dependencies:** Units 1-4

  **Files:**
  - Modify: `docs/solutions/web/nextjs16-cachecomponents-isr.md`

  **Approach:**
  - Add a section documenting that `headers()` in page routes defeats Full Route Cache
  - Document the middleware-based locale detection pattern
  - Update the architecture diagram to show middleware in the flow
  - Note the `revalidate = 60` safety net addition

  **Verification:**
  - Solution doc accurately reflects the updated architecture

## System-Wide Impact

- **Interaction graph:** Middleware runs before all experience routes. The `/api/revalidate` webhook continues to call `revalidatePath()` — no changes needed to the webhook.
- **Error propagation:** If middleware fails, requests pass through unmodified (English default). No new failure modes.
- **State lifecycle risks:** First request after cache invalidation is slightly slower (re-renders from Strapi). All subsequent requests within 60s are instant from cache. This is strictly better than current behavior (every request slow).
- **API surface parity:** No API changes. URLs remain the same for English users. Non-English users get redirected to explicit locale URLs (which already work).

## Risks & Dependencies

- **Middleware matcher with basePath**: Need to verify whether the middleware matcher accounts for `basePath: "/watch"` in next.config.mjs. If basePath is applied before middleware matching, the matcher paths should not include `/watch`.
- **Locale redirect loop**: Must ensure middleware does not redirect when locale is already in the URL, and that the `[slug]` route's locale-as-slug handling still works with middleware.
- **Cache warming**: First request after deployment or cache expiry will be slow. Consider adding `generateStaticParams` for known high-traffic slugs (e.g., `easter`, `christmas`) in a future enhancement.

## Documentation / Operational Notes

- Update `docs/solutions/web/nextjs16-cachecomponents-isr.md` after implementation
- Run `ce:compound` to capture the `headers()` defeats route cache learning
- The webhook at `/api/revalidate` requires no changes — it already calls `revalidatePath()` correctly

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-31-watch-experience-performance-requirements.md](docs/brainstorms/2026-03-31-watch-experience-performance-requirements.md)
- **Solution doc:** [docs/solutions/web/nextjs16-cachecomponents-isr.md](docs/solutions/web/nextjs16-cachecomponents-isr.md)
- **Solution doc:** [docs/solutions/graphql/server-side-strapi-queries-nextjs.md](docs/solutions/graphql/server-side-strapi-queries-nextjs.md)
- Related PR: #500 (ISR with Strapi webhook revalidation)
