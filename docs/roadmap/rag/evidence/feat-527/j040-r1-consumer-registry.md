---
title: "J040 R1 consumer registry foundation"
date: "2026-09-23"
status: in-progress
module: "apps/rag"
tags: ["rag", "postgresql", "consumer-access"]
problem_type: implementation
---

# R1 consumer registry foundation

This PR implements the first isolated slice of feat-527 against current Forge
`main`. The merged consumer-access plan and J022 discovery decisions govern the
shape: direct consumer creation, a globally unique lowercase name, a
server-derived initial GitHub owner, and runtime membership in PostgreSQL.
This slice does not expose creation or membership over HTTP.

## Schema and API decisions

- `consumer_private` is a separate PostgreSQL schema in the existing bounded
  RAG database. Its schema, tables, and trigger functions grant nothing to
  `PUBLIC`; the existing corpus reader has no schema usage. No corpus table,
  migration, or serving path changes.
- `consumers.id` is a random UUID assigned by PostgreSQL. ID and name are
  immutable, deletion is rejected, and name is unique with the accepted
  `^[a-z0-9-]+$` shape. The 80-character cap bounds storage. A consumer starts
  `pending`; later lifecycle work owns activation.
- `members` uses the stable numeric GitHub account ID, not a mutable handle.
  The initial `owner` row is inserted in the same transaction as the consumer
  and bounded `created` audit row. Deferred database triggers require at least
  one owner, including during competing deletes. Parent-row locking serializes
  membership changes. The repository only permits an existing owner to add or
  remove a `member`; it cannot remove or replace an owner. Future ownership
  transfer needs an explicit authority and audit design.
- `environments` reserves per-consumer environment and allowed source keys.
  R1 makes no approval or scope mutation API, and no credential table or
  verifier exists yet. `usage_daily` reserves aggregate counts by stable ID,
  environment, UTC day, and bounded outcome. R1 does not write or report usage.
  `lifecycle_audit` accepts only bounded action names and numeric actor ID; no
  free text, bearer, selector, query, IP, or corpus fields exist.
- The `ConsumerRegistry` port and PostgreSQL adapter are narrow. Their GitHub
  IDs must come from a later trusted admission layer. The adapter is not wired
  into serving or instantiated by the runtime. PostgreSQL uniqueness and
  transaction failures are left as database errors for the later application
  service to translate to user-facing responses.
- The restricted schema is intentionally raw SQL, outside Prisma's `public`
  datamodel. Prisma schema drift continues checking the corpus datamodel;
  integration tests exercise the additional schema and privileges directly.

## Boundaries and follow-up

This is schema and repository foundation only. Feat-527 still needs the portal
allowlist and trusted admission, real owner/member authorization at the HTTP
boundary, credential issuance and rotation, lifecycle policy, restricted
principal grants, and migration runbook. Feat-528 owns usage collection and
reporting. No production credentials, data, deployment, OAuth, portal UI,
request middleware, or legacy bearer change occurs in this PR.

The package guide's rule that serving only reads corpus remains true: this
repository is disconnected from serving, and the existing serving principal
cannot use `consumer_private`. Role grants for future writers/readers need a
separate review before wiring either path.

## Verification

Ran against a disposable `pgvector/pgvector:pg18-trixie` container on a
loopback-only port, with no production database access:

| Check                                            | Result                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Four Prisma migrations, including R1             | Passed on fresh database                                                         |
| `pnpm --filter @forge/rag db:verify`             | 30 tests passed across five suites                                               |
| `pnpm --filter @forge/rag test`                  | 867 tests passed; two optional integration suites skipped without a database URL |
| `pnpm --filter @forge/rag typecheck`             | Passed                                                                           |
| `pnpm --filter @forge/rag lint`                  | Passed                                                                           |
| `pnpm --filter @forge/rag depcruise`             | Passed, no dependency violations                                                 |
| `pnpm --filter @forge/rag db:schema:check`       | Prisma validation and nine schema tests passed                                   |
| `pnpm --filter @forge/rag db:drift:check`        | Passed; corpus datamodel matches migrations plus documented raw SQL              |
| Prettier on touched files and `git diff --check` | Passed                                                                           |

The integration suite covers atomic owner creation, duplicate-name rejection,
identity immutability, owner-only member changes, last-owner enforcement under
competing deletes, existing corpus tables, empty usage aggregates, and denial
of restricted-schema reads to the existing read-only principal.

## Changed files

- `apps/rag/prisma/migrations/20260923000000_consumer_registry_foundation/migration.sql`
- `apps/rag/src/contracts/consumer-registry.ts`
- `apps/rag/src/adapters/postgres/consumer-registry.ts`
- `apps/rag/tests/consumer-registry.integration.test.ts`
- `apps/rag/tests/readonly-role.integration.test.ts`
- `apps/rag/package.json`
- `apps/rag/.dependency-cruiser.cjs`
- `docs/roadmap/rag/feat-527-rag-consumer-access-lifecycle.md`
- `docs/roadmap/rag/README.md`
- This report.

The broader feat-527 ticket remains `in-progress` because R1 does not finish
the access lifecycle.
