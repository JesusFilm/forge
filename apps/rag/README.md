# Forge RAG

The governed home for the RAG service migrating from
[`JesusFilm/jesusfilm-rag`](https://github.com/JesusFilm/jesusfilm-rag/issues/130).
It remains a separate bounded context, Railway service, and Postgres database.

Environment names, validation commands, and receiver-first secret procedures
live in [`docs/ops/environment-and-secrets.md`](docs/ops/environment-and-secrets.md).
Fresh database migration, local pgvector, Railway config-as-code, and
metadata-only production verification live in
[`docs/ops/postgres-and-schema.md`](docs/ops/postgres-and-schema.md).
Source acquisition, indexing, source-scoped reindexing, language maintenance,
and their production write gates live in
[`docs/ops/corpus-maintenance.md`](docs/ops/corpus-maintenance.md).
Lifecycle status commands, identity-bound retrieval evaluation, and preparation
of the committed public status surface live in
[`docs/source-status.yaml`](docs/source-status.yaml),
[`docs/ops/evaluation.md`](docs/ops/evaluation.md), and
[`docs/ops/dashboard.md`](docs/ops/dashboard.md). The provider-neutral `/slice`,
`/golden`, and `/status-dashboard` workflows are packaged in
[`plugins/jfp-rag`](../../plugins/jfp-rag); they orchestrate these repository
commands and do not replace their approval or production-target gates.

HTTP deployment, public/private reachability, bearer scope, and smoke procedures
live in [`docs/ops/http-service.md`](docs/ops/http-service.md).

The database schema and public `/v1` runtime are Forge-owned. The legacy service
remains available as rollback until the migration programme's cutover and soak
gates complete.

## Target layout

- `src/acquisition` — fetching, discovery, source registry, and staging
- `src/indexing` — normalize, chunk, embed, and corpus writes
- `src/retrieval` — deterministic ranked retrieval
- `docs/ops/corpus-copy.md` — resumable local corpus-copy rehearsal and reconciliation
- `src/serving` — thin HTTP `/v1` adapter
- `src/adapters` — external systems behind core ports
- `prisma` — the RAG-owned database schema and migrations
- `scripts` — operator tooling with dry-run and explicit-target safeguards
- `docs/ops` — operational procedures that contain no secrets or corpus text
- `eval/qa-golden.yaml` — canonical reviewed retrieval cases; attempts remain ignored
- `dashboard` — ignored production snapshot plus committed redacted JSON/HTML

Shared HTTP contracts belong in `packages/rag-contracts`; application code must
not be placed there.
