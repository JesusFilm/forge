---
name: status-dashboard
description: Refresh, compile, and verify the committed Forge RAG status dashboard with an approval-gated production snapshot and external publication acceptance. Invoke explicitly as $status-dashboard.
---

# Forge RAG status dashboard

Operate from the Forge repository root. Read `apps/rag/AGENTS.md`,
`apps/rag/docs/ops/environment-and-secrets.md`, and
`apps/rag/docs/ops/dashboard.md`. The terminal state of this skill is a verified
local artifact and PR handoff; publication and acceptance remain external gates.

## Approval contract

An approval is fresh only when granted during this invocation for exactly one
named operation against one named target. It is consumed by execution, expires
on any operation/target change, and cannot cross sessions. Snapshot refresh
requires approval naming `read dashboard snapshot` and
`Doppler forge-rag/prd production-read`. Missing, stale, or mismatched approval
stops before the ignored snapshot or public artifacts change. Public-schema
changes require a separate approval naming the exact schema file and change.

## Workflow

1. Run `pnpm --filter @forge/rag status:check`. Confirm Doppler scope by names
   only; never use a command that prints secret values.
2. After exact approval, run:

   `doppler run --project forge-rag --config prd -- pnpm --filter @forge/rag dashboard:data`

   This is the only credentialed step. Never accept a pasted URL or map the
   production credential into a generic local variable.
3. Immediately run `pnpm --filter @forge/rag dashboard:snapshot:validate`. If
   Doppler or validation fails, stop without compiling and preserve the prior
   committed artifacts.
4. Run `pnpm --filter @forge/rag dashboard:build`, then
   `pnpm --filter @forge/rag dashboard:verify`. Browser-serve
   `apps/rag/dashboard/site` locally and verify `/rag-status/` by direct load and
   refresh, visible counts against `compiled-data.json`, and no external
   requests. Stop the server afterward.
5. Assemble into a new empty temporary directory with
   `pnpm --filter @forge/rag pages:assemble -- <empty-directory>` and confirm the
   allowlisted tree. Review the diff for credentials, corpus text, queries,
   result content, or undeclared files.
6. Hand off the changed committed artifacts and redacted evidence for an
   operator-managed PR. Do not claim published, verified-live, or accepted:
   GitHub Pages enablement, merge-triggered deployment, live browser/load proof,
   and repository-owner acceptance are separate external authorities.

This skill never materializes, inspects, or echoes secrets; creates issues or
branches; commits; merges; changes deployment configuration; or deploys local
worktree code.
