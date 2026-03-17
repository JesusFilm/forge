# apps/web — Next.js App

## Stack

- Next.js 14+ App Router
- React Server Components (default)
- packages/graphql for all data fetching
- Tailwind CSS

## Conventions

- Route groups for layout boundaries: `(marketing)`, `(app)`, `(auth)`.
- Loading states: always add `loading.tsx` for async routes.
- Error boundaries: `error.tsx` at each route segment.
- Data fetching: use RSC async components with packages/graphql operations.
- Client components use `useSuspenseQuery` or equivalent with packages/graphql.
- Metadata: export `metadata` or `generateMetadata` from every page.

## Common Pitfalls

- Don't import server-only code in client components.
- `'use client'` is a boundary — everything imported below it is also client.
- GraphQL operations come from packages/graphql, never defined inline in this app.
