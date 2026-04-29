# apps/cms — Strapi v5

## Stack

- Strapi v5 with GraphQL plugin
- PostgreSQL (Railway-hosted)
- Railway deployment

## Conventions

- Content types managed via Strapi admin UI. Avoid manual schema file edits.
- GraphQL plugin is the primary API for standard CRUD operations.
- **Performance escape hatch**: For bulk aggregate queries where GraphQL's N+1 problem causes connection pool exhaustion (no DataLoader in Strapi v5), custom REST endpoints using raw SQL via knex are permitted. These live in `src/api/{endpoint-name}/` following the standard route/controller/service structure. Current examples: `video-coverage`, `language-geo`.
- API tokens seeded in bootstrap lifecycle using HMAC-SHA512 hashing.
- Media uploads handled by Strapi's default provider (or configured cloud provider).
- Enrichment automations use `ENRICHMENT_AUTOMATIONS_ENABLED` and `ENRICHMENT_AUTOMATIONS_CRON` for scheduler activation. Dispatch to Manager requires `MANAGER_INTERNAL_URL` or `MANAGER_URL` plus `MANAGER_API_KEY`.

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

## Search API

`Query.semanticSearch` (GraphQL) and `GET /api/search` (REST) accept an optional `mode` argument (feat-109):

- `mode` unset / `"hybrid"` (default): existing pipeline — semantic + concatenated-tsvector keyword retrieval. **Behavior is byte-identical to the pre-feat-109 baseline; do not change without a default-mode regression test update.**
- `mode="keyword-first"`: lexical stack with phrase-aware tsquery, weighted per-field tsvector, title trigram, and exact-title retrievers. Plus a post-fusion semantic-dilution cap behind `SEARCH_DILUTION_CAP_ENABLED`.
- Unknown `mode` values warn-and-fall-back to hybrid; never error.

The response field `searchMode` (`"hybrid" | "keyword-only"`) is a separate degradation signal (whether the embedding call succeeded) and is orthogonal to the input `mode`. Don't conflate them.

Optional `debug=true` query param surfaces internal scoring detail per result, origin-gated via `SEARCH_DEBUG_ALLOWED_ORIGINS` (CSV) or — when unset — any non-production origin. Fails closed on undefined origins.

GIN byte-parity invariant: any tsvector or trigram expression used in a search query MUST exactly match the indexed expression. The shared `apps/cms/src/api/search/services/lexical-sql.ts` exports the canonical strings; `ensure-search-lexical.ts` and the keyword-first retrievers reference them. Drift silently disables the GIN index — there's a unit test for byte-equality.
