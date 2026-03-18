# Next.js 16 cacheComponents and ISR

## Problem

`export const revalidate = false` (route segment config) causes a build error when `cacheComponents: true` is enabled in `next.config.mjs`:

```
Route segment config "revalidate" is not compatible with `nextConfig.cacheComponents`. Please remove it.
```

## Root Cause

Next.js 16 with `cacheComponents` replaces route segment config (`revalidate`, `dynamic`, etc.) with the `"use cache"` directive at the function/component level. The two APIs are mutually exclusive.

## Solution

Use `"use cache"` + `cacheLife()` + `cacheTag()` inside data-fetching functions instead of route segment config on pages.

### Before (Next.js 14/15 style)

```tsx
// page.tsx
export const revalidate = false // cache indefinitely

export default async function Page() {
  const data = await fetchData()
  return <div>{data}</div>
}
```

### After (Next.js 16 with cacheComponents)

```tsx
// data-fetching function
async function getData() {
  "use cache"
  cacheTag("my-tag")
  cacheLife("max")
  return await fetchData()
}

// page.tsx — no route segment config needed
export default async function Page() {
  const data = await getData()
  return <div>{data}</div>
}
```

### On-demand revalidation

Use `revalidateTag("my-tag")` in an API route (e.g., webhook handler) to invalidate specific cache entries. This replaces `revalidatePath()` for surgical invalidation.

## Related

- Next.js docs: [use cache](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- Next.js docs: [cacheLife](https://nextjs.org/docs/app/api-reference/functions/cacheLife)
- Next.js docs: [cacheTag](https://nextjs.org/docs/app/api-reference/functions/cacheTag)
- PR #500: feat(web): add ISR with Strapi webhook on-demand revalidation
