# CMS Agent Guide

Scope: `apps/cms`.

## Do

- Model canonical entities and workflow states explicitly.
- Keep AI outputs in variant/revision records.
- Keep transitions auditable and role-gated.

## Do not

- Allow AI path to `published`.
- Move schema out of `apps/cms` (schema.graphql is canonical, Strapi-generated).

## Typing note (Strapi internals)

- Prefer `Core.Strapi` at function boundaries.
- For Strapi admin internals (`admin.services["api-token"]`, `admin::api-token` query, `db.connection.raw`), use local narrow casts at the exact callsites.
- Do not add broad/global fake Strapi types for these internals; they drift and break easily across Strapi updates.
