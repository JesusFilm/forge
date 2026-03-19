---
title: "Next.js 16 cacheComponents ISR with Strapi Webhook Revalidation"
category: web
date: 2026-03-19
tags: [nextjs, isr, caching, cacheComponents, strapi, webhook, revalidation]
---

# Next.js 16 cacheComponents ISR Pattern

## Problem

Migrating from Next.js 14/15 route segment config ISR (`export const revalidate`) to Next.js 16 `cacheComponents: true` causes multiple build errors:

```
Route segment config "revalidate" is not compatible with `nextConfig.cacheComponents`. Please remove it.
```

```
Route "/[slug]/[locale]": Uncached data was accessed outside of <Suspense>.
```

## Root Cause

Next.js 16 with `cacheComponents: true` replaces route segment config (`revalidate`, `dynamic`, `fetchCache`) with the `"use cache"` directive at the function/component level. The two APIs are **mutually exclusive**. Additionally, Next.js can only track and cache native `fetch()` calls — Apollo Client's internal HTTP layer is invisible to the framework's cache system.

## Investigation Steps (what failed)

| Attempt                                                         | Why it failed                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Remove `revalidate`, keep async page component                  | `await params` in page triggers "uncached data" during prerender |
| Wrap page content in `<Suspense>`                               | Works for `headers()` calls but not for data fetching via Apollo |
| Add `"use cache"` to `getExperienceMetadata`                    | `generateMetadata` runs outside Suspense/cache boundary          |
| Set `fetchPolicy: "network-only"` on Apollo                     | Apollo's fetch is still invisible to Next.js                     |
| Set `fetchOptions: { cache: "force-cache" }` on Apollo HttpLink | Apollo's internal cache layer still obscures the fetch           |
| Put `"use cache"` on the page default export                    | Page default export with `"use cache"` does not work as expected |
| Remove `generateMetadata`                                       | Fixes build but causes SEO regression                            |
| Replace Apollo with native `fetch()`                            | Fixes data fetching — Next.js can track native fetch             |
| Pass `params` Promise to cached child (don't await in page)     | Final fix — page must be synchronous                             |

## Working Solution

### Architecture

```
page.tsx (sync, default export)
  └─ <Suspense>
       └─ CachedContent (async, "use cache")
            ├─ await params
            ├─ cacheTag() + cacheLife("max")
            └─ native fetch() to Strapi GraphQL

api/revalidate/route.ts (webhook)
  └─ revalidateTag("experience:{slug}:{locale}", { expire: 0 })
```

### Page Pattern

```tsx
import { Suspense } from "react"
import { cacheLife, cacheTag } from "next/cache"

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
}

async function CachedContent({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>
}) {
  "use cache"

  const { slug, locale } = await params
  cacheTag("experience", `experience:${slug}`, `experience:${slug}:${locale}`)
  cacheLife("max")

  const result = await getWatchExperience(locale, slug)
  // ... render content ...
}

// Page default export MUST be synchronous
export default function Page({ params }: PageProps) {
  return (
    <Suspense>
      <CachedContent params={params} />
    </Suspense>
  )
}
```

### Data Fetching (native fetch, not Apollo)

```tsx
import { print } from "graphql"
import { cacheLife, cacheTag } from "next/cache"

export async function getWatchExperience(locale: string, slug?: string) {
  "use cache"

  cacheTag("experience", `experience:${slug}`, `experience:${slug}:${locale}`)
  cacheLife("max")

  const res = await fetch(process.env.INTERNAL_GRAPHQL_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
    },
    body: JSON.stringify({
      query: print(GET_WATCH_EXPERIENCE),
      variables: { locale, filters },
    }),
  })
  // ... parse and return typed result ...
}
```

### On-Demand Revalidation (webhook)

```tsx
import { revalidateTag } from "next/cache"

export async function POST(request: Request) {
  // 1. Validate x-revalidation-secret header (use crypto.timingSafeEqual)
  // 2. Parse Strapi webhook payload for model, entry.slug, entry.locale
  // 3. Call revalidateTag() with { expire: 0 } for immediate invalidation
  // Three-tier tags: experience:{slug}:{locale} → experience:{slug} → experience
}
```

## Critical Constraints

1. **`cacheComponents: true` is mutually exclusive with route segment config** — no `export const revalidate`, `dynamic`, or `fetchCache`
2. **Apollo Client cannot be used inside `"use cache"`** — its internal HTTP layer is invisible to Next.js. Use native `fetch()`
3. **Page default export must be synchronous** — async work happens in the cached child inside `<Suspense>`
4. **Never `await params` in the page component** — pass the Promise to the cached child
5. **`generateMetadata` with data fetching conflicts with cacheComponents** — it runs outside cache/Suspense boundary
6. **Return values from `"use cache"` must be serializable** — use plain objects, not class instances like `Error`

## Prevention Checklist (new pages)

- [ ] No route segment config exports in the file
- [ ] Page default export is synchronous (not `async`)
- [ ] Cached child component has `"use cache"`, `cacheTag()`, `cacheLife()`
- [ ] Data fetching uses native `fetch()`, not Apollo Client
- [ ] `params` Promise passed to cached child, awaited inside cache boundary
- [ ] `generateMetadata` does not fetch data (use static metadata from params)
- [ ] Webhook handler validates tags match the ones set in cached components
- [ ] Run `next build` locally to verify prerender succeeds

## Common Pitfalls

| Pitfall                                      | Why it breaks                                            |
| -------------------------------------------- | -------------------------------------------------------- |
| `export const revalidate = N`                | Incompatible with `cacheComponents` — build error        |
| `await params` in page component             | Uncached data access outside Suspense during prerender   |
| Apollo `client.query()` inside `"use cache"` | Next.js can't track Apollo's fetch — treated as uncached |
| `async` page default export                  | Delays rendering, conflicts with Suspense streaming      |
| Data fetching in `generateMetadata`          | Runs outside cache/Suspense — prerender failure          |

## Related

- [Next.js docs: use cache](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- [Next.js docs: cacheLife](https://nextjs.org/docs/app/api-reference/functions/cacheLife)
- [Next.js docs: cacheTag](https://nextjs.org/docs/app/api-reference/functions/cacheTag)
- [Next.js docs: migrating to cache components](https://nextjs.org/docs/app/guides/migrating-to-cache-components)
- `docs/solutions/cms/strapi-v5-populate-role-sanitization.md` — API token auth patterns for Strapi
- PR #500: feat(web): add ISR with Strapi webhook on-demand revalidation
