---
name: golden
description: Bootstrap or re-review grounded Forge RAG retrieval evaluation cases with identity-bound comparison and an approval-gated canonical write. Invoke explicitly as $golden.
---

# Forge RAG golden evaluation

Operate from the Forge repository root. Read `apps/rag/AGENTS.md`,
`apps/rag/docs/eval-approach.md`, and `apps/rag/eval/qa-golden.yaml`. Choose
bootstrap mode for a newly evaluated source and re-review mode when an existing
corpus gained content. Keep candidate cases outside the canonical file until
approval.

## Approval contract

An approval is fresh only when granted in this invocation for exactly one named
operation against one named target. It expires after execution, on an operation
or target change, and with the session. Canonical golden writes require fresh
approval naming `write candidate cases` and
`apps/rag/eval/qa-golden.yaml`; absent, stale, or mismatched approval means stop
without changing that file. Production reads independently require fresh
approval naming the exact command and `Doppler forge-rag/prd production-read`.

## Workflow

1. Resolve the source from the registry and lifecycle record. In re-review mode,
   inspect existing-case regressions before proposing new cases. Build relevant
   sets from the corpus, not from returned hits; validate every credited
   `(source, path)` resolves to exactly one document.
2. Judge whole documents with three independent lenses. Report the fan-out as
   `candidate documents × 3`. Continue at or below 1,000 judgments; above 1,000,
   stop and ask the operator to correct or explicitly re-authorize the bounded
   candidate set.
3. Exercise local candidates with
   `QUERY_EMBED_MAX_ATTEMPTS=8 QUERY_EMBED_TIMEOUT_MS=25000 pnpm --filter
@forge/rag eval -- --case-set current`. Keep questions, hits, URLs, scores,
   embeddings, and corpus text out of durable receipts.
4. Present the candidate diff and wait for the canonical-write approval. Apply
   only the approved candidate set, then run the eval again and compare
   identity-matched receipts with `pnpm --filter @forge/rag eval:compare --
<control.json> <candidate.json> [dispositions.yaml]`. A mismatched identity or
   failed gate is a terminal stop, not an invitation to weaken the baseline.
5. Report mode, source, case/config identity, fan-out, aggregate metrics,
   comparison state, and changed paths only.

For an approved production read, use only `doppler run --project forge-rag
--config prd -- pnpm --filter @forge/rag eval:production -- --case-set
<case-set>`. Doppler injects values into that subprocess; never materialize,
inspect, or echo them. This skill does not create issues or branches, commit,
merge, deploy, or change lifecycle YAML directly.
