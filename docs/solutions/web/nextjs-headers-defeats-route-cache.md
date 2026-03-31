---
title: "Next.js headers() in page routes silently defeats Full Route Cache"
category: web
date: 2026-03-31
tags:
  [
    nextjs,
    caching,
    isr,
    headers,
    dynamic-rendering,
    proxy,
    middleware,
    apollo,
    full-route-cache,
    locale-detection,
    revalidation,
  ]
---

# Next.js headers() in Page Routes Silently Defeats Full Route Cache

## Problem

Experience pages at `/watch/*` loaded slowly — every request triggered a fresh server render and Strapi GraphQL call despite ISR being correctly configured with `revalidate` settings and an `/api/revalidate` webhook using `revalidatePath()`.

## Investigation

1. Suspected `fetchPolicy: "no-cache"` on Apollo queries was bypassing caching
2. Found `revalidate = false` on all page routes and existing webhook with `revalidatePath()` — infrastructure appeared correct
3. Reviewed solution docs: route-level ISR should cache rendered output; Apollo's fetch behavior is independent of route caching
4. **Key discovery**: `getLocale()` in `apps/web/src/lib/locale.ts` called `headers()` to read Accept-Language
5. `headers()` is a dynamic API — it forces Next.js into dynamic rendering with no warning
6. The entire ISR infrastructure was correctly built but non-functional because of this one function call

## Root Cause

Calling `headers()` or `cookies()` anywhere in a page route forces Next.js App Router into **dynamic rendering**, completely bypassing the Full Route Cache. When a route is dynamically rendered:

- `revalidate` settings have no effect (there is no cached route to revalidate)
- `revalidatePath()` from webhooks has no effect (there is no cached path to invalidate)
- Every request triggers a fresh server render and all data fetches

This is silent — there is no error, no warning. The page works fine but every request is a cache miss.

## Solution

### 1. Move request-dependent logic to proxy (Next.js 16 convention)

Create `apps/web/src/proxy.ts` to read Accept-Language and redirect non-English users:

```typescript
// proxy.ts — runs before routing, does NOT affect page caching
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { DEFAULT_LOCALE, isLocale, parseAcceptLanguage } from "@/lib/locale"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const segments = pathname.split("/").filter(Boolean)
  const lastSegment = segments[segments.length - 1]

  // Already has locale in URL — pass through
  if (lastSegment && isLocale(lastSegment)) return NextResponse.next()

  const detected = parseAcceptLanguage(request.headers.get("accept-language"))

  // English or undetected — pass through, no redirect
  if (!detected || detected === DEFAULT_LOCALE) return NextResponse.next()

  // Non-English — redirect to locale-explicit URL
  const url = request.nextUrl.clone()
  url.pathname = `${pathname === "/" ? "" : pathname}/${detected}`
  return NextResponse.redirect(url, 307)
}
```

### 2. Remove dynamic API calls from page routes

Before (broken — forces dynamic rendering):

```typescript
import { headers } from "next/headers"

export default async function Page() {
  const headersList = await headers()
  const locale = parseLocale(headersList.get("accept-language"))
  // ^ This defeats Full Route Cache
}
```

After (cacheable — uses constant or URL params):

```typescript
import { DEFAULT_LOCALE } from "@/lib/locale"

export const revalidate = 60 // Now effective!

export default async function Page() {
  const locale = DEFAULT_LOCALE // No dynamic API call
}
```

### 3. Add time-based revalidation as safety net

Change `revalidate` from `false` to `60` — the webhook provides instant invalidation, and the 60s interval catches any missed webhooks.

## Key Insight

**Dynamic APIs like `headers()` and `cookies()` are mutually exclusive with the Full Route Cache.** This is an architectural constraint, not a bug. The rule:

> Request-dependent logic belongs in proxy/middleware. Page routes must be pure functions of their URL parameters if they need caching.

## Prevention

### Code review checklist

- [ ] No `headers`, `cookies`, or `draftMode` imports from `next/headers` in page routes
- [ ] Request-dependent logic (Accept-Language, auth, A/B tests) is in proxy, not pages
- [ ] `export const revalidate` is set explicitly on cacheable pages

### Detection

```bash
# Find headers()/cookies() usage in page routes
grep -r "from 'next/headers'" apps/web/src/app --include="*page.tsx"
find apps/web/src/app -name "page.tsx" -exec grep -l "headers\|cookies" {} \;
```

### Build output verification

After `next build`, check the route table:

- `○` = Static (prerendered, cacheable)
- `ƒ` = Dynamic (server-rendered on demand)

If a page that should be static appears as `ƒ`, check for `headers()`/`cookies()` calls.

## Related

- PR #603: fix(web): enable route caching by moving locale detection to proxy
- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — ISR architecture with updated `headers()` pitfall section
- `docs/solutions/graphql/server-side-strapi-queries-nextjs.md` — Apollo `fetchPolicy: "no-cache"` rationale (complementary pattern)
