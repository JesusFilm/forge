# CMS Agent Guide

Scope: `apps/cms`.

## Do

- Model canonical entities and workflow states explicitly.
- Keep AI outputs in variant/revision records.
- Keep transitions auditable and role-gated.

## Do not

- Allow AI path to `published`.
- Move schema out of `apps/cms` (schema.graphql is canonical, Strapi-generated).

## Seed scripts

- Idempotency checks must account for nested components. When a component (e.g. `sections.bible-quotes-carousel`) is nested inside another component's `content` array (e.g. `sections.section`), a flat `__component` check at the top level will miss it. Inspect nested arrays to avoid silently skipping new content on re-runs.

## Typing note (Strapi internals)

- Prefer `Core.Strapi` at function boundaries.
- For Strapi admin internals (`admin.services["api-token"]`, `admin::api-token` query, `db.connection.raw`), use local narrow casts at the exact callsites.
- Do not add broad/global fake Strapi types for these internals; they drift and break easily across Strapi updates.
