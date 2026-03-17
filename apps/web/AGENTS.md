# Web Agent Guide

Scope: `apps/web`.

## Alignment

`apps/web/CLAUDE.md` is canonical detail for this app.

## Do

- Use Next.js App Router patterns and default to Server Components.
- Read data via `packages/graphql` operations only.
- Add `loading.tsx` for async routes and `error.tsx` at route segments.
- Keep preview/revalidate endpoints token-gated.
- Export route metadata where relevant.

## Do not

- Define GraphQL operations inline in this app.
- Import server-only code into client component trees.
- Import internals from `apps/cms`.
- Handwrite API client logic duplicated from generated clients.
