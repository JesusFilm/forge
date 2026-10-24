---
title: "feat: Legacy OpenAI embedding cleanup CLI"
type: feat
status: active
date: 2026-06-14
origin: "user request"
---

# feat: Legacy OpenAI Embedding Cleanup CLI

## Summary

Add an Admin repo CLI that dry-runs by default, audits legacy OpenAI content
embeddings, and removes only rows that this checkout's schema can confidently
classify as old OpenAI vectors. The tool clears scene and experience vectors in
place, deletes transcript chunks whose parent transcript uses the old OpenAI
model, verifies or drops reverted `embedding_qwen` artifacts if they exist in a
target database, and preserves Manager artifacts and transcript parents.

---

## Requirements

- R1. Add an Admin package command for local, staging, and production targets.
- R2. Require `--target-env=development|staging|production`; dry-run by default.
- R3. Production execute must require `--execute`, `--allow-production-target`,
  and non-secret `--backup-evidence`.
- R4. Mutate only known legacy OpenAI embeddings:
  `openai/text-embedding-3-small`, `text-embedding-3-small`, or OpenAI provider
  provenance where this schema stores it.
- R5. Do not use `chunking_version` as a selector.
- R6. Delete legacy transcript chunks, not transcript parent rows.
- R7. Do not delete Manager artifacts, S3 objects, source media, or source
  transcript artifacts.
- R8. Audit and remove or verify absence of reverted `embedding_qwen`
  columns/indexes without serializing raw vectors.
- R9. Reports must avoid database URLs, bearer tokens, raw vectors, raw source
  text, and full transcript chunk text.

---

## Key Technical Decisions

- **Schema-bounded targeting:** This checkout does not have native-dimension or
  transform-version columns for scene/transcript rows, so the runnable cleanup
  targets only the old model strings and experience provider provenance.
- **Preserve non-legacy rows:** Rows that do not match the known legacy OpenAI
  predicates are counted as preserved or ambiguous, not mutated.
- **Transcript chunks are the deletion unit:** The searchable transcript text
  and vectors live in `video_transcript_chunk`; parent transcript rows remain
  for later model-upgrade or force backfills.
- **Qwen is schema cleanup:** `embedding_qwen` leftovers are columns/indexes,
  not content rows. The CLI verifies live schema and migration state before
  dropping those artifacts.

---

## Implementation Units

### U1. CLI Safety Contract

- **Files:**
  - Create: `apps/admin/src/scripts/cleanup-legacy-openai-embeddings.ts`
  - Create: `apps/admin/src/scripts/cleanup-legacy-openai-embeddings.test.ts`
  - Modify: `apps/admin/package.json`
- **Test scenarios:**
  - Missing target env fails before connecting.
  - Dry-run is the default.
  - Production execute is refused without explicit unlock and backup evidence.
  - Report paths resolve to a repo-local `.tmp` location by default.

### U2. Audit And Mutation Predicates

- **Files:**
  - Modify: `apps/admin/src/scripts/cleanup-legacy-openai-embeddings.ts`
  - Modify: `apps/admin/src/scripts/cleanup-legacy-openai-embeddings.test.ts`
- **Test scenarios:**
  - Scene and transcript predicates use legacy model strings.
  - Experience predicates use legacy model strings or OpenAI provider
    provenance.
  - Transcript predicates do not include `chunking_version`.
  - Reports count preserved and ambiguous rows without leaking vector values.

### U3. Qwen Artifact Handling

- **Files:**
  - Modify: `apps/admin/src/scripts/cleanup-legacy-openai-embeddings.ts`
  - Modify: `apps/admin/src/scripts/cleanup-legacy-openai-embeddings.test.ts`
- **Test scenarios:**
  - Missing `embedding_qwen` columns/indexes report verified absence.
  - Present artifacts report would-drop in dry-run.
  - Failed or unresolved Qwen migration state blocks execute.

### U4. Operator Docs And Verification

- **Files:**
  - Modify: `apps/admin/CLAUDE.md`
- **Verification commands:**
  - `pnpm --filter @forge/admin exec vitest run src/scripts/cleanup-legacy-openai-embeddings.test.ts`
  - `pnpm --filter @forge/admin typecheck`

---

## Scope Boundaries

- No Manager artifacts, source transcript artifacts, S3 objects, source media,
  videos, scenes, experiences, or transcript parent rows are deleted.
- No re-embedding is performed by this CLI.
- No public GraphQL, search response, or live query embedding code changes.
- No historical migration files are rewritten.

---

## Risks

- Production cleanup is destructive and depends on the operator selecting the
  right database and confirming a usable backup or recovery point.
- Scene/transcript current-provider provenance is not represented in this
  schema, so the CLI must not guess. Only known OpenAI legacy predicates are
  destructive.
- Large transcript chunk deletes may need conservative batching to avoid long
  locks.

---

## Sources

- `apps/admin/prisma/schema.prisma`
- `apps/admin/src/scripts/run-embeds.ts`
- `apps/admin/src/scripts/video-db-backup.ts`
- `apps/admin/CLAUDE.md`
