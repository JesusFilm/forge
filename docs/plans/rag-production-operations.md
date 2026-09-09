---
title: "Portable Forge production acquisition and indexing"
execution: code
---

## Goal and scope

Anyone with this repository and access to Doppler `forge-rag/prd` can preview
and apply a registered source or path slice using the repository scripts.
Document the complete setup, credentials, commands and completion checks.

Production corpus execution, secret provisioning, Railway deployment, legacy
receiver changes and evaluation migration are outside this implementation.
A production completion claim requires separately observed live evidence.

## Decisions

- Acquire/index explicitly select Forge-namespaced reader/writer URLs and an independently configured exact Forge expected hostname. No fallback to JFRAG or generic database URLs, even when both exist in the vault.
- Reuse current shared validation internally; other production consumers retain their existing contract. Document the boundary explicitly.
- Preview is the default. Apply requires an explicit flag plus a Forge-specific write opt-in. Contradictory acquire apply/dry-run flags fail before environment setup.
- Source/path resolution happens before wiring. Both modes report target, mode, source, path and bounds; preserve fixed inventory and index pre-limit filtering.
- Document coordination of concurrent maintenance sessions against the same corpus.

## Implementation units

### U1. Repo target contract

Files: `scripts/lib/production-target.ts`, its tests, `scripts/lib/maintenance-args.ts`, its tests, `scripts/acquire.ts`, `scripts/index.ts`, `tests/maintenance-entrypoints.test.ts` under `apps/rag`.

Add a Forge-specific installer for acquire/index with reader/writer mapping and independent host guard, without legacy DB fallback. Reject contradictory flags. Resolve scoped registry policy before wiring; emit safe target/scope receipts for both execution modes. Start with failing tests at those seams and test no environment mutation on refusal.

### U2. Portable operations documentation

Files: `apps/rag/docs/ops/corpus-maintenance.md`, `environment-and-secrets.md`, roadmap ticket/index, a concise solution record.

Document names, prerequisite reader provisioning, expected-host verification, provider requirements, source-only and Icelandic preview/apply commands, resume/retry limits, and observed completion conditions. Explain preview acquisition resolves URLs without fetching articles and index preview requires existing staging rows.

## Verification and outcome

U1 and U2 implemented. Verification covers target/argument and entrypoint tests,
existing path-slice regressions, RAG lint/typecheck/import law and formatting.
867 tests passed and two database integration tests were skipped. Live
configuration and production proof are tracked in feat-471.
