# Forge RAG

The governed home for the RAG service migrating from
[`JesusFilm/jesusfilm-rag`](https://github.com/JesusFilm/jesusfilm-rag/issues/130).
It remains a separate bounded context, Railway service, and Postgres database.

This scaffold intentionally contains no runtime behavior. Migration work is
tracked in `docs/roadmap/rag/`; public `/v1` behavior remains in the standalone
service until the relevant roadmap tickets land through normal PRs.

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
