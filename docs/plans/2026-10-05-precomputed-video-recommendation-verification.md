# Precomputed recommendation verification and handoff

This record preserves the implementation, review, validation, and recovery history.
For current ownership and execution state, use the [orchestration ledger](2026-10-05-precomputed-video-recommendation-status.md).
Historical entries describe their stated revision and are not claims about later work.

Updated: 2026-10-06 (Pacific/Auckland).

## Integration ownership

- Parent: https://github.com/JesusFilm/forge/issues/2565; roadmap: feat-590.
- Orchestrator chat: `01a109d7-dc1c-7600-a2c4-07dee79b4aff`.
- Repository: `JesusFilm/forge`.
- Initial base: `d661b99939e24ba41834adce53c6bad9262bcee9` (fresh `origin/main`).
- Integration branch: `codex/precomputed-video-recommendations`.
- Integration checkout: `/home/nisal/.codex/worktrees/precomputed-video-recommendations/forge`.
- Draft integration PR: https://github.com/JesusFilm/forge/pull/2578.
- Initial documentation commit: `c0cf907a2a4089019e92c831b41b495acf93eae3`.
- Saved project: `d0b6bf54-7c60-41f9-bb54-41a55e704a79`, Forge on
  `remote-control:env_e_6ab0824a79ac832e92a3a2f0a40374bb`.
- Task-owned planning documents and only the seven recommendation glossary
  additions were ported from the original dirty checkout. Unrelated edits remain
  there untouched. Current main includes the compact recommendation formats.

The orchestrator exclusively owns integration, this ledger, roadmap status,
and the single integration PR. Workers own their assigned ticket branch and
isolated worktree. No duplicate ticket ownership and at most two active workers.
Implementations are GPT-6 Sol chats (`gpt-6-sol`); the application model remains
`gpt-6-astra`. Use Matt Pocock's exact implement/TDD/code-review skills and the
approved testing boundaries. Compound Engineering skills are prohibited.

## Execution ledger

All issues, comments, readiness labels, native parents, blockers, and reverse
blocking relationships were fetched and verified on 2026-10-05. All ten issues
are open, labelled `ready-for-agent`, and have no comments at kickoff.

| Issue | Blockers     | State                            | Worker / branch                                                | Integrated commits / evidence                  |
| ----- | ------------ | -------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| #2566 | None         | Integrated-and-verified          | `01a109e1-47c8-7043-bfd4-a85592cfafc5` / `codex/feat-590-2566` | `9a984c544`; evidence below                    |
| #2567 | #2566        | Integrated-and-verified          | Same Sol chat / `codex/feat-590-2567`                          | `c89db0e4e`; evidence below                    |
| #2568 | #2567        | Fixture integrated; live blocked | Same Sol chat / `codex/feat-590-2568`                          | `b1703cd8c`; partial evidence below            |
| #2569 | #2568        | Waiting for prerequisites        | Unassigned                                                     | None                                           |
| #2570 | #2566        | Integrated-and-verified          | `01a10a28-aa8e-7080-b3d1-c59293f8f4dd` / `codex/feat-590-2570` | `0a93244a3`; evidence below                    |
| #2571 | #2570        | Integrated-and-verified          | Both Sol chats; scoped fixes below                             | Corrections in `a7f36d778`; evidence below     |
| #2572 | #2571        | Integrated-and-verified          | Same Sol chat / `codex/feat-590-2572`                          | `a7f36d778` plus UI follow-up in this revision |
| #2573 | #2572        | Implementing                     | Same Sol chat / `codex/feat-590-2573`                          | Starting at `af8eba415`                        |
| #2574 | #2569, #2573 | Waiting for prerequisites        | Unassigned                                                     | None                                           |
| #2575 | #2574        | Waiting for prerequisites        | Unassigned                                                     | None                                           |

Advance dependencies only on **integrated-and-verified** acceptance evidence.
Implemented, integrated, merged, and live are separate states. GitHub issues
remain open until the integration PR merges; no merge is authorized here.

## External inputs and operation boundaries

### Chat creation recovery

The native app catalog lists the remote Forge project above and its SSH alias
`447f8136-8b78-4338-b15a-fb0f1aeb39ff`. The plugin's `list_projects` returns an
empty catalog, and `create_thread` rejected both IDs as unknown. No chat was
created by either failed request.

To continue with an actual separate Sol chat, the orchestrator forked the idle,
completed `Prototype video recommendations` planning chat
(`01a108c2-8ae4-7e22-9f86-2713880072c9`) without modifying its source. The
new chat was titled `#2566 Inspect saved recommendations in Admin`, and its
first implementation message explicitly selected `model: "gpt-6-sol"`.
The worker created its own isolated checkout at
`/home/nisal/.codex/worktrees/feat-590-2566/forge` from the integration branch.
Its verified starting SHA is `c0cf907a2a4089019e92c831b41b495acf93eae3`.
This is an app-routing workaround, not an internal subagent or model substitution.

After #2566 verification, the same Sol chat was renamed
`#2567 Generate explainable source recommendations with Astra` and reused its
clean worktree on the new `codex/feat-590-2567` branch at `9a984c544`.
The prior branch/commit is preserved. A second fork of the same idle planning
chat created `#2570 Serve saved recommendations on private Watch previews`
(`01a10a28-aa8e-7080-b3d1-c59293f8f4dd`), again explicitly dispatched with
`model: "gpt-6-sol"` and instructions to create its own isolated checkout.
Its verified checkout is `/home/nisal/.codex/worktrees/feat-590-2570/forge`.

#2567 owns generation/producer contracts and reserves migration `0129`;
#2570 owns private Watch/Web/GraphQL/readers and reserves `0130` if needed.
#2567 exclusively owns `precomputed/contract.ts` while these tickets run.
Workers coordinate shared Prisma/environment hunks through the orchestrator
and serialize heavy Admin validation with
`flock /tmp/forge-feat590-heavy-validation.lock`.

