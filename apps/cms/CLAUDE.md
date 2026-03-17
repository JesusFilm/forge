# apps/cms — Strapi v5

## Stack

- Strapi v5 with GraphQL plugin
- PostgreSQL (Railway-hosted)
- Railway deployment

## Conventions

- Content types managed via Strapi admin UI. Avoid manual schema file edits.
- GraphQL plugin is the primary API. REST endpoints exist but apps should not use them.
- API tokens seeded in bootstrap lifecycle using HMAC-SHA512 hashing.
- Media uploads handled by Strapi's default provider (or configured cloud provider).

## The GraphQL Contract

This app's GraphQL schema is the source of truth for the entire system. Changes here cascade:

1. Content type change in Strapi
2. -> packages/graphql codegen must be re-run
3. -> apps/web and apps/mobile queries may need updating

Always communicate schema changes. Never merge a content type change without verifying codegen passes.

## Common Pitfalls

- Strapi v5 lifecycle hooks have different signatures than v4 — check the v5 docs.
- GraphQL plugin configuration lives in `config/plugins.ts`, not in content type definitions.
- Deleting a content type field is a breaking change — deprecate first if apps are in production.
