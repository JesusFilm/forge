# PR #2783: exact-head CI localization repair

Repair parent and lease: `3efaf3812f4be49f5d874e26d042d44e6c7e952c`. Remote matched before work. Runtime/application files, flags, schema, migrations and all prior repairs are unchanged. feat-744 remains complete.

## Web diagnosis and repair

[Run 40158788098, Web job 121065976865](https://github.com/JesusFilm/forge/actions/runs/40158788098/job/121065976865) fails at `WatchRoleJourney.test.tsx:464`: the questionnaire exists, but the selected Scripture blockquote is absent. The test guessed that the real `next/dynamic` Grow import and its cold transforms would finish within 100ms. Its enclosing Suspense legitimately renders an empty fallback until that import completes.

The exact CI command, `pnpm --filter @forge/web run --if-present test`, reproduces the same sole failure locally: 7,032 pass, 13 environment skips, one todo. Node is pinned to CI's 24.22.1 (downloaded from the exact actions/node-versions artifact identified in its log), pnpm is 9.12.3, `CI=true`, all four repository `.env.ci` files temporarily replace local `.env` files and are restored, and four visible CPUs preserve default parallel worker selection. Evidence-only egress instrumentation blocks external TCP/UDP and local telemetry agents.

The repair awaits `vi.dynamicImportSettled()` inside React `act`, preserving the actual dynamic import and rendered component. It queries the authored Arabic question heading and its section, and the English Scripture heading and associated named section. Explicit element presence, exact selected Arabic text, Arabic/RTL question/passage attributes and English/LTR resource attributes all remain asserted. There is no sleep, assertion retry, module mock or timeout increase.

Validation:

- Ten fresh-process runs of only the cold localization case, plus ten fresh-process runs of its complete 24-test file: 250 tests passed, no failed run. A further 24/24 pass after installing the previously missing Mastra workspace dependencies for the separate Admin check.
- Exact full Web CI command: **7,033 passed**, 13 environment skips, one todo; 347 passing files.
- `pnpm --filter @forge/web lint --max-warnings=0` and `pnpm --filter @forge/web typecheck`: passed.
- Real production localization browser suite: **16/16**, zero retries, 1280px/390px, Arabic/Spanish Scripture, English fallback/missing metadata, continuation/Share titles, mixed English resources, localized controls, portal labels/focus/keyboard and valid local media playback.
- Existing shared browser fence remains unchanged: Mux/all external telemetry and external POSTs are blocked, media is fulfilled locally, first-party measurement/actions are fenced, and response-peer assertions remain empty. Only disposable local producer data is used.
- Admin `schema:print` and admin-graphql `generate` pass with zero SDL/introspection drift. Feature-flags tests pass 23/23 and `forge.watch.audience` retains `defaultValue: false`.

No production build or loading work is introduced by this test/docs-only change. The prior production build is reused for browser coverage. All 17 hashes in the retained round-4 performance evidence manifest still match; the [round-4 measurements and limitations](2026-10-24-pr2783-review-r4-validation.md) remain applicable. No new external-media corpus is run.

## Separate Admin annotation

[Admin job 121065976692](https://github.com/JesusFilm/forge/actions/runs/40158788098/job/121065976692) successfully prints the schema with no artifact diff and applies all 168 migrations. Its later `test:precomputed-integration` command records one 5,008ms test timeout at `tests/integration/precomputed-catalog-build.db.test.ts:483`, with 62 other cases passing. The aggregate ci-gate reports this and the Web failure; it is not a third root cause.

The failing test, native integration fixtures/configuration, Admin recommendation services, Mastra catalog/retention code, Prisma schema/migration chain and DB client have no diff between exact main `02ecc6be8d34af143e5975156b78d2e46a9e3406` and the repair parent. Admin env additions are the audience release-gate fields, unused by this native path. The test's GA/model transports are synthetic/in-process and no live GA or model is called.

Comparison uses exact-main and candidate source checkouts, Node 24.22.1/pnpm 9.12.3/Vitest 3.2.4, PostgreSQL 18, the CI opt-ins/synthetic keys, four visible CPUs, and separate owned loopback clusters with CI's required `forge_precomputed_control_test` database name. Both fresh databases apply **168/168 migrations** and report up-to-date status. The unchanged exact `pnpm --filter @forge/admin test:precomputed-integration` command passes **63/63 on each source**. The target case takes 1445ms on main and 1598ms on candidate in these complete runs.

Three additional runs per source/condition alternate source order. Loaded runs add one competing CPU worker on each of the same four CPUs for the duration of that run. All twelve target runs pass with the existing 5,000ms limit; no results are excluded. Target-body timings, minimum / median / maximum milliseconds:

| Condition | Exact main         | Candidate          |
| --------- | ------------------ | ------------------ |
| idle      | 1881 / 1918 / 2038 | 1819 / 1831 / 1882 |
| loaded    | 1917 / 1972 / 2011 | 1882 / 1894 / 4292 |

The candidate's 4292ms loaded tail is retained in these results; its scheduling cause is unproven and it remains close to the unchanged five-second limit.

This is an inherited timing-sensitive test, with no demonstrated PR-caused recommendation regression. The original CI timeout is retained; these local controls do not reproduce it or prove the specific runner/DB scheduling stall. No recommendation implementation or timeout is changed. Fresh CI will rerun the native suite after this push.

## Harness corrections, evidence and limits

Initial local setup failures are retained separately: `/tmp` ran out of inodes before DB tests began; moving only owned stopped PostgreSQL data to workspace storage preserved every file hash and the original path via symlink. The filtered install initially lacked Mastra dependencies; an offline frozen-lockfile install restored them without source/lock changes. A uniquely named database was correctly rejected by the native fixture authority guard, so that invalid full-suite attempt was stopped and replaced with separate clusters using the exact required name. No guard was bypassed. Baseline ignored dependency links are restored after comparison.

Evidence: `/home/lado/.local/share/forge-pr2783-ci-fix-20261025/`, including full CI logs, CI-command red/green logs, all focused runs, strict-check/generation receipts, browser log, `admin-controlled-results.json`, `admin-controlled-summary.json`, migration counts/statuses, diagnostic setup logs, retained-performance hash check and service cleanup receipts. Source checkout and runtime/env values match the stated CI inputs; this Linux host is not a clone of GitHub's Ubuntu runner image. The modest controlled timing sample does not guarantee the inherited test will never time out in CI.

All owned Web/producer/PostgreSQL services stop after validation. No importer CLI, live publication/import, external configuration change, deployment, merge or production mutation is performed.
