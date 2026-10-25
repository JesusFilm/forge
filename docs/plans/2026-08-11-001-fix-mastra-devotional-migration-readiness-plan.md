---
title: "fix: Make Mastra migration readiness component-scoped"
type: "fix"
status: "completed"
date: "2026-08-11"
deepened: "2026-08-11"
---

# fix: Make Mastra migration readiness component-scoped

## Summary

Make Devotional Workspace readiness require its own immutable migration identity instead of the newest entry in the shared Mastra migration ledger. Preserve the existing migrations, checksums, commands, and production gates while documenting a deploy-before-migrate rollout.

---

## Problem Frame

The generalized Mastra migrator stores `001-devotional-workspace.sql` and `002-support-research.sql` in `devotional_workspace.schema_migrations`. Devotional readiness currently selects the global highest version and requires it to equal `1`, so applying support-research migration `002` makes a correctly migrated devotional schema appear unavailable. A read-only production snapshot found neither migration, but rollout must recheck live state and branch before any deployment or migration.

---

## Requirements

### Readiness contract

- R1. Devotional readiness succeeds only when the ledger contains the exact immutable identity of `001-devotional-workspace.sql`.
- R2. Unrelated later Mastra migrations, including `002-support-research.sql` and future entries, do not invalidate devotional readiness.
- R3. A missing ledger, missing migration `001`, wrong filename, wrong checksum, or database query failure remains fail-closed.
- R4. The existing readiness result continues to report devotional migration version `1` for compatibility with current callers.

### Migration and rollout compatibility

- R5. The shared ledger, advisory lock, checksum rules, numbered SQL files, generic migration command, and devotional compatibility alias remain unchanged.
- R6. Operator documentation distinguishes the required devotional migration identity from the global ledger head and requires code deployment before production migration.
- R7. Delivery creates and completes a dedicated roadmap ticket and verifies the live database independently from Railway deployment status before any feature flag can be enabled.
- R8. Automated coverage proves the repository-pinned readiness checksum is derived from the exact immutable migration `001` bytes.
- R9. Production preflight treats an empty ledger with no component schema objects as a clean bootstrap, and stops on partial or mismatched history, unledgered objects, unavailable pgvector installation, insufficient migration privileges, or an unexpected feature-gate state.
- R10. A read-only operator command exercises the deployed devotional database-readiness predicate against its configured database without exposing credentials or adding a public HTTP surface.

---

## Assumptions

- The shared migration ledger remains the compatibility boundary because migration `001` may already be recorded in non-production environments.
- The required identity is version `1`, filename `001-devotional-workspace.sql`, and the SHA-256 of the immutable repository file; future devotional-owned migrations must be added deliberately rather than inferred from global ordering.
- This change does not apply production migrations or enable devotional or support-research feature flags.

---

## Key Technical Decisions

- **Use component-scoped set membership:** Query the exact required devotional migration identity rather than `MAX(version)`, global row count, or `latest >= 1`. Global ordering cannot distinguish unrelated migrations or detect a missing local prerequisite.
- **Validate version, filename, and checksum:** Treat all three ledger fields as the immutable identity. The migrator already records the same SHA-256 and aborts on drift, so readiness and migration execution share one integrity boundary.
- **Preserve the historical ledger:** Do not move `devotional_workspace.schema_migrations`, edit applied SQL, add a corrective schema migration, or bump the expected latest version to `2`; each would add migration risk or recreate the defect when version `3` arrives.
- **Keep readiness read-only:** The runtime check only reports whether the required migration exists. pgvector, filesystem, and authoritative cutover readiness remain separate gates.
- **Branch on live state before rollout:** Deploy before migrating when neither migration or only `001` is present. If exact `001` and `002` already exist, deploy and verify without rewriting history. Any other ledger/schema combination is a no-go requiring drift investigation.
- **Verify through a contained operator command:** Reuse the production readiness function in a package script run inside the deployed Mastra environment. This proves the corrected reader against its configured database without enabling devotional starts or creating a new network endpoint.
- **Keep PostgreSQL smoke ephemeral:** Exercise the actual migration and readiness contract against a temporary pgvector-enabled PostgreSQL instance during delivery rather than adding a permanent test-container dependency for this bounded fix.

