---
title: "Consumer V1: one runtime environment per consumer"
type: refactor
status: complete
date: 2026-09-23
---

# Consumer V1 simplification

Scope: update existing draft [PR #2397](https://github.com/JesusFilm/forge/pull/2397)
and the relevant feat-527–530 design handoffs. V1 has exactly one runtime
environment per consumer. There is no staging environment; additional environment
identity, tables, selectors and lifecycle state are unnecessary (YAGNI).

## Investigation and implementation plan

- The PR implements only the restricted registry foundation. The environment
  table is unused by its adapter, but owns source grants and is referenced by
  the reserved daily usage table. Move source grants to `consumers`, use its
  existing lifecycle state, remove the environment table, and key usage directly
  by consumer, UTC day and outcome.
- Amend the PR's unmerged foundation migration. Its recorded validation used a
  disposable database; there is no deployed rollout to migrate in this scope.
  Apply all migrations to a fresh isolated database and repeat deployment for
  idempotence. Never rewrite a migration already applied to a persistent target;
  any such target would require a separately reviewed forward migration.
- Expose consumer-owned source grants through the registry read contract, with
  an empty default and no caller-supplied grants on creation. Preserve ownership,
  immutable identity, audit and database privilege boundaries.
- Align the canonical plan, discovery handoff and roadmap: GitHub admission and
  ownership remain unchanged; future credentials belong directly to a consumer,
  with one active slot, verifier-only persistence and atomic rotation. Future
  auth and reports carry consumer identity without an environment selector.
- Search routes, services, models and tests for dependent behavior. Current
  serving uses the legacy bearer registry; OAuth, issuance, consumer middleware,
  usage collection/reporting and portal UI are not implemented by this PR. Do not
  add those later features or modify their existing legacy operations.
- Review the patch and run formatting, RAG typecheck/lint/dependency rules, unit
  tests, schema validation/drift, fresh migration and real PostgreSQL integration
  tests. No frontend rendering changes are planned.
- Update this report with exact results, commit and fast-forward the existing PR
  branch, and comment on the simplification. Leave the PR open and undeployed.

## Future redesign boundary

Keep the stable consumer UUID across membership changes and credential rotation.
If multiple environments become a real requirement, deliberately design the
identity, credential migration, grants and usage semantics together. V1 reserves
no environment rows, fields, routes, fallback values or staging behavior for it.

## Verification and review

The implementation follows the plan above. Review traced every registry caller:
only the adapter and integration tests use the registry; serving still uses
`TokenRegistry`/`lookupScope`. There were no environment routes, credential
models or portal components to remove. The restricted schema is raw SQL outside
Prisma's public datamodel, so no Prisma model or generated GraphQL output change
is required. Active design handoffs no longer contain `ConsumerEnvironment`,
consumer/environment composite keys, environment-bound verifier lookup or a
report environment argument. Superseded investigation receipts remain historical.

The new PostgreSQL assertions prove:

- Exactly four private tables exist, with no environment discriminator.
- Creation returns pending state and empty source grants; reads return grants
  directly from the consumer and keep other consumers isolated.
- NULL grant arrays and NULL array entries are rejected.
- Daily usage references an existing consumer directly, separates days/outcomes
  and consumers, supports accumulation on the new composite key, and rejects
  duplicate keys, orphan consumer IDs, negative counts and unknown outcomes.
- Existing identity immutability, atomic owner creation, owner-only membership
  operations and concurrent last-owner protection still pass. The corpus reader
  cannot read consumers or usage.

### Exact commands and results

Validation used Node `v24.21.0` (repository `.nvmrc`: 24), pnpm `9.12.3`,
Prisma `6.19.3`, and a fresh `pgvector/pgvector:pg18-trixie` container bound only
to loopback. The local synthetic database used trust authentication and no real
credential. No secret files or production database were accessed.

Setup:

```sh
pnpm install --frozen-lockfile --ignore-scripts --filter @forge/rag... --filter roadmap...
pnpm exec husky
pnpm --filter @forge/rag db:generate
docker run --detach --name forge-consumer-v1-check --publish 127.0.0.1::5432 --env POSTGRES_USER=forge --env POSTGRES_DB=forge_rag --env POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg18-trixie
```

The first install included only RAG and its dependencies. The first unit run
therefore failed one existing roadmap test because `gray-matter` was not
installed. Including the `roadmap` workspace fixed the fixture dependency;
the complete unit command was rerun successfully. No product workaround or
lockfile change was needed.

For the following database commands only,
`DATABASE_URL=postgresql://forge@127.0.0.1:32768/forge_rag` selected the disposable
container. The unit and schema-check commands ran with `DATABASE_URL` unset.

| Command                                                                                          | Result                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @forge/rag db:migrate:deploy`                                                     | All four migrations applied from zero.                                                                                                                        |
| `pnpm --filter @forge/rag db:migrate:deploy` (second invocation)                                 | Passed; no pending migrations.                                                                                                                                |
| `pnpm --filter @forge/rag db:migrate:status`                                                     | Passed; database up to date.                                                                                                                                  |
| `pnpm --filter @forge/rag db:drift:check`                                                        | Passed; public corpus matches the Prisma datamodel and documented raw SQL. Private schema verified by integration tests.                                      |
| `pnpm --filter @forge/rag db:verify`                                                             | 33 tests passed across five suites, including all seven registry tests.                                                                                       |
| `pnpm --filter @forge/rag test`                                                                  | 867 passed; 109 suites passed, two optional suites skipped without a database URL. Includes dependency-cruiser: 281 modules, 744 dependencies, no violations. |
| `pnpm --filter @forge/rag typecheck`                                                             | Passed, including Prisma client generation.                                                                                                                   |
| `pnpm --filter @forge/rag lint`                                                                  | Passed.                                                                                                                                                       |
| `pnpm --filter @forge/rag db:schema:check`                                                       | Prisma validation passed; nine schema/drift unit tests passed.                                                                                                |
| `pnpm run format:check`                                                                          | Passed across the entire repository.                                                                                                                          |
| `git diff --cached --name-only --diff-filter=ACMR -z -- '*.md' \| xargs -0 npx prettier --check` | Passed on all changed Markdown.                                                                                                                               |
| `git diff --check`                                                                               | Passed.                                                                                                                                                       |

The skipped unit-run suites were `readonly-role.integration.test.ts` (exercised
successfully by `db:verify`) and `dashboard-query.integration.test.ts` (unrelated
optional dashboard database check, not exercised). No frontend rendering,
hydration, routing or initialization changes occurred; page-load measurements do
not apply. No live OAuth/portal/rotation or consumer HTTP usage proof is claimed:
those features do not exist in this foundation and remain tracked in feat-527–530.

### Migration and delivery limitations

This revision amends the unmerged foundation migration; it does not convert an
already populated environment table. The prior report records only disposable
validation. Persistent targets with the earlier checksum would require a forward
migration before use; no such target was accessed or changed. Existing public
corpus migrations and data remain unchanged.

The broader feat-527 remains in progress because its authenticated lifecycle
requirements are outside this registry PR. This simplification does not add a new
product decision or blocker. PR #2397 remains open and draft; no merge or deploy
is authorized.

## Changed files

- `apps/rag/prisma/migrations/20260923000000_consumer_registry_foundation/migration.sql`
- `apps/rag/src/contracts/consumer-registry.ts`
- `apps/rag/src/adapters/postgres/consumer-registry.ts`
- `apps/rag/tests/consumer-registry.integration.test.ts`
- `apps/rag/tests/readonly-role.integration.test.ts`
- `docs/plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md`
- `docs/plans/2026-09-23-consumer-single-environment.md` (this report)
- `docs/roadmap/rag/README.md`
- `docs/roadmap/rag/evidence/feat-518/consumer-access-discovery.md`
- `docs/roadmap/rag/evidence/feat-527/consumer-registry-foundation.md`
  (renamed the previous foundation report to a descriptive filename)
- `docs/roadmap/rag/feat-527-rag-consumer-access-lifecycle.md`
- `docs/roadmap/rag/feat-528-rag-consumer-usage-visibility.md`
- `docs/roadmap/rag/feat-529-rag-consumer-dogfood-migration.md`
- `docs/roadmap/rag/feat-530-rag-consumer-self-service-portal.md`

## Durable lesson

When removing an unused identity dimension, follow its foreign keys and planned
contracts as well as runtime callers. Moving source grants without changing the
usage key or verifier/rotation/report handoffs would leave contradictory V1
semantics. Stable consumer identity is sufficient for the current lifecycle;
future multiplicity needs a deliberate migration, not speculative schema today.
