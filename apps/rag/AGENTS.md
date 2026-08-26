# RAG Agent Guide

Scope: `apps/rag` only. Read `CLAUDE.md` before making changes.

- Preserve the RAG as a separate bounded context, Railway service, and database.
- Keep acquisition, indexing, retrieval, serving, and adapters behind the import law enforced by `pnpm --filter @forge/rag depcruise`.
- Put consumer-neutral `/v1` HTTP contracts in `packages/rag-contracts`; do not import from another app.
- Retrieval is mechanism, not consumer policy. Consumers own generation, intent, tone, and audience weighting.
- Only indexing writes corpus rows. Serving and retrieval are read-only.
- Never log or commit secrets, bearer values, corpus text, or production migration evidence containing either.
- Production changes use the normal PR-to-main Railway autodeploy path. Never deploy local worktree code directly.