#2570 subsequently confirmed it needs no Prisma model edits: it reuses the
existing compact request/snapshot/item lineage. It owns Admin
`RECOMMENDATION_PRECOMPUTED_PREVIEW_ENABLED` and Web
`WATCH_PRECOMPUTED_RECOMMENDATIONS_PREVIEW_ENABLED`, both optional/default-off.
#2567 owns generation input mode, source status/failure, and model-call usage
rows. After both are integrated, verify the reader requires complete generation
and complete source under the evolved schema; #2570 must remain buildable on
its captured `0128` baseline while `0129` is pending.

### Roadmap identity reconciliation

Current main already contained a completed fixture-maintenance ticket named
`feat-590`. To preserve the explicitly requested experiment identity and pass
the new-ID collision guard, that completed record was renumbered to the next
unused ID, `feat-609`, with its existing plan/report/index references updated.
Its completed implementation and evidence are unchanged. No experiment IDs or
GitHub issue identities changed.

### Pending live inputs

- At #2568, notify the user and walk them through historical GA warehouse
  identification and authorized access. Provider is provisionally BigQuery;
  project/dataset, schema, historical coverage, and Video mapping are unverified.
  Continue independent fixture work without claiming live ingestion.
- Verify application access to `gpt-6-astra` before any live model smoke.
- Trusted bot signals, measured human baseline, numeric stopping-rule agreement,
  Railway headroom/capacity evidence, and an actual first catalog cost report
  remain explicit live prerequisites.
- Keep public serving default-off and the incumbent available. No production
  deployment, merge to main, public A/B activation, winner promotion, recurring
  schedule, warehouse writes/exports, or destructive production reclamation.
- No tool permission setting has been changed. Workers use host permissions;
  full access must not be claimed without verification.

## Validation

Initial preparation contains documentation only. Explicit touched-document
`npx --no-install prettier --check`, `git diff --check`, and the normal
commit hooks (including full-repository `pnpm run format:check`) passed.
The documentation revision `4c1f27269dfb32e2fdaf389bec7d3e8abe90a52a` passed
`ci-gate`, format, commit lint, CodeQL, the roadmap ID collision guard, and other
applicable checks after publishing the identity correction.

### #2566 integrated acceptance

Worker commit `497289c762f5a25291b67c8e96108d486565cfe2` was integrated as
`9a984c544f3f2a612a7e21c17e94db702a944b25`. It adds authenticated idempotent
generation ingest, compact saved source sets, and the private Admin comparison.
Public Watch selection is unchanged. No GraphQL contract changed.

- Worker: 16 focused tests; 8,951 full Admin tests; TypeScript, scoped lint,
  Prettier, Prisma validation, and normal commit hooks passed.
- Browser: authenticated selector/one/zero states and unauthenticated redirect
  passed with canonical `english` audio; warm one-card development load ~456ms.
  Screenshots: `/tmp/forge-feat590-2566-browser/one-english.png` and
  `/tmp/forge-feat590-2566-browser/zero-english.png`. These are local fixture
  timings, not production performance estimates.
- Independent integration: Prisma generation, migration `0128` on PostgreSQL
  18, all 27 selected native/route/view/profile/lifecycle tests, and Admin
  TypeScript passed. Logs are under `/tmp/forge-feat-590-orchestration/` with
  the `2566-integration-` prefix.
- Standards review: service authorization/layering and real migration-backed
  fixture issues were corrected; no remaining scoped findings.
- Spec review: retry identity, incumbent labels, canonical audio selection,
  and source-cohort hash ordering were corrected; no remaining #2566 blockers.
  Source-set hashing explicitly uses JavaScript ordering, independent of DB
  collation. Every accepted edge persists; the display limit is six.
- CI on published head `3b2ea631a942c83d9bb4ad00491fcaf4f2e0ce4e` passed all
  applicable checks, including `ci-gate`, Admin build/test/lint, schema drift,
  formatting, commit lint, roadmap guards, and CodeQL.

### #2567 integrated acceptance

Worker commit `be9df0c959a5674d32e74052cd1f748ce53b1f07` was integrated as
`c89db0e4e1352435d29573d81cfa584eb52556e9`. It adds the bounded Mastra source
producer, pinned Astra Responses provider, authenticated catalog boundary,
and native build-to-Admin-review harness outside the app contexts.

- Worker: 3,218 full Mastra tests passed (37 skipped); 890 Admin recommendation
  scope tests passed (374 DB-gated tests skipped and affected native suites run
  separately); 16 final native contract/catalog and seven native build-to-review
  tests passed. Fresh migration reset applied all 130 migrations. Mastra build,
  Admin/Mastra typechecks, scoped lint, and normal commit hooks passed.
- Independent integration: migration `0129` on PostgreSQL 18, 23 Admin
  native/route/view tests, seven native build-to-review tests, three Mastra tests,
  and both Admin/Mastra typechecks passed. Logs use the `2567-integration-`
  prefix under `/tmp/forge-feat-590-orchestration/`.
- Standards review: test harness moved outside app contexts; authenticated
  bounded routes, safe errors, compact provenance, and explicit source failure
  are verified. No public Watch or GraphQL contract changed.
- Spec review: multilingual evidence, metadata field availability, sparse
  results, invented evidence, wrong-source/cutoff replay, failed-call usage,
  and a selected-input change after model judgment have native regressions.
  Final ingest repeats the observed-version fence. SDK retries are disabled.
- No live Astra call, warehouse history, actual cost, or production capacity
  claim. Current-row cutoff fences cannot reconstruct overwritten/deleted
  historical content. Combined-head CI findings at `0a93244a3` are recorded below.

The same clean Sol chat was explicitly dispatched with `model: "gpt-6-sol"`
for #2568 on `codex/feat-590-2568`, captured base `c89db0e4e`. It owns analytics
adapters/tools/provenance and reserves migration `0131`; the later #2571
assignment work reserves `0132`. At 05:05 UTC the user was notified that GA
access setup had been reached and asked to inspect the existing Watch GA
property's BigQuery link and provide non-secret project/property IDs. That
answer is pending. Fixture work can proceed; live-dependent acceptance remains
unverified until access and source discovery succeed.

