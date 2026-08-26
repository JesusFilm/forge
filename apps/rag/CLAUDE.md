# CLAUDE.md — Forge RAG

## Architecture

The RAG is relocated into Forge, not absorbed into Admin. It owns a separate
Railway service and Postgres database and preserves the public read-only `/v1`
HTTP contract. Forge consumers may use the Railway-private route to that same
service.

## Import law

- `contracts` imports no internal implementation.
- `acquisition`, `indexing`, `retrieval`, and `serving` may import contracts and their own lane, never another lane or a concrete adapter.
- `adapters` implement contracts and do not import core lanes.
- Only the composition root may construct adapters and connect lanes.
- Tests outside an adapter may not import a real adapter.

Run `pnpm --filter @forge/rag test`; it executes dependency-cruiser before the
structural tests. TypeScript files are capped at 300 nonblank, non-comment lines
by the root ESLint config.

## Migration constraints

- Copy the existing corpus and vectors; do not re-embed them as part of migration.
- Prove count, integrity, provenance, vector dimensions, sample/hash, retrieval, and eval preservation.
- Keep the standalone production service intact through cutover soak and the approved rollback window.
- Separate operator actions from code and give data/deploy operations a read-only preflight, explicit target, reconciliation evidence, and rollback statement.
- Never include secret values or corpus text in docs, logs, issues, PRs, or transcripts.

The durable migration roadmap is `docs/roadmap/rag/README.md`. The historical
programme and issue relationships live under `JesusFilm/jesusfilm-rag#130`.
