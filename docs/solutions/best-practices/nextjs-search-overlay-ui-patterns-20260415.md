---
title: "Next.js Search Overlay UI — Patterns and Pitfalls"
date: 2026-04-15
last_updated: 2026-04-16
category: best-practices
module: web
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Building a search overlay or modal in a Next.js App Router app
  - Consuming a GraphQL API from both Server and Client Components
  - Using Apollo Client with gql.tada in a basePath-configured app
  - Adding debounced async search with client-side state management
tags:
  - nextjs
  - react
  - search
  - overlay
  - portal
  - server-components
  - client-components
  - apollo
  - debounce
  - race-condition
---

# Next.js Search Overlay UI — Patterns and Pitfalls

## Context

Building a semantic search overlay for the JesusFilm web app (`apps/web/`) surfaced eight patterns and pitfalls at the intersection of Next.js 16 App Router, Apollo Client, CSS stacking contexts, and React component boundaries. Each issue was non-obvious, produced silent failures or cryptic errors, and is likely to recur in any feature that mixes Server Components with interactive client overlays.

## Guidance

### 1. Separate query definitions from server-only modules

**Problem:** `content.ts` imports `unstable_cache` from `next/cache` (server-only). Placing a GraphQL query constant there means any `'use client'` component that imports the query will fail to bundle — the server-only import poisons the entire file.

**Fix:** Create a dedicated file (e.g., `search.ts`) with no server-only imports. Both Server Components and Client Components can safely import from it.

```ts
// BAD: content.ts — has unstable_cache, breaks client imports
import { unstable_cache } from 'next/cache'
export const SEARCH_QUERY = graphql(`...`)

// GOOD: search.ts — no server-only imports
import { graphql } from '@forge/graphql'
export const SEARCH_QUERY = graphql(`...`)
export async function searchVideos(query: string) { ... }
```

Common server-only offenders: `next/cache`, `next/headers`, `server-only`.

### 2. Use createPortal for overlays inside stacking contexts

**Problem:** A `position: fixed; inset: 0` overlay rendered inside a `<header>` with `backdrop-filter: blur()` gets clipped. The `backdrop-filter` creates a new CSS stacking context that constrains fixed-position descendants — z-index escalation has no effect.

**Fix:** Render the overlay via `createPortal` to `document.body`.

```tsx
import { createPortal } from "react-dom"

// In SearchToggle.tsx
{
  open &&
    createPortal(
      <SearchOverlay open={open} onClose={handleClose} />,
      document.body,
    )
}
```

Properties that create stacking contexts (silently): `backdrop-filter`, `transform`, `opacity < 1`, `will-change`, `isolation: isolate`, `filter`.

### 3. Await searchParams in Next.js 16

**Problem:** In Next.js 16, `searchParams` is `Promise<{ [key: string]: string | undefined }>`. Accessing properties synchronously causes TypeScript errors and runtime failures.

```tsx
type Props = { searchParams: Promise<{ q?: string }> }

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams // MUST await
}
```

### 4. basePath is not auto-applied to next/image for local files

**Problem:** With `basePath: "/watch"`, `<Image src="/images/logo.svg" />` renders `src="/images/logo.svg"` but the file is served at `/watch/images/logo.svg`. The image 404s silently.

**Fix:** Use `unoptimized` with a manually prefixed path, or use the codebase `BASE_PATH` constant pattern (seen in `MediaCollection.tsx`, `DynamicBackground.tsx`).

### 5. Register animations via Tailwind @theme, not inline style or styled-jsx

**Problem (layer 1 — lint):** `<style jsx global>` blocks fail under `lint-staged`'s ESLint invocation (`Definition for rule not found`), even though the main project lint passes.

**Problem (layer 2 — Tailwind v4 purging):** Moving keyframes to `globals.css` is necessary but not sufficient. Tailwind CSS v4 tree-shakes `@keyframes` blocks that aren't referenced by any Tailwind utility class. Keyframes referenced only via inline `style={{ animation: "card-enter ..." }}` are invisible to Tailwind's build-time scanner — the string in a JSX `style` prop is never parsed for CSS references. The keyframes exist in the source CSS but are stripped from the browser stylesheet. (session history)

**What didn't work:** (session history)

