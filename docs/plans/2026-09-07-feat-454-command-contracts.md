# feat-454 execution scope

Implements the confirmed Studio brief and the feat-454 slice of
`2026-09-07-001-feat-studio-video-authoring-plan.md`. Prerequisite: incorporate
feat-453's reviewed implementation and confirm its runtime/export identities.

## Agreed test seams

The delegating request explicitly selects neutral contracts and shared command /
real database seams for TDD. Exercise commands through the same Admin service used
by adapters; use independent Prisma connections against disposable local Postgres.
Test publication through an internal transaction seam, without a public publish
operation. No production migration, provider call, or paid generation is involved.

## Design

- Runtime-neutral Zod package: bounded flexible composition, durable media/code
  references, editable component declarations, operations and command envelopes.
- Admin project row serializes compound commands within a held transaction lock.
  Revisions are append-only snapshots. Attempts and approvals have their own state
  and immutable input identity. Expected revision is mandatory for writes; create
  uses an explicit zero base revision.
- Retry identity includes actor, command and validated input. A reused key with
  different input is a conflict. Attempt admission commits before any external work.
- Script approval follows effective spoken dependencies. Every edit invalidates
  publication approval and old render eligibility. Stale results remain recoverable
  without overwriting the current composition.
- Publication's permanent latch is protected in the command transaction and DB.
  The internal seam requires the future catalog verifier in the same transaction;
  GraphQL/Manager expose no publish operation before feat-460.
- Adapter authentication supplies attribution; payloads cannot claim another human.
  Service/background identities cannot manufacture human review approvals.

## Verification and completion

Record each meaningful red/green command test, real Postgres race and retry results,
package typechecks, generated Prisma/Pothos/SDL/introspection, relevant full suites,
format/lint and independent Standards/Spec code review. Capture durable findings,
mark the roadmap complete only with evidence, and commit locally without pushing.

## Validation record

- Incorporated prerequisite implementation `76faac18` as `ebd9b7bf`; no unresolved
  feat-453 gate. Production launcher constraints remain assigned to feat-460.
- Dedicated local PostgreSQL 18: `127.0.0.1:55454/forge_studio_454_test`, initialized
  from scratch. All 81 migrations applied, including one additive Studio migration.
- Twelve command/database/GraphQL tests pass. Independent client races, durable
  retry admission, revision history, human approval, late completion and database
  immutability are exercised with real SQL, not persistence doubles.
- Neutral contracts: 3 tests pass. Manager: 150 files / 1,168 tests pass. Manager
  production build passes. Studio operation strings are absent from browser chunks.
- Admin full suite: 393 files / 6,083 tests passed; 2 failures were isolated.
  SEO's large-report test passes with one worker (full run timed out under load).
  Auth Redis fallback expects no reachable Redis, but local Redis is running;
  its 8 tests pass in `unshare --user --map-root-user --net` without touching Redis.
- After helper/access cleanup: focused Studio + permissions suites pass 147 tests.
- Studio, Admin, Manager and admin-graphql typechecks pass. Prisma validation,
  touched source lint and neutral import smoke pass; smoke loads no React/Prisma/
  provider runtime. admin-graphql's test script reports no test files, exit 0.
- Prisma/Pothos, Admin SDL and gql.tada introspection generated with package scripts.

## Review

Standards: two minor deviations (direct test environment access and untyped test
errors) were fixed, together with duplicated render eligibility checks. Follow-up
review reports no remaining findings. Spec: no actionable findings or scope creep.
Final focused verification after these fixes passes all 147 Studio/permissions tests.
Generated SDL/introspection are reproducible with no diff. The Prisma current
revision relation explicitly maps the migration's deferred foreign-key name.

## Reproduction commands

Run from the repository root. The database URL below authorizes only the disposable
local cluster initialized for this work; the test refuses other hosts/database names.
The cluster was initialized from scratch and all 81 migrations applied using:

```sh
DATABASE_URL=postgresql://tataihono@127.0.0.1:55454/forge_studio_454_test pnpm --filter @forge/admin exec prisma migrate deploy
STUDIO_TEST_DATABASE_URL=postgresql://tataihono@127.0.0.1:55454/forge_studio_454_test pnpm --filter @forge/admin exec vitest run src/services/studio-authoring/commands.db.test.ts src/auth/permissions.test.ts
pnpm --filter @forge/studio-contracts test
pnpm --filter @forge/manager test
pnpm --filter @forge/admin test
pnpm --filter @forge/admin exec vitest run src/services/seo-experiment.service.test.ts src/auth/rate-limit.test.ts --maxWorkers=1
unshare --user --map-root-user --net pnpm --filter @forge/admin exec vitest run src/auth/rate-limit.test.ts
pnpm --filter @forge/studio-contracts typecheck
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/admin-graphql typecheck
pnpm --filter @forge/admin db:generate
CI=1 pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/admin exec prisma validate
pnpm --filter @forge/admin exec eslint src/config/env.ts src/services/studio-authoring src/graphql/types/studio.ts src/auth/permissions.ts
pnpm --filter @forge/manager exec eslint src/backend/studio-client.ts src/backend/studio-client.test.ts src/backend/admin-client.ts
pnpm --filter @forge/studio-contracts lint
CI=1 pnpm --filter @forge/manager build
pnpm format:check
```

## Public module surfaces and downstream boundaries

- `@forge/studio-contracts` exports its Zod schemas and inferred types from `.`:
  actor/lifecycle, durable assets, components, source selection, transforms, speech,
  timeline/tracks/documents, operations, command envelopes/results, requests,
  starts/completions, attempts, approvals, project summaries and revision history.
- Admin's `src/services/studio-authoring/index.ts` exports `StudioAuthoringService`
  and `StudioCommandError`. Its public command/read methods share the same guards.
- Manager's `src/backend/studio-client.ts` exports `createStudioAdminAdapter`;
  `AdminGraphqlClient.studio` uses the existing authenticated Admin transport.
- Generated tracked artifacts: `apps/admin/schema.graphql` and
  `packages/admin-graphql/src/admin-graphql-env.d.ts`. Prisma/Pothos generated
  outputs are regenerated locally using the existing ignored-output convention.
- `publication.ts` is an internal required-verifier transaction seam, with no
  public publish operation. Asset registry resolution (455), human UI/agent
  transport (456/457), provider orchestration, catalog checks and production
  rendering/publication (460) remain assigned to subsequent tickets.

No feat-454 gaps remain. No push, deployment, production migration or generation
provider call was performed.