### #2568 partial fixture implementation

Worker commit `696f1439d491b9c9c77ce5ba1afe72323c19609c` is integrated as
`b1703cd8ce58f761d99bae9688bd59a1a5bd9a04`. Its separate catalog CI repair
was already integrated and was not applied again.

- The source producer can require historical input, request bounded aggregates
  through model-selected candidate query plans, and save compact qualified
  coverage/provenance in Admin. A missing warehouse reader returns unavailable;
  fixtures cannot satisfy a default live historical build.
- Page counts, continuation job identity, query scope, canonical mapping, and
  result shape are validated. Query-level bytes are deduplicated across pages.
  Unknown mappings and bot/measurement overlap qualifications remain visible.
  Ambiguous source aliases fail until their warehouse mapping is verified.
- Worker: 8,954 full Admin and 3,218 full Mastra tests passed; 14 native build
  cases, four Admin view tests, two workflow tests, both typechecks, Prisma
  validation, scoped lint, and normal hooks passed. Full-suite DB-gated skips
  are not claimed as native evidence. Report and logs are under
  `/tmp/forge-feat590-2568-validation/`.
- Standards review found no hard violations. Spec review accepts the fixture
  boundary but leaves production source discovery and the real adapter incomplete.
- Independent integration: migration `0131` on PostgreSQL 18, 33 Admin tests,
  14 native producer tests, 58 route/resolver inventory checks, and three Mastra
  tests and both Admin/Mastra typechecks passed. Logs use the
  `2568-integration-` prefix.
- Browser follow-up `1339edbe5de9e1f5e3023c265e3d43137bcb6e34` is integrated
  as `acbe43fc7`. It wraps the three long provenance hashes. All historical,
  content-only, and failed states passed at 1440px and 390px; the full hashes
  remain inside the narrow cards. The orchestrator inspected the screenshots
  and independently reran all four view tests plus formatting after integration.
  Alternating warm content/history runs had median navigation times of 556/500ms,
  with the same 24 local resources, 18 scripts, and 6,300 transferred resource
  bytes. These are small local development fixtures, not production benchmarks.
  Final and no-screenshot runs reported no console/page/request errors; an earlier
  caret-style hydration warning was reproduced as a screenshot-tool artifact.
  Report, setup details, and screenshots are in
  `/tmp/forge-feat590-2568-validation/browser-report.md` and its directory.
- The browser worker removed its temporary seed script, local session cookie,
  isolated preview database, and automatic Next guide block, stopped its dev
  server, and preserved the clean branch. It is held for live GA access.

The user has not yet answered the GA access handoff. The authorized warehouse
location/service identity, provider/schema/history, bot semantics, and canonical
Video mapping must be verified before implementing the real aggregate adapter
and recording the qualified live smoke. #2568 is **not** integrated-and-verified
for dependency advancement; #2569 remains queued. No export or live-data claim.

### #2570 integrated acceptance

Worker commits `8a24e92dcaeecab2b896e86be853f0152f75d137` and
`e3ea04a4df2dec630a4a18a23eda25d4137cab12` were applied serially as integration
commit `0a93244a39f9ff841abdc6fc7c878b109a9762b2`. The worker's validation-only
copy of #2567 (`f66c63dad`) was not applied again. The integration commit uses a Conventional Commits title
because the baseline worker title did not satisfy the repository's CI rule.

- Saved delivery distinguishes absent/failed sources from valid empty results,
  checks current locale/publication/Watch/exact-audio availability, and retains
  all stored choices for filtering to the six-card display. Both generation
  and source must be complete under the combined `0129` + `0130` schema.
- Standards review fixed service authorization, unbounded DB reads, copied
  reasoning in snapshots, and typed-operation compatibility. The public query
  document remains unchanged; private fallback uses its separate operation.
- Spec review fixed authorization bypass after preview transport failure,
  total-budget fallback, and browser assertions that could pass before requests
  ran. Private recovery rechecks source eligibility in Admin before incumbent
  execution. Web shares its existing 3.5-second upstream deadline.
- Worker: 896 Admin recommendation tests, 498 Web recommendation tests,
  45 targeted route tests, six resolver tests, native delivery/producer cases,
  and four Chromium browser cases passed. Combined-schema native delivery
  passed six tests plus three reader tests. Admin/Web/admin-graphql typechecks,
  scoped lint/format, generated contracts, and normal commit hooks passed.
- Independent integration: migration `0130` on PostgreSQL 18, 36 Admin tests
  (two default-off cases separately rerun), seven native build-to-review tests,
  78 Web route/component tests, six default-off resolver tests, generated
  SDL/consumer drift check, and Admin/Web/admin-graphql typechecks passed.
  Logs use `2570-integration-` under `/tmp/forge-feat-590-orchestration/`.
- Browser evidence uses the existing synthetic player-shell fixture, not real
  playback or production performance. One-card local cold response/FCP/API
  start were about 2795/2984/3554ms; six-card warm values 174/360/1007ms.
  The worker recorded timing in its `apps/web/test-results/` tree;
  its retained report is `/home/nisal/.codex/worktrees/feat-590-2570/validation-2570.md`.

Both private serving flags and the migration-seeded manifest are disabled by
default. No public experiment or learning enrollment was activated. After normal
commit hooks passed, #2571 was dispatched to the same Sol chat from the verified
combined integration commit `0a93244a3`. The single draft PR has been updated and
pushed at that head. Its full Admin CI suite found two test integration gaps:
the private catalog route test relied on an externally supplied ingest key, and
the new preview resolver was absent from the exhaustive resolver manifest.
Both were returned to their owning Sol chats for isolated fixes. All builds,
other app suites, lint, schema checks, formatting, and CodeQL passed at that head;
the Admin suite and dependent CI gate require a new CI run after the repairs below.