---

## High-Level Technical Design

```mermaid
sequenceDiagram
  participant CI as Pull request and CI
  participant M as Mastra deployment
  participant DB as PostgreSQL migration ledger
  participant R as Devotional readiness

  CI->>M: deploy component-scoped reader
  M->>DB: read exact migration 001 identity
  DB-->>M: missing until operator migration
  M-->>R: fail closed; feature gates stay off
  CI->>DB: operator applies pending 001 and 002
  DB-->>CI: ledger records both checksums atomically
  M->>DB: read exact migration 001 identity
  DB-->>M: matching 001 despite later 002
  M-->>R: required migration identity present; schema and other gates still decide cutover
```

The migration runner remains unchanged. Only the read-only readiness predicate changes from global-head equality to exact required-identity membership.

---

## Implementation Units

### U1. Correct devotional migration readiness and lock the regression

- **Goal:** Make the readiness predicate independent of unrelated shared-ledger migrations without weakening migration integrity.
- **Requirements:** R1-R5, R8, R10
- **Dependencies:** None
- **Files:** `docs/roadmap/platform/feat-344-mastra-devotional-migration-readiness.md`, `docs/roadmap/README.md`, `apps/mastra/package.json`, `apps/mastra/src/services/devotional/workspace/database.ts`, `apps/mastra/src/services/devotional/workspace/database.test.ts`, `apps/mastra/src/scripts/check-devotional-database-readiness.ts`, `apps/mastra/src/scripts/check-devotional-database-readiness.test.ts`, `apps/mastra/src/scripts/migrate-devotional-database.test.ts`
- **Approach:** Add a small required-devotional-migration manifest for version, filename, and checksum. Query that exact identity with parameters and preserve the existing `{ ready, version }` result shape, where `version` means the matched devotional migration and failed identity checks report version `0`. Start with query-aware regression tests so an implementation that returns the global latest version cannot pass. Add a safe package command that connects through `DATABASE_URL`, calls this exact function, emits only readiness fields, and exits nonzero when not ready.
- **Execution note:** Add the `001 + 002` failing regression before changing the readiness query.
- **Patterns to follow:** `apps/mastra/src/scripts/migrate-mastra-database.ts` for immutable filename and SHA-256 identity; `apps/mastra/src/services/devotional/workspace/database.ts` for fail-closed query handling.
- **Test scenarios:**
  1. Exact migration `001` alone returns ready with version `1`.
  2. Exact migration `001` alongside `002` returns ready with version `1`.
  3. Exact migration `001` alongside an unrelated future version remains ready.
  4. An empty ledger or a ledger containing only `002` returns not ready.
  5. Version `1` with the wrong filename returns not ready.
  6. Version `1` with the wrong checksum returns not ready.
  7. A missing schema/table or rejected query returns the existing unavailable diagnostic.
  8. The emitted query is parameterized for the exact required identity and no longer orders by global version.
  9. The required checksum constant equals a SHA-256 computed from the exact `001-devotional-workspace.sql` bytes using the migrator's hashing semantics.
  10. The operator command reports ready/not-ready through the shared predicate, exits nonzero for failure, and never serializes its database URL or underlying error.
- **Verification:** Focused readiness tests prove exact identity matching, later-migration tolerance, and fail-closed states. Existing migrator tests retain transaction, alias, and checksum-drift coverage. A disposable PostgreSQL smoke applies `001` and `002`, verifies both ledger identities, and calls devotional readiness before Mastra test, typecheck, lint, format, and build complete.

### U2. Align migration and cutover documentation

