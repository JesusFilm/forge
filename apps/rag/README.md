# Forge RAG

The governed home for the RAG service migrating from
[`JesusFilm/jesusfilm-rag`](https://github.com/JesusFilm/jesusfilm-rag/issues/130).
It remains a separate bounded context, Railway service, and Postgres database.

Environment names, validation commands, and receiver-first secret procedures
live in [`docs/ops/environment-and-secrets.md`](docs/ops/environment-and-secrets.md).
Fresh database migration, local pgvector, Railway config-as-code, and
metadata-only production verification live in
[`docs/ops/postgres-and-schema.md`](docs/ops/postgres-and-schema.md).

The database schema is now Forge-owned; public `/v1` runtime behavior remains in
the standalone service until the relevant roadmap tickets land through normal
PRs.

## Target layout

- `src/acquisition` — fetching, discovery, source registry, and staging
- `src/indexing` — normalize, chunk, embed, and corpus writes
- `src/retrieval` — deterministic ranked retrieval
- `src/serving` — thin HTTP `/v1` adapter
- `src/adapters` — external systems behind core ports
- `prisma` — the RAG-owned database schema and migrations
- `scripts` — operator tooling with dry-run and explicit-target safeguards
- `docs/ops` — operational procedures that contain no secrets or corpus text

Shared HTTP contracts belong in `packages/rag-contracts`; application code must
not be placed there.