The resolver repair's final worker commit is `ea429c618f2319c837ea08416a7eaff4be525608`;
its identical patch is integrated as `1c890d0fa` (picked from preliminary
`676534488` before the worker amended after installing the missing Husky launcher).
The final worker commit ran normal pre-commit and commit-message hooks. Independent
integration verification passed all 49 resolver inventory tests and seven delivery
resolver tests with the private flag unset. Authorization implementation is unchanged.

The catalog test isolation repair `e55a5114e0f8f58855cd6c7b44b301210225a423`
is integrated as `0667d0c10`. It supplies and restores its own authentication
environment before importing the real route, and asserts rejected requests make
no database transaction. Normal worker hooks passed. Independent combined
verification with both ingest-key and private-preview environment variables unset
passed all 58 route, resolver, and inventory checks. The repaired published head
`a7f48c55c9dfca26f3bf90980f59cdaa198f2fce` passed all 43 applicable CI checks,
including the full Admin suite and CI gate, with three non-applicable checks
skipped. This green result applies only to that head, not pending worker changes.

The subsequent published fixture integration head
`5eee29654a52b041678643eb4d23574c197e29b2` passed all 43 applicable CI checks,
with five non-applicable checks skipped. This includes #2568's fixture-only
implementation and browser layout repair; it does not certify live warehouse
access and does not cover #2571.

### #2571 initial integration (acceptance reopened)

Worker commit `6b4268d20f0afefbc0926d7dea1ed5b10a57d8d0` is integrated as
`267a6528170d56b1be0a36cbd18d2359d5c7acae`. Follow-up worker commit
`f5f616f8951eee97b0fb830d9c143b8b86834855` is integrated as
`b69592b6c3265683e87eb44f304e95fa7137558e`. Its two prior CI dependency commits
were not applied again. Both corrections and combined checks passed before
#2572 was dispatched from the verified `b69592b6c` integration state.

- Private admission persists a visit before delivery, freezes generation/cohort
  and control routing, and retains ordinary control personalization while
  suppressing nested experiment enrollment. Retries bind their issued requests
  to the same visit. Failed saved output, empty results, and fallback stay in the
  assigned denominator.
- The initial signed browser identity derives deterministically from consent credentials
  for concurrent first requests and lost-response retries. A durable cookie is
  issued only after Admin verifies active consent; withdrawal fences subsequent
  recording. The visit UUID travels in a header, preserving the ordinary body
  contract for older servers.
- Migration `0132` adds narrow experiment, visit, and request-lineage records.
  Raw visits expire after 29 days and participate in the existing bounded
  retention runner; frozen configuration is retained longer for audit.
- Worker evidence: 18 native PostgreSQL tests, 22 retention unit tests, 133
  focused Web tests, five Watch browser tests, and the full Admin suite
  (8,973 passed, 753 skipped, one todo). Admin/Web/admin-graphql typechecks,
  scoped lint, and normal hooks including repository-wide formatting passed.
- Independent combined checks passed migration `0132`, 41 native/Admin cases,
  14 build-to-review cases, 59 default-off contract regressions, 124 Web cases,
  all three typechecks, and regenerated SDL/consumer drift verification.
- The standalone retention suite passed all three cases on a fresh owned
  PostgreSQL 18 database: loaded backlog progress, rollback, and timeout
  accounting. That disposable database was removed after verification. This
  is not the precomputed physical-capacity proof required by #2574.
- The combined lifecycle run found two legacy fixtures missing the new tables.
  Their isolated schema now uses the full actual migration chain. Review also
  moved the Admin experiment-list query into a permission-checked service,
  with native authorized/unauthorized coverage. After the corrections, all 48
  final native/retention tests passed (including the full eight-case lifecycle
  file), and the combined Admin typecheck passed again.
- Separate Standards and Spec reviews passed against `0a93244a3` after the
  service-boundary correction. The report is
  `/home/nisal/.codex/worktrees/feat-590-2570/validation-2571/standards-spec-review.md`.
- Browser artifacts are in
  `/home/nisal/.codex/worktrees/feat-590-2570/validation-2571/`. The orchestrator
  inspected the Admin screenshot and timing/header artifacts. Synthetic Admin
  diagnostics returned 200 with 300ms FCP; synthetic Watch cases preserved retry
  identity and changed it on source navigation. These are local fixtures, not
  full authenticated configuration flow, real playback, or production capacity.

Public flags remain off. Trusted edge bot qualification and production cookie
forwarding remain unverified launch gates; Admin labels the counts as private
observations. Durable CTR and loaded storage proof belong to #2573 and #2574.

CI at published head `a242ecc44` found one more partial fixture in the
deterministic profile-candidate retention test; the other 41 checks passed.
The owner audited every native purge caller and found no further partial
runtime fixture needing repair. Worker commit
`5fce61dbdc01e3ca3d05fe3a18f5a1ca23c4b75d` is integrated as
`ab45ef328f241ce84229f3422ebf76426d9dc5d7`: it installs the actual precomputed
migrations after the fixture's catalog is available, preserving foreign keys.
Production cleanup and authorization are unchanged. Normal worker hooks and
root scoped formatting passed; independent execution of the exact CI
profile-candidate/profile-projection pair passed all 20 native tests. Published
head `ab45ef328` then passed all 43 applicable CI checks, with three skipped.
The same worker is now implementing #2572;
this repair is an already-integrated dependency, not a second click change.

### Cross-ticket review corrections

A second sequential Standards/Spec review at `ab45ef328` reopened #2571
acceptance before #2572 completion. Prior passing test results remain valid
for their stated code revision, but two requirements need correction:

- The active personalization-receipt gate excludes no-receipt and
  personalization-disabled viewers from private experimental analytics. That
  conflicts with the current analytics policy: profile use and learning must
  respect viewer controls, while contextual recommendations and product
  analytics require no prior consent. Worker B owns the admission, identity,
  and click correction on its current #2572 branch. The orchestrator's earlier
  blanket private-selection consent-fence guidance was withdrawn.
