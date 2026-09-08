# Second CI: bounded mobile timing and profile fixture repair

Fixed base: `009cad4283515fb823568473f6a1ee6026aae9a1`. Root supplied actual run 34283722315 failures: mobile job 102254581297 (2965 passed, one failed) and Admin schema job 102254581035 (the next two profile fixture cases failed with `42P01`). This follow-up contains test changes only, plus plan/evidence. Product queries, migrations, timing constants, controls and publication/transcript contracts remain unchanged.

## Mobile intermediate-state race

PlaybackHost source and test are identical between reviewed main `1ce69015` and the fixed base; no mobile or lockfile changes occurred from `56258cff` to `009cad42`. The failing top-corner test came from `21424b99` (#1980); exit completion/cleanup came from `068912df` (#1962).

The test used real timers, awaited dismissal, then inspected the transient `playback-exit` node. The existing 220 ms animation or 470 ms fallback completes dismissal and removes that node. CI found an exit animation call but no frame at the subsequent assertion. The trace alone does not identify which completion path won.

A temporary observation delay using Node's real timer reproduced the exact `undefined.props` failure at helper line 374 (one failed, 86 unselected). The inert `mobile-race-probe.patch.txt` records that probe. With only fake timers added before mount, the **same delayed observation** passed (one passed, 86 unselected), demonstrating control of the intermediate-state race. The diagnostic delay is removed from final source. The affected case alone now freezes time, retains the original animation target/opacity/translation assertions, checks `exiting`, advances the existing deadline and asserts session null and frame absent. Existing afterEach unmounts and restores real timers. No timeout increase, animation stub or product change.

The final seven dismissal cases pass (80 unselected). The aggregate CI worker forced-exit warning is not attributed to this case and is not claimed fixed. No full mobile suite, native build or performance run was repeated.

## Profile visibility fixture completeness

The exact two files reproduced two passed/two failed, both failures being missing `studio_catalog_release`. Like the repaired delivery fixture, these create isolated schemas but omitted three relations referenced by the canonical profile query. Each deterministic fixture now defines the minimal `studio_project`, `studio_catalog_release` and `studio_publication` read model. The candidate snapshot branch explicitly creates views onto the real public relations; no empty substitute or public search-path fallback is introduced.

Both files now pass all four cases. The candidate retrieval test additionally checks staged denial, receipt-with-draft denial, published inclusion, revoked denial, and continued Core inclusion using the actual profile retriever. This is a synthetic read-model fixture, not canonical publication-command or production-snapshot acceptance.

The bounded caller/fixture inspection covered direct `getLiveProfileCandidates`, semantic delivery and `studioPublicReleaseSql` consumers, plus delivery.factory callers and the CI schema-step sequence. The custom content schemas reaching those retrieval predicates are the delivery fixture (already repaired) and these two profile fixtures. `search-watchability.db.test.ts` uses the migrated database client, not a custom schema; video-mapper/Studio catalog/transcript-publication tests use their full database fixtures. Remaining recommendation migration/state fixtures do not invoke this retrieval predicate through a custom content schema. No additional omitted relation was found in this inspection; unrelated suites were not audited or rerun.

## Validation and provenance

Frozen mobile installation first failed because an exact Expo tarball was absent offline, then passed from the normal registry with lifecycle/Husky hooks. The lockfile is unchanged. Focused execution uses the existing owned network-namespace harness, rootfs TMPDIR, denied default ports 5432/6379, private loopback and owned disposable Postgres on 55463. No shared DB/Redis, provider or deployment operations occurred.

Changed-file Mobile/Admin ESLint and both package typechecks pass; raw command/results are retained. No application build is required for these test-only corrections. Existing candidate timing logs describe deterministic fixtures, not production performance. Independent fixed-base Standards/Spec review and normal hook results accompany the implementation-only commit. Full Studio release gates remain unchanged; root owns subsequent push and CI confirmation.

Standards review: no actionable source findings; evidence review required confirmation of the pending Admin typecheck before commit. Spec review: no actionable source or evidence findings, with the same pending-check qualification. The final combined lint/type command has now exited 0, recorded in `mobile-profile-checks.json`. Both reviewers were read-only and reran no checks.
