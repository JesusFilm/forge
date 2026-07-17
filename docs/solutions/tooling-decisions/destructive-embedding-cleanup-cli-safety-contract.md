---
title: "Destructive embedding cleanup CLIs need model-provenance targeting"
date: 2026-06-15
category: tooling-decisions
module: admin
problem_type: tooling_decision
component: database
severity: high
applies_when:
  - "Removing legacy vectors from Admin-owned pgvector tables"
  - "Cleaning production data after an embedding model or chunking strategy changes"
  - "Auditing reverted vector columns or indexes that may exist in some deployed databases"
tags:
  - admin
  - embeddings
  - pgvector
  - cleanup
  - production-safety
  - transcripts
  - manager-artifacts
---

# Destructive Embedding Cleanup CLIs Need Model-Provenance Targeting

## Context

Admin needed a production-safe way to remove legacy OpenAI embeddings after
newer embedding and chunking code had already shipped. The operator intent was
specific: delete old OpenAI vectors, delete old transcript chunks, preserve
recently re-embedded rows, and do not touch Manager artifacts or source media.

The risky part is that this cleanup is destructive inside Admin's database.
Transcript chunks are separate searchable rows with both text and embeddings,
while Manager artifacts are source-side inputs used to rebuild Admin indexes.
A cleanup tool that confuses those layers can either leave stale search rows
behind or delete the material needed for repair.

## Guidance

Build destructive embedding cleanup tools as dry-run-first repo CLIs with an
explicit target environment and a model/provenance predicate. The selector
should answer "was this row embedded by the old model?" rather than "does this
row look old by chunking shape?"

For the legacy OpenAI cleanup, the destructive predicates were bounded to
model/provider fields that exist in the checked-out schema:

```ts
const LEGACY_OPENAI_MODELS = [
  "openai/text-embedding-3-small",
  "text-embedding-3-small",
] as const
```

Scene and transcript rows use the stored model string. Experience rows also
have provider/model provenance, so the cleanup can target `embedding_provider =
'openai'` or one of the old model strings. Do not use `chunking_version` as a
selector when the requirement is "only old embedding model output."

Use different mutation shapes for different ownership layers:

- Clear Admin-owned scene and experience vector/provenance columns in place.
- Delete Admin transcript chunk rows for legacy transcript parents.
- Preserve transcript parent rows so later backfills can rebuild chunks.
- Preserve Manager artifacts, source transcript artifacts, S3 objects, source
  media, videos, scenes, and experiences.

Production execution should require extra explicitness beyond `--execute`:

```bash
DATABASE_URL='<production-admin-db-url>' \
pnpm --filter @forge/admin cleanup:legacy-openai-embeddings -- \
  --target-env=production \
  --execute \
  --allow-production-target \
  --backup-evidence='<backup key or recovery point id>'
```

For reverted parallel-vector experiments such as `embedding_qwen`, treat
leftovers as schema artifacts, not content rows. Audit live columns, indexes,
and migration state first. If migration metadata is unresolved or failed, block
execution even when the physical columns are absent; a failed migration state is
evidence the database needs operator attention before destructive cleanup.

Reports should contain counts and safety state only. Do not serialize database
URLs, bearer tokens, raw vectors, raw source text, or full transcript chunk text.

## Why This Matters

Embedding cleanup is not a normal backfill retry. It removes search index data
that may currently power product behavior. Dry-run counts give operators a
chance to verify blast radius before mutation, while model-provenance targeting
keeps newly re-embedded rows out of the cleanup path.

Keeping Manager artifacts untouched preserves the forward repair path. If Admin
search rows are cleared or transcript chunks are deleted, the source artifacts
can feed a fresh `run-embeds` pass using current chunking and model code.

## When to Apply

- Use this for one-off or rare destructive cleanup of Admin-owned embedding
  storage.
- Use this when old and new embeddings may coexist and the distinction must be
  based on provider/model provenance.
- Use this when cleanup should make later re-embedding possible rather than
  attempting to re-embed in the same script.
- Avoid this pattern for ordinary additive backfills; use the normal workflow or
  `run-embeds` path instead.

## Examples

Local dry-run:

```bash
DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
pnpm --filter @forge/admin cleanup:legacy-openai-embeddings -- \
  --target-env=development
```

Targeted transcript chunk deletion keeps transcript parents:

```sql
DELETE FROM video_transcript_chunk c
USING doomed
WHERE c.id = doomed.id;
```

The `doomed` set should be selected by joining parent transcripts and checking
the legacy embedding model, not by checking chunking version or chunk text.

## Related

- [Local embed pipeline + manager-trigger parity pattern](../platform/local-embed-pipeline-pattern-20260429.md)
- [Admin transcript embeddings vector reuse pattern](../platform/admin-transcript-embeddings-vector-reuse-pattern.md)
- [pgvector bulk INSERT pattern](../database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md)