- The live retention-health query omits overdue precomputed visit and
  configuration roots even though the purge runner detects them. Worker A
  owns the health query and native regression on
  `codex/feat-590-2571-retention-health`, starting from `ab45ef328`, preserving
  its held #2568 branch. This is not #2574 physical-capacity work.

Both corrections are integrated and verified before advancing #2573.
The separate #2572 trace-permission finding is also corrected:
aggregate-only editors must not receive individual card/visit traces.
GA access remains pending; neither review nor these fixes advance #2569.

Worker A's retention correction `c85dd42c17fe5729426d7454e78779437b194a67`
and follow-up `f37bdc4ec97ebaa41ad5ceb6f32ed8c0e584e9ce` are integrated in
this revision. The health query includes overdue visits and expired
configurations with no remaining visits, matching the purge rules. Both native
regressions failed before the fix and passed afterward; each also verifies
recovery to healthy after draining the remaining row.

GitHub rejected the first local integration commit because the OAuth credential
lacks workflow scope; no new commit reached the remote. The follow-up moves
both regressions into the existing CI-run `retention-standalone.db.test.ts`.
The net workflow diff is empty. Only the unpublished local integration commit
is replaced; published history is preserved. Independent verification on a
fresh owned PostgreSQL 18 database, fully migrated through `0133`, passed all
five standalone cases and 22 retention unit tests. Logs use the
`2571-retention-existing-ci-` prefix under `/tmp/forge-feat-590-orchestration/`;
the disposable database was removed after the successful run.

Worker A also passed existing native profile-tail (2), composition (14), trial
(1), standalone (3), and profile-candidate (4) cases, Admin typecheck, scoped
lint/format, CI YAML parsing, normal hooks, and separate Standards/Spec review
with no findings. Two historical non-CI study fixtures fail in setup on stale
promotion-pointer columns before reaching the modified query; they are not
counted as passing native evidence. The worker is held for the pending GA
handoff.

Worker B's correction removes the receipt prerequisite while retaining profile
learning controls. It uses a signed anonymous browser unit, adds a random
per-session nonce to separate invitation exchanges, and rejects older private
sessions without that nonce. Existing frozen eligibility v1 configurations
must be recreated under v2; earlier excluded rows are not reinterpreted.
Migration `0133` relaxes only the eligible-visit receipt CHECK and preserves
the legacy nullable column; new visits leave it empty. The combined native
tests verify no-receipt and personalization-disabled admission without profile
learning, wrong-browser rejection, old-policy rejection, and stable assignment.
Grant/withdraw preserve the anonymous unit; reset/delete clear both the browser
and private tester cookies.

### #2572 combined verification

Worker commit `2c3e26e086b1c8c67bb6901fac66114ba753a9d7` is integrated in
this revision. Its previously integrated `5fce61dbd` dependency is excluded.
The existing accepted selection is the authority: request/item/visit bindings
produce distinct clicked-visit counts without adding another event stream.
Multiple card clicks and replay contribute one clicked visit. Missing
impressions do not exclude legitimate clicks; impression-based card CTR remains
separate. Actual request strategy and matched fallback lineage drive card
diagnostics. Aggregate-only editors cannot read individual card traces.

- Worker evidence: 29 native delivery/click cases, 18 native playback cases,
  8,974 full Admin tests, 4,766 full Web tests, 40 targeted private/select/profile
  Web cases, all three typechecks, generated contracts, scoped lint, normal
  hooks, and separate Standards/Spec review passed. Fixed-clock tests separate
  same-second invitation exchanges and reject legacy/tampered private sessions.
- Independent integration: 70 native/Admin cases, the exact 20-case
  deterministic profile-candidate/profile-projection CI pair, 89 default-off
  contract/episode regressions, 109 Web cases, Admin/Web/admin-graphql typechecks,
  and regenerated SDL/consumer drift checks passed. Logs use the
  `2572-integration-` prefix under `/tmp/forge-feat-590-orchestration/`.
- Event-write evidence: two accepted rows for two cards, no additional replay
  row, no selection POST on initial render, and one keepalive POST for a
  supported modified activation. Auxiliary-tab playback claims and lost
  browser events are explicitly unobserved rather than fabricated.
- Watch browser timing is at
  `/home/nisal/.codex/worktrees/feat-590-2570/forge/apps/web/test-results/precomputed-watch-preview--64513--shell-with-timing-evidence/precomputed-watch-timing.json`.
  One-card cold FCP was 2,624ms, with the recommendation request at
  3,244–3,251ms; six-card warm FCP was 348ms, with the request at 931–937ms.
  These are synthetic local development fixtures, not production capacity.
- UI follow-up `9f62f1f3ac6ded192558a1419e35f9af80382758` fixes missing prose
  whitespace and table cell spacing. Baseline, populated, and aggregate-only
  synthetic Admin states returned HTTP 200 at 1440px and 390px. All tables
  scroll inside their cards with no document overflow; the aggregate-only view
  hides card traces. The orchestrator inspected the wide/narrow screenshots,
  scroll records, and loading measurements. Artifacts are under
  `/tmp/forge-2572-admin-browser/`, including `summary-final.json`.
- Comparable warm local fixture runs measured median baseline/populated FCP of
  168/208ms initially and 148/180ms after the final spacing correction. Both
  used 23 same-origin resources and 6,000 resource-transfer bytes; populated
  diagnostics added approximately 1.9KB of document transfer. Eleven localhost
  Next HMR WebSocket handshake failures were logged; no other page, console,
  or request failures were recorded. This is rendering/loading evidence, not
  authenticated-flow or production-capacity proof. Temporary preview source
  and generated guide changes were removed. Scoped lint/format, Admin typecheck,
  and normal worker hooks passed after the view-only correction.

The combined code was published as `a7f36d7787db5bdd89b999fc33315a577a025d33`
without any workflow-file change; the earlier rejected local revision never
reached the remote. CI is tracked per published head and remains separate from
the local acceptance evidence above. The view-only follow-up and this ledger
complete #2572's scoped acceptance; #2573 is ready for dispatch after this
integration commit.

