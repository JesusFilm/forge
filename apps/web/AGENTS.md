# Web Agent Guide

Scope: `apps/web`.

## Alignment

`apps/web/CLAUDE.md` is canonical detail for this app.

## Do

- Use Next.js App Router patterns and default to Server Components.
- Read data via `@forge/admin-graphql` operations only (admin's GraphQL surface).
- Add `loading.tsx` for async routes and `error.tsx` at route segments.
- Keep preview/revalidate endpoints token-gated.
- Export route metadata where relevant.
- For any user-visible `/watch` link in a button, card, carousel, modal, or component, pass the public audio language slug to the route builders in `src/lib/routes.ts`. Eligible English content canonically omits `english.html`; non-English stays explicit. A content slug that is also a public language home stays explicit-English.
- Keep search in the global modal surface. Do not add buttons, cards, or generated links to `/watch/search`, `/watch/search.html/search.html`, or query-driven search URLs; use the root modal fallback instead.

## Do not

- Define GraphQL operations inline in this app.
- Import server-only code into client component trees.
- Import internals from other apps.
- Handwrite API client logic duplicated from generated clients.
- Do not use the internal message-catalog locale key (`en`, `es`, etc.) as a public `/watch` URL segment. `/watch/foo.html/en.html` is wrong: eligible English is `/watch/foo.html`, while explicit compatibility/internal paths use `/watch/foo.html/english.html`.
