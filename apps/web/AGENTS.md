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
- For any user-visible `/watch` link in a button, card, carousel, modal, or component, build the URL with the public audio language slug (`english.html`, `spanish-castilian.html`, etc.). Use `variant.language.slug`, `languageSlug`, or `currentLanguageSlug` and the route builders in `src/lib/routes.ts`.
- Keep search in the global modal surface. Do not add buttons, cards, or generated links to `/watch/search`, `/watch/search.html/search.html`, or query-driven search URLs; use the root modal fallback instead.

## Do not

- Define GraphQL operations inline in this app.
- Import server-only code into client component trees.
- Import internals from other apps.
- Handwrite API client logic duplicated from generated clients.
- Do not use the internal message-catalog locale key (`en`, `es`, etc.) as a public `/watch` URL segment. Links like `/watch/foo.html/en.html` are wrong; the public audio slug form is `/watch/foo.html/english.html`.