A separate Sol chat reviewed the pinned `a7f36d778` snapshot against initial
base `d661b99939e24ba41834adce53c6bad9262bcee9`, with sequential Standards and
Spec axes. Both returned zero confirmed findings. This preliminary whole-branch
review excludes the already owned spacing fix and the explicitly unfinished
live inputs and later tickets. It is not final acceptance of the full parent
spec. Delivery-link failures still cannot quantify lost click attribution;
the private report labels measurement loss unobservable.

The final UI/ledger integration is `af8eba415f99046e003429f25d367adde5565b8b`.
The preceding `a7f36d778` published head passed all 43 applicable CI checks,
with five skipped. Normal hooks and scoped formatting passed for the final
view-only follow-up; CI for each newer head is tracked independently.
The `af8eba415` head subsequently passed all 42 applicable CI checks, with six
skipped, including a successful CI gate.

After #2572 acceptance, the same Sol chat was explicitly dispatched with
`model: "gpt-6-sol"` for #2573 from `af8eba415`. It owns durable CTR policy,
measurement compaction, evaluation revisions, Admin/authorized-AI reads, and
their tests on `codex/feat-590-2573`, preserving its earlier branches. Migration
`0134` is confirmed reserved and next unused. The other Sol chat supplied a
read-only check of cluster-delta moment sufficiency and expiry/replay invariants;
it has no implementation ownership and no one else is editing schema. Human baseline,
agreed numeric stopping settings, and trusted live measurement remain external
acceptance inputs; fixture outcomes cannot certify a live winner. GA access
remains pending, so #2568 live and #2569 are not advanced.

An isolated PostgreSQL 18 integration database is running in
`forge_feat590_integration_db` on loopback port `32810`. It is reserved for
independent combined checks after worker commits are integrated. The #2566
worker moved from PostgreSQL 16 to PostgreSQL 18 for its final validation and
removed its disposable databases after completion.

The unchanged integration baseline successfully applied all Admin migrations
through `0127` to its separate `forge_preview` database on PostgreSQL 18.
Baseline native profile/lifecycle verification on the blank `forge_test`
database passed 10/11 tests. The final historical fact-index fixture fails at
`migration.lifecycle.db.test.ts:932` because `recommendation_request` is missing;
this predates the implementation: that standalone test assumes an already
migrated public schema. All eight lifecycle tests pass on the fully migrated
integration database. No production lifecycle regression was found. Baseline log:
`/tmp/forge-feat-590-orchestration/baseline-lifecycle-tests.log`.

The host briefly reached 321MB free during validation. Pruning regenerable
pnpm metadata/unused packages and unused Docker builder cache restored about
5GB of free space. No images, containers, database volumes, checkouts, or source
were removed by the orchestrator. Keep heavyweight builds serialized if space
becomes constrained again.

During #2572 validation, the worker's independent profile-scale fixture reached
the local disk limit. The orchestrator dumped and recreated only its idle,
disposable integration PostgreSQL container, then restored both databases and
verified all 133 migrations through `0132`. This recovered approximately 1GB
of preallocated WAL space; the replacement uses a smaller local WAL reserve.
No worker database, source, evidence artifact, or production data was removed.
The deferred scale run subsequently passed all 20 cases on the combined branch
after the identity and migration corrections, as recorded above.

## #2573 work-in-progress review checkpoints (2026-10-06 Pacific/Auckland)

Worker B starts from `af8eba415f99046e003429f25d367adde5565b8b` and owns
migration `0134`. Worker A provided bounded read-only mathematical and concurrency
reviews; these checkpoints do not replace final Standards/Spec review or native
integration checks.

- An initial normal-interval helper incorrectly certified a challenger with
  only three one-visit browsers per arm (control 0/3, challenger 2/3). The worker
  reproduced it red and changed to versioned cluster-delta Student-t intervals;
  A verified the revised case stays inconclusive. The conservative degrees of
  freedom rule is an approximation, not a finite-sample coverage guarantee.
- A second helper counterexample uses impossible one-visit moments. With
  `m=n=qnn=50`, necessarily `qcc=qnc=c`; the initial inequalities nevertheless
  allowed control `c=10,qcc=10,qnc=20`, changing a valid inconclusive result into
  a challenger result. It was returned for a guard/test. SQL-derived valid
  per-browser counts may already prevent it end-to-end; do not overstate it as
  an observed production result.
- Root found independently capped retention populations could lose attribution:
  batch size one, an older empty visit, and a newer expired clicked visit with a
  request. Ordinary visit cleanup chooses the empty visit, while request cleanup
  deletes the clicked visit's evidence. The worker is prioritizing linked roots
  within the bounded visit page and adding a native regression.
- The persistent private-request marker and shared experiment transaction fence
  must reject ordinary-path downgrade after a request link disappears, use fresh
  receipt time after lock acquisition, and serialize raw/archive snapshots.
- Existing CI `profile.service.db.test.ts` calls the shared evidence service
  while loading only the legacy runtime schema. Its fixture must include the
  actual new schema before the unconditional provenance read is valid.
- Report revisions must remain immutable, addressable, and bounded. Live bot
  qualification, tracking loss, measured baseline, and agreed numeric settings
  remain unsatisfied external criteria, even if fixture math passes.

The subsequent bounded core review against `af8eba415` found zero Standards
findings and one confirmed Spec finding: delivery summaries could change
fallback/recovery health after the fixed cutoff when final evaluation was
delayed. This was returned to the implementation owner for a cutoff gate and
native delayed-final test. It is not yet closed by integration verification.
The same review found the fenced cluster transfer and 33-revision capacity
internally consistent in its pinned snapshot; UI and AI routing were excluded.