- **Goal:** Ensure future operators deploy and verify the component-scoped readiness contract safely.
- **Requirements:** R6-R7, R9
- **Dependencies:** U1
- **Files:** `apps/mastra/CLAUDE.md`, `docs/runbooks/devotional-workspace-cutover.md`, `docs/runbooks/support-research-agent.md`, `docs/roadmap/platform/feat-344-mastra-devotional-migration-readiness.md`
- **Approach:** Replace global “schema version 1” wording with exact migration-identity language. Add the live-state branches and no-go states, clarify that the generic command applies every pending Mastra migration, and require three independent evidence planes: canonical Railway deployment, direct database readback, and the contained operator command running in the deployed Mastra environment. Separate migration-readiness completion from authorization to enable either feature.
- **Patterns to follow:** `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md` for independent database verification; forward-only rollback guidance already present in both runbooks.
- **Test scenarios:** Test expectation: none -- documentation and roadmap changes do not alter runtime behavior.
- **Verification:** The runbooks branch from a fresh production preflight, preserve both disabled gates, inventory unledgered objects before migration, query exact identities and schema objects afterward, and proceed only to each feature's separate approval gates.

---

## Acceptance Examples

- AE1. Given ledger rows for migrations `001` and `002`, when Devotional Workspace checks database readiness, then it reports ready at devotional version `1`.
- AE2. Given a ledger row for `002` but no exact `001` identity, when readiness runs, then it remains unavailable.
- AE3. Given a correct `001` row plus an unrelated future migration, when readiness runs, then the later entry is ignored.
- AE4. Given a green Railway deployment but incomplete database or runtime evidence, when rollout is evaluated, then the migration-readiness rollout remains incomplete and neither feature receives authorization to enable.

---

## System-Wide Impact

- Devotional reconciliation and new-attempt admission consume this readiness result; the correction removes a false negative without bypassing filesystem, pgvector, cutover, replica, or feature-flag gates.
- Support research continues using the generic migrator and isolated `support_research` schema. No Help Scout, model-provider, or Linear behavior changes.
- The migration CLI and SQL remain byte-identical, preserving checksum history across local, staging, and production databases.

---

## Risks & Dependencies

- **History is not schema attestation:** An exact copied ledger row can still exist without the required tables. Runtime identity matching proves recorded migration history only; production preflight and post-migration readback must inventory the required relations, constraints, cutover row, and pgvector separately.
- **Checksum constant drift:** A mistyped or stale readiness checksum would reject valid history. A source-of-truth test hashes the immutable SQL file with the same algorithm as the migrator.
- **Future devotional migrations:** Readiness could miss a new required devotional migration unless its identity is added to the manifest. Package guidance must make that ownership explicit.
- **Rollout inversion:** Applying `002` before deploying this correction temporarily makes the old reader fail closed. The runbooks and PR handoff must require deploy-before-migrate.
- **False deployment confidence:** Railway success does not prove SQL execution. Production completion requires an independent read of ledger entries, schemas, pgvector, and active flags.

---

## Documentation / Operational Notes

Before migration, application rollback is safe because the ledger head has not changed. If migration fails, verify that the transaction restored the saved baseline. After `002` succeeds, preserve ledger rows and schemas, keep both features disabled, and roll forward with the corrected reader; reverting to the pre-fix reader is containment only because devotional readiness will fail closed until the fix returns.

Production evidence must record the environment, active commit, database identity, feature flags, exact ledger identities, expected schema objects, pgvector state, and runtime readiness. Check immediately after convergence and monitor readiness, checksum/query failures, unexpected scheduled work, and flag drift through the first 24 hours. These checks do not replace the devotional backup/reconciliation/Studio/canary gates or the support-research provider/privacy/dry-run approvals.

---

## Sources & Research

- `docs/plans/2026-08-01-001-feat-support-research-agent-plan.md` established the generalized checksum ledger and compatibility alias.
- `docs/solutions/integration-issues/mastra-runtime-upgrade-devotional-workspace-boundaries.md` requires separate database, restart, reconciliation, and canary evidence for devotional cutover.
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md` requires direct readback after infrastructure mutations.
- [PostgreSQL 18 transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html) supports the migrator's all-or-nothing DDL and ledger transaction.
- [PostgreSQL 18 advisory locks](https://www.postgresql.org/docs/18/functions-admin.html) documents transaction-level lock release and serialization behavior.
- [node-postgres transactions](https://node-postgres.com/features/transactions) requires one checked-out client for all statements in a transaction, matching the existing runner.