- `@layer base { @keyframes ... }` — purged
- Bare `@keyframes` outside any layer — purged
- Placing keyframes before `@import "tailwindcss"` — purged

The only keyframes that survived (`mesh-gradient`) were referenced by a CSS class (`.mesh-gradient-bg`) in the same file — Tailwind saw the class reference and kept the keyframe.

**Fix:** Register animations as `--animate-*` CSS variables in `@theme`, then use `animate-*` utility classes in components:

```css
/* globals.css */
@theme {
  --animate-card-enter: card-enter 300ms ease-out both;
  --animate-overlay-fade-in: overlay-fade-in 200ms ease-out forwards;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

```tsx
// Component — use Tailwind class, not inline style
<div className="animate-card-enter" style={{ animationDelay: `${index * 50}ms` }}>
```

Keep `animationDelay` as an inline style for per-element dynamic values (Tailwind can't generate arbitrary delays at build time). The animation name goes in the class; the delay stays in the style.

**Bonus pitfall — duplicate className props:** Adding a second `className` prop to an element (e.g., one for grid layout, another for animation) silently overwrites the first. JSX takes the last `className`. Always merge into a single `className` with template literals.

### 6. Guard debounced async search against race conditions

**Problem:** A 300ms debounce fires search queries. If the user types faster than the network round-trip, an older response can resolve after a newer one and overwrite fresh results with stale data. (session history)

**Fix:** Use a request ID counter ref. Each search call increments it and captures the value; after the response, check that the captured ID still matches before writing state.

```ts
const requestIdRef = useRef(0)

const search = useCallback(async (q: string) => {
  const thisRequest = ++requestIdRef.current
  const data = await client.query({ ... })
  if (requestIdRef.current !== thisRequest) return // stale
  setResults(data)
}, [])
```

### 7. Avoid JSX inside try/catch — use .catch() pattern

**Problem:** The `react-hooks/error-boundaries` ESLint rule forbids JSX inside try/catch blocks. React doesn't render JSX immediately, so try/catch won't actually catch rendering errors.

**Fix:** Use `.catch()` to convert errors into a data structure, then render conditionally.

```ts
// BAD — lint error
try {
  const data = await fetchData()
  return <Results data={data} />
} catch (e) {
  return <ErrorState />
}

// GOOD
const result = await fetchData().catch((e) => ({ error: e }))
if ('error' in result) return <ErrorState />
return <Results data={result} />
```

### 8. Custom GraphQL extensions use String!, not I18NLocaleCode!

**Problem:** Standard Strapi content queries use `I18NLocaleCode!` for locale. Custom GraphQL resolver extensions (like `semanticSearch`) use `String!`. Copying the locale variable type from an existing query causes a GraphQL type mismatch at the schema layer — gql.tada catches this at compile time, but the error is confusing.

**Fix:** Always check the schema definition for the specific operation. Don't copy-paste locale types across queries.

## Why This Matters

Each of these issues produces silent failures, invisible UI bugs, or CI-only errors that are difficult to diagnose without prior knowledge. Server-only import poisoning and stacking context clipping are particularly insidious — they produce no console errors and no build-time warnings. Documenting these patterns prevents repeat investigation time.

## When to Apply

- Building any overlay, modal, or drawer in a Next.js App Router app with `backdrop-filter` on parent elements
- Consuming GraphQL queries from both Server and Client Components
- Adding debounced search or autocomplete with async data fetching
- Working with `basePath` configuration and local image assets
- Adding custom GraphQL resolver extensions alongside Strapi's generated schema

## Examples

See `apps/web/src/components/SearchOverlay.tsx` for the complete implementation showing all eight patterns applied together: portal rendering, request ID guard, `.catch()` error handling, and `globals.css` keyframe references.

See `apps/web/src/lib/search.ts` for the query definition separation pattern — a standalone file with no server-only imports, exportable to both RSC and client contexts.

## Related

- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — Apollo + Next.js 16 caching patterns (same data-fetching context)
- `docs/solutions/graphql/server-side-strapi-queries-nextjs.md` — Server Component GraphQL fetching (the "server owns the call" pattern this doc extends)
- `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — CMS backend counterpart to this UI doc
- `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md` — Error extension handling for search API errors