The worker's 11:33 UTC checkpoint reported six standalone retention, three
profile-concurrency, four CTR-native, and 16 evidence-unit cases passing. The
orchestrator posted this as worker evidence, explicitly pending integration,
in [#2573 progress](https://github.com/JesusFilm/forge/issues/2573#issuecomment-5993698400).

## #2573 integrated private reporting and final verification

Worker source `acbb33fe45e6bf213df33878340d4fb32ae455e3` implements migration
`0134`, durable cluster/totals archive, immutable fixture policy and bounded
reports, shared evidence/retention fences, private request provenance, Admin
reporting, and the authenticated read-only HTTP contract. Follow-up
`302dffe31ee140022ff8a416087043b1cdbc5425` changes only two profile fixture
loaders to use the runtime base before the full precomputed chain. Root verified
application/package files exactly match that reviewed worker tree. The root's
additional operations-note edits clarify Admin OAuth-cookie authentication and
HTTP 200 report absence versus non-200 authentication/input errors.

All earlier WIP findings are resolved: small-cluster false certification,
impossible one-visit moment guards, request/visit retention batch disagreement,
post-cutoff delivery updates, private-link disappearance, stale timestamps after
fences, direct UI ORM reads, silent provisional-capacity outcomes, and invalid
policy forms for already-measured/closed/missing experiments. Native proof and
focused tests support the fixes; these are not claims of live experiment validity.

Root combination checks, logs under `/tmp/forge-feat-590-orchestration/`:

- `2573-integration-native.log`: 11 files, 89 precomputed/playback/profile/Admin-action cases passed.
- `2573-integration-profile-native-fixed.log`: two files, all 20 exact deterministic profile CI cases passed in 131.83s.
- `2573-integration-delivery-native.log`: 15 passed, one intentional skip.
- `2573-integration-regression.log`: seven files, 130 default-off Admin cases passed.
- `2573-integration-web.log`: seven files, 109 Web cases passed.
- `2573-retention-native.log`: all six existing-CI-entry-point retention cases passed on a fresh owned database migrated through `0134`; the fixture database was dropped after success.
- Admin, Web, and admin-graphql typechecks passed; SDL/client regeneration had no drift. `git diff --check` passed.

The first integration profile run failed because the standalone marker DDL was
followed by the full `0134` migration in those two fixtures. Root removed only its
failed synthetic schema `recommendation_u19_snapshot_1791204858642`; B fixed and
committed the two imports, then root reran all 20 successfully. Production DDL was
unchanged. The failure and repair logs are retained rather than hidden.

Worker full Admin suite: 568 files and 8,986 tests passed; 774 skipped and one
todo. Its initial full run found seven failures from one retention fake missing
a new delegate; the fake was fixed, its 22 cases passed, and the full suite was
rerun clean. Worker native proof also includes CTR 6, Watch 21, playback 18,
profile 3, visit clicks 9, and standalone retention 6. Scoped lint/format, Prisma
validation, typecheck, and the normal repository-wide commit hook passed.

Root inspected `/tmp/forge-feat590-2573-report-wide.jpg` and
`/tmp/forge-feat590-2573-report-mobile.jpg`. Baseline screenshots and
`/tmp/forge-feat590-2573-loading.json` plus
`/tmp/forge-feat590-2573-browser-layout.json` complete the browser evidence.
Eight alternating warm HTTP samples per mode produced baseline/report medians
177.8/207.05ms TTFB and 178.95/207.8ms total, with 61,022/78,004 HTML bytes.
Both fetched the same 19 static assets (5,333,077 uncompressed bytes). No document
overflow at 1440/390 widths; mobile tables remained in 341px scroll containers.
Browser console errors were empty. These synthetic Next development fixtures do
not measure FCP, production authentication/database latency, playback, or capacity.
The temporary fixture route and stale generated Next types were removed.

Worker A performed final Standards and Spec review against
`d661b99939e24ba41834adce53c6bad9262bcee9`, including staged integrated code
and over 127 changed files. Both axes had zero confirmed defects in delivered
slices. It separately verified the two-file fixture follow-up and operational
auth/error wording; root's successful 20-case rerun closed its only caveat.
Known incomplete parent-spec criteria remain explicit: live GA/history access,
first costed catalog build, numeric policy agreement, trusted bot/loss signals,
loaded storage/capacity proof, and manual launch controls. The PR remains a draft.

Current integration SHA and CI status are recorded by PR #2578 and its checks;
prior published AF8 CI passed 42 checks with 6 skipped. Publication of this local
verification follows normal hooks and the existing draft-PR workflow, with no
merge, production deployment, public test, promotion, or refresh schedule.

### October 6 GA source qualification and Watch-only scope

The user has now supplied the GA property and completed browser sign-in,
superseding the earlier pending-response notes. See the
[GA discovery record](2026-10-06-precomputed-video-recommendation-ga-discovery.md)
for exact sources, schemas, date ranges, aggregate findings and query-job IDs.
Browser reads succeed; source completeness, canonical mapping, transition
semantics and local/server API authentication remain distinct unfinished checks.

The exact-property copies contain only March–July 2023 totals without usable
video-start session keys. A combined-event table is a qualified-discovery
candidate, with mostly 2021–2022 Watch video starts and unverified lineage. None
of these observations completes the live warehouse adapter or unblocks #2569.
The user explicitly requires verified JesusFilm.org `/watch` and descendant
paths; other site pages cannot contribute to recommendation history.

Sol worker A completed the independent Watch-scope and source-quality
contract/display slice from `9e0cd06c2`, preserving legacy-read compatibility.
No new production export, warehouse write, deployment, public experiment,
promotion, or refresh schedule has occurred. The user subsequently completed
remote Google ADC authorization using their Mac browser and Linux terminal.
The remote credential file is owner-only (`600`), credential refresh succeeds,
and BigQuery table metadata reads return HTTP 200. Direct GA report access
then returned HTTP 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`: the command omitted
the separate `analytics.readonly` scope. The user then attempted the added scope
and received Google's "This app is blocked" page. SDK 587.0.0 explicitly lists
that scope as being blocked for the default ADC OAuth client. The existing
owner-only Cloud ADC file is still present. A supported project-owned OAuth
client or properly configured service identity was required at that stage;
Tatai subsequently supplied the service account verified below. No default-client
retry or policy bypass was performed.
Current GA browser reports were verified with exact Watch path and hostname
filters: September 8–October 5 contains 283,064 page views and 1,014
`videostarts`, among 32 event types. These counts establish current report data,
not a qualified ingestion, human baseline, or transitions. See the updated
discovery record; old warehouse-copy coverage must not be generalized to GA.

### #2568 qualification boundary verification

Source commit `c9b9d6fd6fc283dc810769a1f8baca03113b4a1d` has tree
`a87ad567d689214c858d418142d7a4176deebec8`, exactly matching the independently
reviewed staged tree. Root integrated the source unchanged and confirmed no
application/package/test difference from that commit.

New builds require a declared versioned Watch host/path policy, reconciled
event-weighted scope counts, bounded source identity, observed dates, video-ID
coverage, per-signal bot/overlap basis and usable ordered-transition provenance.
Unavailable transitions fail before model generation and persist a specific
failure reason for Admin. Admin independently rejects incomplete qualification
at history ingestion and completion. Older completed records remain readable
with explicit unknown scope/capability; they are not upgraded to qualified data.
These guards validate source declarations. They do not implement or prove the
future warehouse reader's URL filtering or sequence construction.

Independent Matt Pocock Standards then Spec review against `9e0cd06c2` found one
low-severity defect: unbounded source identifiers could be clipped in Admin.
Both services now cap them at 191 characters, the display wraps them, and tests
cover the 191/192 boundary. The focused recheck found no remaining confirmed
defect or completion bypass. No Compound Engineering skills/agents were used.

Root combination checks on the owned PostgreSQL 18 database passed:

- `2568-scope-integration-native.log`: 10 files, 70 Admin/native cases.
- `2568-scope-integration-producer.log`: 15 source-build-through-Admin cases,
  including an unavailable-transition failure without model generation.
- `2568-scope-integration-contract-regression.log`: 59 default-off cases.
- `2568-scope-integration-mastra.log`: nine workflow/producer/history cases.

Logs are in `/tmp/forge-feat-590-orchestration/`. The worker's native suite had
skipped its 15 cases because no database was configured; root's executed native
run closes that fixture-validation gap. It does not establish live ingestion.
Worker full suites before the final cap/wrap fix passed 8,987 Admin cases
(774 skipped, one todo) and 3,223 Mastra cases (37 skipped). After that fix,
the affected tests, both package typechecks, scoped lint/format and normal
commit hooks passed. No migration or GraphQL schema change was introduced.

Worker A's final CUA mobile check used a synthetic rendered comparison with a
191-character table name: at a 390×844 viewport, document client/scroll width
were both 375px and the identifier used `word-break: break-all`. Its single
static HTTP timing is not a comparative Admin loading benchmark. Earlier
headless screenshots are not final browser proof.

Worker B then compared the actual saved-history comparison through a synthetic
Next development route with qualification absent/present. Ten alternating warm
samples per mode returned HTTP 200 throughout. Median TTFB/total were
129.8/130.6ms without qualification and 136.2/136.9ms with it. HTML grew from
65,544 to 67,733 bytes (+2,189); both modes referenced the same 19 static assets.
Raw evidence is `/tmp/forge-feat590-2568-loading.json` with
`/tmp/forge-feat590-2568-legacy.html` and
`/tmp/forge-feat590-2568-qualified.html`. These bounded local measurements do
not establish FCP, production authentication/database performance, or capacity.

Eight alternating CUA full navigations per variant had median navigation plus
accessibility-observation wall times of 532.5ms/501.5ms; automation overhead is
included, so these are not Web Vitals. Root directly inspected final full-page
CUA screenshots at 390×844 and 1440×900. The long source identifier was readable
and wrapped, document widths did not overflow (375px mobile, 1425px desktop),
and browser error logs were empty. Viewport overrides were reset and root's
temporary tab closed. The detailed worker report is
`/tmp/forge-feat-590-orchestration/2568-scope-loading-report.md`.

### Roadmap advisory collision repair

CI run `37377134105` for `454482d0f` found that current main had allocated
`feat-607` to a media-generation feature. This branch had used that ID to move
the older completed fixture ticket away from the experiment's approved `feat-590`.
Main `10461fdd8`, the integration branch and visible pending task roadmap files
were checked; `feat-609` was the next unused ID. Only the historical fixture
ticket and its plan/report/index references were renamed. The experiment remains
`feat-590`; media-generation `feat-607` and `feat-608` are untouched. Application
code and completed fixture acceptance evidence are unchanged.

That run finished with 51 successful jobs, three skipped and only the advisory
failure. The current-main collision check's three tests passed locally, and its
exported collision logic found no newly introduced collisions in the projected
roadmap inventory after applying this branch's staged changes to main `10461fdd8`.
The advisory remains enabled; no workflow or application change was made to
resolve it.

### #2568 service-account authentication and current report discovery

Tatai's service account in `jesusfilm-org-1738781064783` successfully impersonates
from the existing remote Cloud ADC login using `analytics.readonly`. The standard
GA Data request, metadata request and GA Admin property request all returned
HTTP 200. An unnecessary explicit quota-project header initially returned
`USER_PROJECT_DENIED`; omitting that override resolved the probe without new
permissions. No key download, token persistence, ADC replacement, property
configuration change, IAM mutation or API enablement was performed by the agent.

Exact Watch hostname/path filters returned current events and 200 complete
monthly/event aggregate rows from property creation through October 3, 2026.
The report contains 4,006,892 starts beginning September 2022; old warehouse-copy
cutoffs therefore do not describe the property's report history. Recent media-ID
coverage is incomplete, path mapping remains a lead, and event volume/semantics
show a discontinuity around July–August 2026. Ordered transitions remain
unverified. See the discovery record for counts, boundaries and evidence files.

This resolves the Analytics API authentication blocker only. No application
code changed, historical reader was completed, live model build was run, or
public experiment was activated. #2568 source/adapter acceptance and #2569's
dependency remain incomplete.
