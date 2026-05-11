# apps/web — Next.js App

## Stack

- Next.js 16+ App Router (`next@^16.1.6`)
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
- GraphQL operations are defined in this app (e.g., `src/lib/content.ts`, `src/lib/search.ts`) using `adminGraphql()` from `@forge/graphql`. Web reads admin's public Pothos API via `NEXT_PUBLIC_ADMIN_GRAPHQL_URL` / `INTERNAL_ADMIN_GRAPHQL_URL`; do not add Strapi fragments or `graphql()` web call sites.
- Section blocks are admin Zod blocks from `@forge/admin/domain/blocks` and dispatch on `block.t`, not Strapi `__typename`.
