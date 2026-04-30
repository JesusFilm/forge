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
- GraphQL operations are defined in this app (e.g., `src/lib/content.ts`, `src/lib/fragments/`) using the `graphql()` function exported from `@forge/graphql`. The `packages/graphql/` workspace exposes the typed `graphql()` factory and introspection types — consuming apps own their own queries, mutations, and fragments. See the root `CLAUDE.md` "GraphQL Change Flow".
