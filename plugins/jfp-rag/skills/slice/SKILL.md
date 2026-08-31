---
name: slice
description: Run or resume one Forge RAG source through acquire, index, retrieve, and evaluate while keeping lifecycle state durable. Invoke explicitly as $slice, optionally with a source key.
---

# Forge RAG source slice

Operate from the Forge repository root and stay inside `apps/rag`. Read
`apps/rag/AGENTS.md`, the matching registry entry, and
`apps/rag/docs/source-status.yaml`. The lifecycle YAML and its referenced
`apps/rag/docs/slices/<key>.md` file are the resume contract; chat history is not.

## Approval contract

An approval is fresh only when the operator grants it for exactly one named
operation against one named target during this invocation. It is void after
that operation executes, when either name changes, and at the end of the
session. Never infer or reuse approval. Local read-only checks need none.
Every lifecycle mutation and every production operation needs its own fresh
approval. Refusal or missing approval leaves canonical state unchanged.

## Workflow

1. Resolve the requested key, or find an `in-progress`/`blocked` row. Open its
   slice record and resume at its first unchecked step. If starting, draft the
   record under `apps/rag/docs/slices/<key>.md` before changing lifecycle state.
2. Establish a local baseline with `pnpm --filter @forge/rag status:check`,
   `pnpm --filter @forge/rag depcruise`, and focused tests for the stage.
3. Preview only the required local primitive: `pnpm --filter @forge/rag acquire
   -- --source <key>` or `pnpm --filter @forge/rag index -- --source <key>`.
   A mutating run needs fresh approval naming `acquire source` or `index source`
   and local target `<key>`; then rerun that exact command with `--apply`. Verify
   retrieval with `pnpm --filter @forge/rag query -- --source <key> <query>`.
   Do not place corpus text in the slice record or report.
4. Record redacted evidence in the slice record. With fresh approval for the
   exact mutation and `<key>/<language>` target, use only
   `pnpm --filter @forge/rag status:set -- --source <key> --lang <language>
   --stage <stage>=<state> ...`. Use `status:add-source` or `status:add-lang`
   similarly when the approved operation names that exact addition. Never edit
   `apps/rag/docs/source-status.yaml` by hand.
5. Re-run `status:check`. On failure, stop with the unchecked step and a blocker
   or resume hint preserved. On success, report changed artifacts and the next
   stage without changing git history.

Production work is exceptional: require a fresh approval naming the operation
and `Doppler forge-rag/prd production-read`, follow
`apps/rag/docs/ops/environment-and-secrets.md`, and inject values only through
`doppler run --project forge-rag --config prd -- <approved command>`. Never
materialize, inspect, or echo secrets. This skill does not create tracking
issues, change branches, commit, merge, or deploy.
