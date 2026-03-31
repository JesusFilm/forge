---
title: "Route-Level ISR with Apollo GraphQL and On-Demand Revalidation"
category: web
date: 2026-03-20
tags: [nextjs, isr, apollo, graphql, strapi, webhook, revalidation]
---

# Route-Level ISR with Apollo GraphQL

## Problem

Experience pages need ISR: cached indefinitely, revalidated on-demand when Strapi content changes. The data layer uses Apollo Client with gql.tada typed operations.

## Solution

Route-level caching via `export const revalidate = false` + `revalidatePath()` from a Strapi webhook.

### Architecture

```
Strapi updates "easter" in "en"
  → webhook POST /api/revalidate { model: "experience", entry: { slug: "easter", locale: "en" } }
  → revalidatePath("/easter/en")
  → Next.js re-renders the route with Apollo client.query()
  → Cached until next webhook
```

### Page Pattern

```tsx
export const revalidate = false // cache indefinitely

export default async function Page({ params }) {
  const { slug, locale } = await params
  const result = await getWatchExperience(locale, slug)
  // ... render
}
```

### Data Fetching (Apollo)

```tsx
import { cache } from "react"
import client from "@/lib/client"

export const getWatchExperience = cache(async (locale, slug?) => {
  const result = await client.query({
    query: GET_WATCH_EXPERIENCE,
    variables: { locale, filters },
    fetchPolicy: "no-cache", // bypass Apollo cache, let Next.js route cache handle it
  })
  // ... return typed result
})
```

### Webhook (on-demand revalidation)

```tsx
import { revalidatePath } from "next/cache"

export async function POST(request: Request) {
  // 1. Validate secret (timing-safe comparison)
  // 2. Parse slug/locale from Strapi payload
  // 3. revalidatePath(`/${slug}/${locale}`) — surgical, only the changed route
  // 4. Always revalidatePath("/") too in case it's the homepage
}
```

## Why Not cacheComponents?

We initially tried Next.js 16's `cacheComponents: true` with `"use cache"` directives. It failed because:

- **Apollo Client is incompatible** — its internal fetch is opaque to Next.js's cache system
- Native `fetch()` was required, losing Apollo's typed `client.query()` API
- `generateMetadata` with data fetching conflicts with the `"use cache"` boundary
- Page components must be synchronous, adding Suspense wrapper complexity

Route-level ISR with Apollo is simpler and fully compatible.

## Critical: headers() Defeats Full Route Cache

Calling `headers()` (or `cookies()`) anywhere in a page route forces Next.js into **dynamic rendering**, completely bypassing the Full Route Cache. This means `revalidate` and `revalidatePath()` have no effect — there is never a cached route to invalidate.

**Symptom**: Every request triggers a fresh server render and Strapi GraphQL call, even with `revalidate = false` set.

**Root cause**: `getLocale()` called `headers()` to read `Accept-Language`, which opted all experience pages out of static rendering.

**Fix**: Move locale detection to Next.js proxy (formerly middleware). Proxy reads `Accept-Language` and redirects non-English users to the locale-explicit URL (e.g., `/watch/easter/es`). English users pass through unchanged to `/watch/easter`. Page routes use `DEFAULT_LOCALE` directly — no `headers()` call.

### Updated Architecture

```
User visits /watch/easter
  → Middleware reads Accept-Language
  → English? Pass through to /watch/easter (rendered with DEFAULT_LOCALE)
  → Spanish? Redirect 307 to /watch/easter/es
  → Page renders (no headers() call, static-cacheable)
  → Cached for 60s or until webhook fires revalidatePath()
```

```
Strapi updates "easter" in "en"
  → webhook POST /api/revalidate { model: "experience", entry: { slug: "easter", locale: "en" } }
  → revalidatePath("/easter/en") + revalidatePath("/easter")
  → Next.js re-renders the route on next request
  → Cached again for 60s or until next webhook
```

## Key Constraints

1. `export const revalidate = 60` + `revalidatePath()` — ISR with time-based safety net (catches missed webhooks)
2. Apollo `fetchPolicy: "no-cache"` — always hit Strapi, let Next.js handle caching at the route level
3. React `cache()` wrapper — deduplicates calls within a single render (page + metadata)
4. `generateMetadata` works normally — no cache boundary conflicts
5. Webhook validates secret with `crypto.timingSafeEqual` and sanitizes slug input
6. **No `headers()` or `cookies()` in page routes** — use middleware for request-dependent logic instead

## Related

- PR #500: feat(web): add ISR with Strapi webhook on-demand revalidation
- `docs/solutions/cms/strapi-v5-populate-role-sanitization.md` — API token auth patterns
