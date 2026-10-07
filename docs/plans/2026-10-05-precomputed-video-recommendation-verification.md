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
unused ID, now `feat-612`, with its existing plan/report/index references updated.
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

### #2568 programmatic GA reader continuation

The dedicated Mastra reader uses ADC-backed service-account impersonation with
`analytics.readonly`; it does not inherit the SEO bearer token or force a quota
project. It applies the fixed JesusFilm.org Watch hostname/path filters and
checks complete report pagination, response size, counts, requested dates,
timezone, source truncation, sampling, thresholding, and restricted data. A
bounded aggregate-page interface and read-only CLI expose path/media-ID mapping
leads. Canonical mappings and ordered transitions remain explicitly unavailable.

The configured reader participates in the normal source-generation dependency
path. Qualification failure is preserved through the historical-reader boundary
and stops the build before a model call. It cannot produce an accepted historical
snapshot. Production range configuration is pinned to property `320198532` and
the last complete New York-local day before the requested cutoff; a changed
property timezone is rejected.

Independent Matt Pocock Standards then Spec review against `3d4d241f0` found
three issues: a raw CLI configuration error, an ambiguous media-ID coverage
label, and a UTC cutoff calculation that could include future property-local
events. The final bounded recheck found all three resolved, including response
timezone guards and boundary regressions. The review report preserves exact
per-file hashes at `/tmp/forge-feat-590-orchestration/2568-ga-reader-review.md`.
No Compound Engineering skills or agents were used.

The real TypeScript CLI successfully impersonated Tatai's service account and
read the full requested report range, June 21, 2022–October 3, 2026: 200 monthly
rows and five media-ID-presence rows, totaling 4,006,892 starts, with 3,337,802
carrying a non-placeholder legacy media ID. A second smoke after the review
fixes returned the same aggregates with the explicit media-component-ID label,
`canonicalVideoMappedEvents: null`, and `source_truncation` from August 5, 2022.
The separate bounded start-page smoke returned 100 of 152,280 aggregate rows
and a continuation offset; it was not a full import. Live evidence is saved as
`2568-ga-reader-live-coverage-final.json` and `2568-ga-reader-live-starts.json`
under the task-local orchestration directory. Tokens and raw viewer/session
rows were not saved. No live model call, successful historical build, production
credential change, deployment, or public experiment activation was performed.

The corrected worker tree passed the full Mastra suite: 277 files and 3,238
tests, with 37 configured skips. Mastra typecheck, full package lint, touched-file
ESLint/Prettier, diff checks and normal commit hooks passed. Source commit
`b0892f4e42e67199de7f9617471140be82775381` contains exactly the ten independently
reviewed application files; root compared all per-file hashes before fast-forward
integration.

Current main `8ebd6500cccb7356a295232e7cc7a91ab99d558c` introduced retention
phase-budget handling and an additive conflict in the standalone retention
test. The resolution preserves all three precomputed retention regressions and
main's separate yield/continuation test. Static review confirmed the automatic
runtime merge retains archive transaction fences and counters alongside the
new budget admission guard. Main also allocated feat-609 to HNSW-recall work;
only the completed fixture ticket and its references moved again, to feat-611 (subsequently feat-612).
Main's feat-609 HNSW and feat-610 RAG work are unchanged. The collision guard's
three tests and its actual merged-tree inventory check passed.

Combined verification after that merge passed both Admin/Mastra typechecks,
15 native generation-to-Admin cases, 23 Mastra reader/workflow cases and 68
retention service/job/workflow cases. A fresh owned PostgreSQL 18 fixture passed
all seven standalone retention cases, including committed archival counts,
ordinary timeout failure, bounded cleanup, and the new phase-budget continuation.
The fixture database created for that successful run was removed; the integration
database remains. Main's optional-subtitle migration was applied only to these
owned local databases, and Prisma Client was regenerated. No new GraphQL schema
change or generated GraphQL artifact edit was required for this merge.
Logs are `2568-ga-reader-integration-*.log` and `2568-ga-retention-*.log` under
the task-local orchestration directory. The merge review is
`2568-main-merge-review.md` there.

### OpenRouter and navigation continuation

The user requested OpenRouter instead of a separate OpenAI credential. Exact
`openai/gpt-6-astra` was present in OpenRouter's live model inventory, and the
existing Mastra paid credential worked. Integration `b7926faf5` uses the
Responses endpoint, strict structured output, required parameter support,
disabled provider fallback, no adapter retries, and the existing per-call
deadline. The saved model identity remains `gpt-6-astra`. Three real-SDK tests
with a fake HTTP boundary, Mastra typecheck, lint, formatting, normal hooks,
and independent sequential Standards/Spec review passed.

A live request completed in 3.7 seconds with valid JSON, 41 input and 12 output
tokens, and a reported cost of $0.00101. Evidence is
`/tmp/forge-feat-590-orchestration/openrouter-astra-live-smoke.json`; no credential
was written to the artifact. This proves provider access, not recommendation
quality or full catalog cost. [CI run 37399481208](https://github.com/JesusFilm/forge/actions/runs/37399481208)
passed with 37 successful jobs, three skipped jobs, and no failures.

Admin navigation source `6a709410c` is integrated as `58b2aaa18`. It adds bounded
current route identities, parent/language cutoff checks, a strict distinct
`ga_data_api` contract, and navigation/partial-history labels. Legacy ordered
history retains its contract. No migration or GraphQL change was needed. The
worker full Admin suite passed 8,999 tests across 570 files; focused native
catalog/ingest/review and view tests passed 23 cases; the prior producer integration
passed all 15 cases. Typecheck, focused lint/format, sequential Standards/Spec
review and normal worker/integration hooks passed.

Root's synthetic Next preview passed CUA desktop (1440) and mobile (390)
inspection. Document and scroll widths matched (1425/1425 and 375/375), long
hashes and source terms wrapped inside their containers, and browser error logs
were empty. Ten alternating warm HTTP samples measured median response times
142.18 ms without history and 159.92 ms with the navigation panel, with
62,591/69,317 HTML bytes and the same 19 assets. The artifact is
`/tmp/forge-feat-590-orchestration/2568-navigation-loading.json`. These are local
development HTTP/layout measurements, not FCP, authenticated database latency,
or production capacity. The temporary route, browser tab, dev process, and
Next-generated guide block were removed afterward.

The development root filesystem filled during the first preview compilation.
Only this task's disposable Next caches were removed, recovering about 667 MB;
the preview cache then used the separate temporary filesystem. No source,
database, production data, or prior evidence was removed.

Root also added a native integration regression for the actual GA reader through
Admin catalog, source generation, persistence and review, with synthetic GA HTTP
and controlled model output. It was red on the prior reader as expected.
Independent review strengthened it with distinct slugs versus canonical IDs and
assertions on exact GA property, method, host, Watch path and event filters.
An early combined run against the worker's current Mastra files and integrated
Admin passed. The temporary test configuration was removed. Final verification
against the committed integration passed all 16 native source-build cases and
23 focused Admin catalog, contract and view cases, plus both application
typechecks and focused lint/format. This controlled regression is not live evidence.

The bounded live navigation smoke subsequently completed all 4,329 snapshot
rows: 468 referrer rows over five pages and 3,861 engagement rows over 39 pages.
For The Beginning (`cmp76ycuv02n0ny01faav3nae`) to Birth of Jesus
(`cmp76yn4x02owny01ta34f78o`), current-route mapping qualified 3,948 associated
destination starts, left 27 unmapped, and mapped 123,894 destination starts.
Engaged views and exposures remain null. The usable interval is August 6, 2022
through October 3, 2026; the requested June 21–August 5, 2022 prefix remains
unavailable. Counts matched preflight and every completed request returned 200.
The local catalog fixture was derived from read-only current Admin rows, including
2,265/2,272 known source/target language slugs; three null-slug rows were excluded.
This is operator qualification of one pair, not a production Admin catalog build
or proof of historical URL ownership. The minimized artifact is
`/tmp/forge-feat-590-orchestration/ga-navigation-smoke-result.json`.

Saved query counts cover the qualified snapshot: two logical queries and 44
pages. The smoke made 53 GA report requests including seven source-qualification
reports and two smoke-only size previews. Admin now explicitly labels the
snapshot scope. #2569 must include source qualification and actual retry overhead
in whole-build usage accounting; the snapshot counts cannot stand in for total
requests or billing. GA processed bytes and monetary cost remain unavailable.

A second live OpenRouter call used those real aggregates and the two videos'
published public metadata. Astra recommended the pair, accurately cited the
3,948 navigation-associated starts, and explicitly qualified metadata-only
content evidence, missing historical prefix, unknown exposure/bot filtering,
and unavailable ordered playback. It used 865 input and 198 output tokens in
7.76 seconds, costing $0.01855. The artifact is
`/tmp/forge-feat-590-orchestration/astra-watch-navigation-live-smoke.json`.
This is a live one-pair judgment, not a full catalog run or production activation.

The final root combined verification script exited successfully. Worker full
suites passed 3,250 Mastra and 8,999 Admin cases; both workers completed separate
Standards and Spec reviews with no unresolved findings. Root independently
reviewed the connected regression and provider boundary. #2568 is now integrated
and verified under the approved navigation revision; #2569 may begin.

## Catalog build workload and storage baseline — October 6

The read-only current catalog aggregate at 02:11:35Z found 1,031 eligible Videos,
859 with transcripts and 858 with English transcripts. Across languages the
164,639 transcript records declare 280,046 chunks, with 80,248 for one Video.
This is a current aggregate, not a cutoff snapshot or completed catalog run.
Receipt: `/tmp/forge-feat-590-orchestration/catalog-build-dimensions.json`.

At 02:15:35Z, bounded aggregate/catalog queries measured Admin PostgreSQL 18.6
at 25,768,457,919 database bytes and 117,440,512 WAL bytes. It has 71 existing
recommendation tables and no precomputed tables, consistent with the feature
remaining undeployed. At 02:16:17Z a read-only SSH `df -B1` against actual PGDATA
measured 48,891,670,528 total bytes, 25,963,548,672 used and 22,911,344,640 available.
The SQL and filesystem-side cluster identifiers matched. The Railway platform
listing reported 27,292.884992 MB current size against 50,000 MB configured;
this platform accounting is distinct from the direct filesystem measurement.
The first SSH probe found `pg_controldata` absent from PATH; resolving the
installed PostgreSQL binary completed the binding check without any mutation.

These are physical baseline snapshots, not build capacity approval, growth rate,
loaded-retention proof or a full-build footprint. Measured new storage and
protected operational headroom are still required. No production data or
configuration was changed. Receipts: `catalog-build-storage-baseline.json` and
`catalog-build-filesystem-baseline.txt` in `/tmp/forge-feat-590-orchestration`.

Published navigation integration `ffd1feb21` passed forge-ci run `37403077030`: 37 successful jobs, three skipped jobs, no failures.

## Catalog continuation: connected checks in progress

The new root-owned native catalog tracer first failed on the integration branch
because the new modules did not exist there. An early run through temporary
aliases to the two worker drafts then found a real initial-checkpoint mismatch:
Admin exposed its stored empty object while Mastra required null or a valid
checkpoint. Admin now exposes null for an absent checkpoint; strict producer
validation remains. The connected test passed after the correction.

The test commits a paid model result and checkpoint, loses the transport reply,
then simulates lease expiry and reconstructs the producer dependencies. Private
review stays incomplete until both fixture sources finish. Resume reports one
accepted edge, one explicit empty result, three model calls, 400 input/80 output
tokens and exactly $0.04 in controlled charges; replay adds no calls. A second
connected test passed with a newly eligible third target, showing an existing
source changes its choice while the prior generation remains readable unchanged.
These are candidate-code native results, not final committed integration or live
model spending. Final verification remains required after worker integration.

The producer raised bounded GA snapshot pages from 100 to 500 rows without
removing the response cap or complete-page checks. Root verified one real page
through the actual reader on October 6 at 02:47:32–02:47:52Z, restricted to
approved hosts/Watch paths and current Birth of Jesus routes over the usable
August 6, 2022–October 3, 2026 interval. It returned HTTP 200, exactly 500 rows,
a continuation offset of 500 and 132,489 response bytes, with no report
limitations. Only one report request was allowed; no raw rows were saved, no
model was called and no data was written. This verifies one page, not a fresh
complete snapshot, canonical mapping, full-build timing or production readiness.
Receipt: `/tmp/forge-feat-590-orchestration/ga-500-row-read.json`.

All four connected candidate cases now pass. The third simulates a charged
transient provider failure, then resumes the same source and reports four
distinct call IDs, 450 input/80 output tokens and $0.05 including the failed
attempt. The fourth uses the actual default GA reader with synthetic external
HTTP/token transport through the catalog coordinator into Admin review. It
preserves the missing historical prefix, unavailable ordered playback, unknown
historical URL ownership, seven qualified and three unmapped navigation events.
Every observed fixture HTTP attempt, including source qualification, matches a
durable receipt; all GA charges remain explicitly unknown, with none pending.
Fixture catalog timestamps are fixed so the property-local closed date is stable.
Receipt: `2569-catalog-four-cases-candidate-green.log` in the orchestration artifact
directory. This remains candidate evidence pending final integration.

Root's legacy route fixture now uses its own native current-migration schema
rather than relying on an older shared public database. Its two route cases and
focused lint pass. Independent root review also identified an old-protocol
mutation path around the new durable lease/capacity fences; the Admin worker
added service-level protocol isolation and is verifying the regression before
integration.

A disposable PostgreSQL 18 fixture for upcoming loaded-capacity verification is
ready as `forge_feat590_capacity_db`, loopback port 32816, database
`forge_capacity`. PGDATA uses an 8 GiB tmpfs and 256 MiB shared memory, preserving
the host's scarce root disk. It is empty test infrastructure, not a workload
measurement or production capacity proof. Serialize larger loads and monitor
available memory; stopping the container discards this fixture data.

A read-only Mastra service filesystem observation at 03:05:14Z measured
48,891,670,528 total bytes, 1,020,944,384 used and 47,853,948,928 available on
`/data`; `du` reported 1,018,822,656 allocated bytes under `/data/mastra`. This
is the existing runtime/observability volume baseline, not new build growth or
a budget. It does not include Mastra's separate PostgreSQL store. Receipt:
`/tmp/forge-feat-590-orchestration/mastra-runtime-filesystem-baseline.txt`.

Producer source `c64e22eac767254ede1c747585b1bd4778b7399f` is integrated as
`1298713cc`. Its full Mastra suite passed 3,257 cases and its sequential Standards
and Spec reviews have no remaining producer findings. Root's post-extraction
legacy source-through-Admin regression passed all 16 cases. The refresh tracer
now constructs its own prior generation so it can also run independently.

One bounded live call through the integrated cost adapter at 03:11:02–03:11:05Z
used exactly `openai/gpt-6-astra` via OpenRouter with fallback disabled. The
adapter returned 41 input/12 output tokens, zero cached input tokens and
$0.00101, exactly matching the provider's usage receipt. Only one outbound
request was permitted and no production data was written. Receipt:
`/tmp/forge-feat-590-orchestration/openrouter-astra-cost-adapter-live-smoke.json`.
This proves real cost capture for a small structured response, not catalog cost.

Mastra's configured internal database host was matched to the Railway service
currently named `@forge/mastra-gateway/db`
(`86876e13-7d60-4da1-81f3-980aff9ef999`). A read-only SQL
snapshot at 03:16:41Z measured 5,125,412,543 database bytes, 83,886,080 WAL bytes,
and 89 tables, of which 87 have Mastra-prefixed names. Direct PGDATA `df` at
03:17:49Z measured 48,891,670,528 total bytes, 5,236,723,712 used and
43,638,169,600 available. This is a separate existing runtime-store baseline;
none of the undeployed catalog workflow's incremental footprint is measured.
Receipts: `mastra-database-service-binding.json`,
`mastra-database-storage-baseline.json` and
`mastra-database-filesystem-baseline.txt` in the orchestration artifact directory.

A bounded read-only current-traffic aggregate at 03:28:07Z counted 38,565
recorded recommendation requests over the preceding seven days; it did not
reach its 200,001-row cap. The saved daily/surface/purpose/state aggregates
contain no request or viewer IDs. These are persisted recommendation requests,
not eligible Watch visits or verified human traffic, and are only an input to
a future loaded-fixture scenario. Bot qualification remains unverified. Receipt:
`/tmp/forge-feat-590-orchestration/recorded-request-traffic-baseline.json`.

The producer peer review confirmed a capacity-admission race: a competing build
can become terminal or blocked after an operator's free-space sample, removing
a reservation before that sample accounts for its writes. Admin is retaining
those projections for older samples and subtracting observed database growth.
A second confirmed case spans multiple successful capacity refreshes, where one
maximum projection cannot represent all intervening physical/WAL growth. The
chosen conservative correction rejects a sample predating another build's
latest successful capacity admission. Native interleavings and a final narrow
review remain required before #2569 is marked verified.

The final narrow capacity review found no remaining issue after the
server-recorded `lastPassedAt` fence was added. Admin's focused native durable
suite passed all 12 cases, including terminal-after-sample, blocked-after-write,
and two successful admission epochs against an old sample. A fresh sample can
proceed. Admin full-suite/typecheck/commit and final integrated verification are
still pending; the feature is not live.

## Final catalog integration verification

Admin source `b6db0a4a5b1725a3f46e4ce5773c0e7f6a8c9693` integrated as
`04200cd9f`, after producer `1298713cc` and current-main merge `3c2d5b57b`
(main `e36a29954bda8dc60f2b8d21a12548ae9b2b0241`). Final native checks use the
normal integration configuration and committed application modules, without
worker aliases: all 20 build-through-review cases and all 37 focused Admin
catalog/durable/contract/route/view cases passed. Both package typechecks,
touched-test ESLint and Prettier passed. The official migration chain through
`0135` applied successfully to the fresh local PostgreSQL database. Logs:
`2569-integrated-build-to-review.log`, `2569-integrated-admin-native.log`,
`2569-integrated-admin-typecheck.log`, `2569-integrated-mastra-typecheck.log`,
`2569-integrated-root-lint.log`, `2569-integrated-root-format.log`, and
`2569-fresh-migration-chain.log` under `/tmp/forge-feat-590-orchestration`.
The new cross-app native suite is locally executed; no new CI workflow job is
claimed. Full worker suites passed 3,257 Mastra and 8,999 Admin cases.

Root sequential Standards and Spec review used the #2569 base `ffd1feb21` and
reviewed the test additions, runbook, and integrated contracts alongside the
workers' final reviews. No confirmed finding remains. Tests substitute external
GA/model boundaries only; native persistence, transactions, and Admin review
remain real. The refresh case builds its own baseline and does not depend on
the interruption case. Capacity values in these fixtures are synthetic, never
production admission evidence.

The report rendered in the in-app browser at desktop 1440 and mobile 390
widths with no page-wide overflow or console errors. The long selected source
ID and 64-character digest wrapped within the mobile panel. Ten alternating
warm HTTP samples (five per mode after warmup) measured medians 142.34ms
baseline / 147.28ms with the report, and 62,426 / 76,420 HTML bytes, with the
same 19 assets. Receipt: `2569-catalog-loading.json`. This measures synthetic
local Next development rendering, not FCP, authenticated database cost, or
production latency. Preview fixture, temporary generated types and Next-added
agent-guide block were removed, server stopped, viewport reset, and tab closed.

#2569 code is integrated-and-verified. The actual first catalog run and measured
capacity acceptance remain future operator work; no production build, serving
activation, promotion or schedule occurred. #2574 can now implement its
storage/readiness controls against both verified prerequisite code paths.

The additional repository-owned seam typecheck found those files were outside
the package `include` patterns. Resolving the same explicit package aliases as
Vitest exposed a fixture-only readonly tuple mismatch, corrected with `satisfies`
against the historical-reader qualification contract. The cross-app check then
passed with no application changes. Its reproducible configuration is
`apps/admin/tsconfig.precomputed-integration.json`; run
`pnpm --filter @forge/admin exec tsc --noEmit -p tsconfig.precomputed-integration.json`.
This is additional local validation, not a new automatic CI job.

Catalog integration `285bb46eb2c507dac5ff5506bbbe57be0ce68c8d` passed
[forge-ci run 37411231982](https://github.com/JesusFilm/forge/actions/runs/37411231982):
37 successful jobs, three skipped and no failures. #2574 began from that
verified integration in the existing two Sol chats. Root's next connected
retention case is expected-red while the new retention module is being built;
it does not alter the published catalog behavior.

## Storage continuation: candidate seam

The root producer→generation-retention→Admin-review case first failed because
`generation-retention.ts` was absent. Against worker B's first native slice and
updated generated client through temporary aliases, it passed: three real
controlled catalog builds, superseded generation removed in bounded passes,
latest-two recommendation choices and exact three-call/$0.04 reports preserved
after cleanup/replay. No paid provider or production database was used.
Receipt: `2574-catalog-retention-candidate.log`. This is draft candidate evidence,
not final integration, loaded throughput proof, or live readiness. Abandoned
build handling and bounded descendant draining are still being implemented.

The expanded native candidate passed both targeted cases after the retirement
proof contract was added. A real interrupted→completed build reports matching
generation/cutoff/digest/input-mode identity and resumability true→false. After
Admin reclaims a generation, its compact proof is consumed by Mastra's actual
`prunePrecomputedAbandonedRuntimeSnapshots` against native WorkflowsPG rows.
The matching retired row is removed; unknown identity and mismatched cutoff
remain; replay is idempotent and retained Admin choices/cost totals are unchanged.
Receipt: `2574-catalog-runtime-proof-candidate.log` (two passed, three intentionally
skipped). The runtime rows are seeded crash fixtures, not a measurement of
actual workflow emission; the Mastra worker owns that separate lifecycle smoke.
Both workers are still developing the slice, so this is not final acceptance.

Worker A's actual controlled **source** workflow lifecycle emitted one native
PostgreSQL snapshot with `pg_column_size(snapshot)=1,283` bytes and a serialized
`getTrace` JSON payload of 2,147 bytes. The isolated shared DuckDB file occupied
12,288 allocated bytes after shutdown. Receipt: `/tmp/forge-2574-real-workflow7.log`.
The strengthened lifecycle calls real `runPrecomputedSource` with controlled
catalog, transcript chunk, model output and Admin ingest. Transcript/model
sentinels were absent from the persisted runtime artifacts; GA history is off
in this particular smoke and is not covered by its no-leak claim. The root trace
contained its run ID and compact immutable proof metadata. These are controlled
source-workflow values, not per-trace physical allocation, whole-catalog cost,
or a production storage forecast. Legacy RUNNING traces without identity remain
counted unresolved, never assumed safe to delete. Final worker review/integration
validation remains outstanding.

Current main `1daa80373` allocated feat-611 to the Google Maven lookup fix.
The completed recommendation-fixture record therefore moves to the next free
global ID, feat-612, preserving its implementation, evidence and references.
The platform ticket and the approved feat-590 experiment keep their identities.

## Bounded storage integration

Mastra source `93d1d572fe04edeb48410114e668cb64bc4d1e23` integrated as
`af835cdd0`. It bounds terminal workflow snapshots and traces, uses Admin's
matching retirement proof for abandoned runtime records, and preserves
unresolved/active identities. Its actual controlled startAsync workflow smoke
uses the real source service; it does not exercise the GA-history branch.
Final full Mastra suite: 286 files, 3,267 tests passed, 38 expected skips.
Typecheck, lint and normal commit hooks passed.

Root review found a generation-pin race: a pre-transaction complete read could
be invalidated by a concurrent retirement before experiment insertion. The
Admin fix share-locks and rechecks the generation during creation, and cleanup
rechecks pins after acquiring its exclusive generation lock. The native test
uses a separate autocommit observer and pg_blocking_pids to establish that the
operation is waiting on the exact lock holder before retirement commits. It
rejects the late pin and preserves an existing pinned generation. The focused
three-file Admin suite passed 31 cases, and the strengthened concurrency case
passed separately. Full Admin suite before final narrow review fixes passed
570 files / 8,999 tests, with 799 expected skips and one todo.

The operator report renders traffic assumptions, unqualified retained-volume
projection, current generation/build/rollback inventory and reservations,
write/query measurement gaps, native relation parts and selected-generation
row-value estimates. The shared-cluster cumulative WAL counter is not a
feature-specific write measurement. Zero raw rows leaves per-live-row bytes
unknown. Fixtures and historical baseline snapshots cannot authorize a live
capacity budget.

Admin source `4aea9fa813b3b9250c1c295223559eb417071a55` is represented by
integration `f18768c39`. Its initially cherry-picked predecessor `7a6bf16bb`
was amended through normal hooks after an improper hook bypass on the original
commit. Root required and verified the repair: both source trees are exactly
`a9470692b1ea7f6b5beb594c0920147ffadb416f`; `git diff` between them is empty.
No hook bypass is permitted for subsequent work.

Root's normal integration modules/configuration passed all 21 connected
build-through-review cases, 63 Admin native/view cases, 13 Mastra runtime/workflow
cases, both application typechecks and the additional cross-app seam typecheck.
The fifth catalog case builds three actual controlled generations, reclaims the
superseded generation in bounded passes, and preserves both latest generations'
choices and exact three-call/$0.04 reports. Native crash-left WorkflowsPG rows
consume the actual Admin retirement proof: one matching identity is removed,
unknown and mismatched identities remain, and replay changes nothing. These
seeded runtime rows are not the separate actual lifecycle measurement above.

A new owned PostgreSQL database accepted the full official migration chain
through `0136`. All seven dedicated standalone-retention regressions passed,
including timeout/rollback and raw-to-archive cases; that temporary database was
dropped afterward. Logs: `2574-integrated-build-to-review.log`,
`2574-integrated-seam-typecheck.log`, `2574-integrated-admin-native.log`,
`2574-integrated-mastra-native.log`, `2574-integrated-admin-typecheck.log`,
`2574-integrated-mastra-typecheck.log`, `2574-retention-migrate.log`, and
`2574-retention-native.log` under `/tmp/forge-feat-590-orchestration`.

The committed local benchmark receipt records 6,715 request roots, 34,395 items,
mixed packed/inline snapshots and 672 synthetic selections. Ordinary bounded
cleanup completed all 68 runs in 37.437 seconds, maximum 659ms per run, with zero
failures/yields. All raw roots/visits were removed and 6,715 archive receipts
remained. Relation allocation increased from maintenance writes; deletion did
not shrink physical files. The second 1,031-source synthetic generation added
2,531,328 bytes across watched relations, with repeated-text compression caveats.
These local measurements cannot establish production capacity or human traffic.

Browser QA exercised the actual storage view using a temporary synthetic local
route at desktop 1440×1000 and mobile 390×844. Document client/scroll widths
matched (1425/1425 desktop; 375/375 mobile initially), the long generation ID
wrapped, and the table scrolled independently to scrollLeft 477. No browser
console errors occurred. The actual protected route returned 307 to login.
Ten alternating warm HTTP samples measured medians 123.090ms empty-comparison
view / 196.456ms storage view, HTML 62,428/82,582 bytes, same 19 assets. This
records the added report's local development render cost, not zero regression,
FCP, production latency or authenticated database-query cost. The existing
comparison page only adds a link; no Watch rendering path changes in this slice.
Receipt: `2574-storage-loading.json`. The preview server, route, cache symlink,
preview-generated types and Next-added guide block were removed; browser
viewport reset and tab closed.

Root Standards then Spec review from `285bb46eb` covered the integrated storage
contracts, locking/fences, retention phases, report qualifications, connected
tests and worker reviews. The confirmed pin race is fixed and the final native
checks cover it. No unresolved confirmed defect remains. Live admission still
requires a fresh measured capacity budget, deployed GA credentials and a first
actual catalog run; #2573's human/bot/loss/policy qualifications remain absent.
#2574 code is integrated-and-verified, unlocking #2575 implementation only.
No production write, deployment, public activation, promotion or refresh schedule
was performed.

## Manual controls continuation

#2575 started in the same two exact Sol chats from `6b9c9836a`. Root's next
connected tracer builds an actual controlled catalog, reads Admin comparison,
and asserts that the public control remains incumbent. It is expected-red because
the public control service is not yet implemented; no existing behavior changed.
Receipt: `2575-catalog-controls-red.log`.

The agreed control contract uses one atomic Admin public delivery operation and
a default-incumbent versioned pointer, without a racy Web pointer preflight.
Fixture-qualified evaluation must consume real native visit/click counts and
require test mode, explicit opt-in and an owned loopback database. It cannot
authorize a production start or promotion. Private reports remain inconclusive.
Actual live qualification record creation and the required trusted source audit
remain incomplete; fixture control rehearsal does not close that acceptance gap.

Storage integration `6b9c9836a44c90983489534355857858ddab0708` passed
[forge-ci run 37419891818](https://github.com/JesusFilm/forge/actions/runs/37419891818):
37 successful jobs, three skipped and no failures.

The first root candidate passed: an actual controlled catalog build and Admin
comparison did not move the incumbent pointer. The next slice passed actual
build→prepare→unauthorized workflow start rejected→unqualified live start
rejected→explicit isolated fixture start. These use a temporary candidate alias
to the Admin worker; final integrated verification is still required. Receipts:
`2575-catalog-controls-candidate.log`, `2575-catalog-start-candidate.log`.
The rollback extension was expected-red before its service export existed.

Root review identified an eligible/null-delivery fallback gap in the candidate
Web route: it could issue a second unbound incumbent request after admission.
Worker A corrected it and the focused route regression passes. Original arm
attribution stays with unavailable delivery; bound fallback belongs in Admin.
First-response cookie loss keeps the same navigation ID and must conflict
without duplicating the denominator if the retry has a new browser identity.

A now owns the thin public-delivery GraphQL adapter and generated operation in
addition to Web. B retains all service/state/migration/readiness/CTR/UI/agent API
work. This avoids idle time waiting for wrappers; final integration remains
serial and generated files must be produced normally, never hand-edited.

The connected candidate rollback slice passed with two targeted cases. A stale
control version cannot roll back; the exact authorized target returns to the
incumbent, retains the experiment pin, and preserves the actual producer's saved
choice and three-call/$0.04 report. Receipt: `2575-catalog-rollback-candidate.log`.
This is candidate/native fixture evidence, not production authority.

Web continues to skip declared bot/prefetch traffic before public admission.
Those upstream exclusions are not present in Admin visit counters: report
coverage must label them partial/unavailable, never treat a recorded zero as
complete edge bot coverage. No second telemetry store or extra request is added.

The actual connected candidate visit slice passed: a producer-created saved item
is issued to a challenger browser; changing the browser identity on the same
visit UUID cannot reassign it. A signed click remains accepted after rollback,
its replay adds nothing, and the public evaluator reports exactly one eligible
visit, one clicked visit, one accepted selection and zero impressions. The
addressed report read is identical and does not change the incumbent pointer.
Receipts: `2575-catalog-visit-candidate.log` and
`2575-catalog-counts-candidate.log`.

Root review found two public-service races/guards: admission lacked the shared
CTR fence before the final-report check, and a rejected promoted admission could
still enter saved delivery. B corrected both and its six native seam tests pass,
including a blocked finalization interleaving and incompatible promoted routing.

The first actual producer-to-promotion candidate rehearsal passed. Forty native
visits produce an inconclusive interim report and a fixed-horizon fixture result
from actual signed selections: 20 control visits (the local incumbent is
explicitly unavailable), 20 challenger visits, 18 clicked challenger visits and
two empty saved-source visits. A refresh leaves the frozen generation selected;
interim, wrong-generation and wrong-digest promotion attempts fail. The exact
final revision promotes, then rollback preserves the report and the producer's
three-call/$0.04 receipt. No report or winner was seeded. This fixture exercises
transitions and denominator handling, not real comparative efficacy or readiness.
Receipt: `2575-catalog-promotion-candidate.log`. Archive/stickiness extensions and
final integrated checks remain pending at this point.

Backend candidate `ac78b3c856d060b18475c73fafec66cbe050efe1` passed normal hooks
and was integrated as `082fc550f`. The temporary candidate config was removed.
The combined native suite passed all 24 cases, and the additional seam typecheck
passed. A first combined run exposed shared extension initialization; schema
fixtures now run serially. A second run exposed a reused refresh fixture ID;
the promotion rehearsal now owns a distinct ID. Neither was a product defect.

The extended rehearsal preserves 21 control visits across 20 browsers and 20
challenger visits with 18 clicked/2 empty after raw expiry. It rejects the
archived UUID, retains browser assignment across a new session, deduplicates
delivery retry, and excludes declared automation and sources outside the frozen
cohort. All raw visits are gone before the final evaluator runs; its complete
per-arm report matches the earlier raw report. The resulting fixture promotion
and rollback still preserve cost and result evidence.

A ninth catalog case now passes actual incumbent recovery: unavailable saved
signer → real native transcript/vector retrieval and incumbent issuance → signed
accepted click → one challenger eligible/clicked/fallback/served visit and zero
unlinked deliveries. The fixture required pgvector in `public`, as expected by
the production retrieval operator, and matching transcript/dub editions. Both
source and catalog test bootstraps now install the extension in `public` before
their disposable schemas. No retrieval service was mocked. Receipt:
`2575-native-incumbent-fallback-playable.log`. Final all-25-case and typecheck
verification remains pending after these fixture extensions.

The full official migration chain through `0137` and all seven ordinary
standalone-retention cases passed on a newly created owned database, which was
dropped afterward. Receipts: `2575-retention-migrate.log` and
`2575-retention-native.log`. This is native migration/retention evidence, not a
production deployment or measured live launch capacity.

## Final manual-control integration review

B's backend `ac78b3c85` and operator `a41a6807a` are integrated as `082fc550f`
and `84ef7ce38`; A's Watch/GraphQL `3112244b7` is integrated as `127b61e1f`.
All three source commits passed normal hooks. The root suite now passes all 25
native build-through-review/control cases (16 source, nine catalog), including
the actual incumbent-recovery path described above. Receipt:
`2575-integrated-build-to-controls-final.log`.

The old Watch retention assertion now includes the two additive audit-cleanup
result fields. Test fixtures install pgvector in public and serialize files
because extensions are database-scoped. A fixed synthetic signer exists only
in the dedicated native test configuration. No production configuration changed.

Browser QA used the actual exported operator component with synthetic readiness
at desktop 1440×1000 and mobile 390×844. Long IDs wrap in the serving pointer;
tables scroll inside their container and the document does not overflow. Live
mode has no fixture prepare/start controls. Expanded details correctly show
0/21 control, 18/20 challenger, 0%/90% visit CTR, isolated_fixture basis and
partial_unverified edge coverage. Unauthenticated prepare and rollback each
showed authentication-required without changing the pointer. No console errors
occurred. Protected page/API responses are 307-to-login / 401.

Four alternating warm local development HTTP samples per mode measured median
112ms baseline / 106.5ms controls, 52,911 / 62,381 HTML bytes, with 22 script tags
in each response. This is a small synthetic rendering observation, not a claim
of faster production loading, FCP or authenticated database-query performance.
Receipt: `2575-admin-browser-receipt.json`. The temporary preview route/server
and auto-added Next guide block were removed; viewport was reset. Generated
preview cache is preserved in /tmp, outside the worktree.

Whole-spec review uses fixed base `d661b99939e24ba41834adce53c6bad9262bcee9`,
with the previously recorded reviews through #2574 and a final sequential
Standards then Spec review of #2575 and connected integration coverage. Standards
review covered app ownership, generated contracts, service caller authorization,
same-origin/recent-auth controls, native transactions, expiry/pins, normal hooks
and default-off deployment boundaries. No remaining confirmed Standards defect.
Spec review reconciled all ten tickets with the approved GA navigation revision,
verified explicit start versus promotion semantics and real fixture counts, and
retained the known acceptance gap: no authenticated live human/bot/tracking-loss
verifier or real agreed inputs. That gap prevents live completion and PR readiness;
it is not relabeled as satisfied by a fixture. Combined checks/CI remain pending.

The first final Admin run found one stale bounded-retention mock and one root
invocation error (`RECOMMENDATION_DB_TEST=0`, which is invalid; it must be unset
for unit tests). The native run additionally exposed a real finalization
regression: #2575's private/public state guard prevented final evaluation of
closed private cohorts. This was returned to B with a requirement to preserve
closed private reporting without reclassifying public evidence. Generation
retention's three authentication failures were a missing synthetic ingest key
in the root runner. Initial logs are preserved with `-initial-fail` suffixes;
final combined checks must pass after the fixes before publication.

The finalization finding is fixed in worker `452fd51dc`, integrated as
`8401049c1`. Closed private cohorts are recognized by frozen private eligibility
policy (including the historical v1 identity); a closed public cohort cannot
be evaluated by the private entry point. The new native regression proves both
outcomes. The bounded-retention fixture now models tagged-template SQL correctly
and tests both empty and full audit-event batches. Worker focused verification:
35 retention/CTR cases and Admin typecheck passed; the original late-event case
also passed. Normal lint-staged and whole-repository formatting hooks passed.
Root's additive Watch cleanup-result assertion remains in the integration diff.
Standards and Spec review of the fix found no remaining confirmed defect; the
full integrated verification is rerunning with corrected fixture environment.

The post-fix integrated rerun passed the full Admin suite: 572 files, 9,019
passed tests, 810 expected skips and one todo. All 42 focused native
control/Watch/CTR/generation-retention cases and all 25 connected source/catalog
cases pass on the integrated revision. Receipts: `2575-final-admin-full.log`,
`2575-final-admin-native.log`, `2575-final-connected.log`. The new closed-cohort
regression and the root-owned additive retention assertion pass together.

The complete final runner exited zero on `8401049c1` plus the task-owned root
integration tests. Admin and connected-seam typechecks passed; Next route types,
Admin SDL and gql.tada client generation completed with zero generated drift.
No temporary preview route or Next instruction change remains in the diff.
Receipts: `2575-final-{admin-typecheck,seam-typecheck,next-typegen,schema-print,client-generate,generated-drift}.log`.
Final root verification is committed with normal hooks; the PR records the
published head and CI run. #2575's code/fixture acceptance is verified, while
live verifier implementation and real deployment/measurement/capacity inputs
remain incomplete. #2573–#2575, parent #2565 and feat-590 are not marked complete.

## October 7 continuation: deployed GA identity and one-month decision

The owner requested completion of live verification, the real catalog report,
and capacity work, with a working local demonstration before production merge.
One month means a UTC calendar month with day clamping, followed by incumbent
serving and manual reevaluation. Other numeric thresholds remain unapproved.
Workers A/B resumed from `5c9f38c6f`; the root owns real-input preparation.

The already-deployed Mastra credential for
`forge-seo-production@jfplab.iam.gserviceaccount.com` successfully read property
`320198532` using only `analytics.readonly`, restricted to the two approved
JesusFilm.org hosts and exact `/watch` plus descendants. The actual GA reader
then passed its historical coverage read through October 4: 4,006,916 reported
video starts, complete aggregate pagination and an explicitly missing prefix
before August 6, 2022. This is reporting coverage, not verified raw-event history.
No credentials or raw viewer records are in these receipts.

Mastra now accepts optional sealed `PRECOMPUTED_GA4_CREDENTIALS_JSON`, bound to
the configured service-account email/project. The existing credential parser
strips arbitrary token endpoints. Malformed or mismatched explicit credentials
fail closed, without falling back to ADC; absent credentials preserve operator
impersonation. The focused tests passed 40 cases, the full Mastra suite passed
3,267 with 44 configured skips, and typecheck/lint passed. A failing credential
test preceded implementation. Sequential Standards and Spec review against
`5c9f38c6f` found no remaining defect in this auth change; live readings verify
the external boundary beyond mocked token transport.

On October 6 at 20:30:58 UTC the three GA configuration values were staged in
production Mastra using `--skip-deploys`. The credential uses Railway's reference
to the existing `SEO_GOOGLE_CREDENTIALS_JSON`; read-back verified resolution and
the exact property/principal. No deployment or experiment activation was
triggered. The new code still requires the normal reviewed PR deployment.

Capacity readings at 20:19:05 and 20:19:12 UTC measured 26,275,043,007 database
bytes and 22,404,128,768 free PGDATA bytes on cluster `7655660030928953395`.
A later 20:31:40 snapshot had 22,398,713,856 free bytes. These point-in-time
observations are not an approved build projection. The separate storage owner
reports 86 failed October 6 scheduled retention attempts; its ongoing repair
remains separate from this work, and no purge/cleanup was triggered here.

Sanitized receipts under `/tmp/forge-feat-590-orchestration`:
`20261007-existing-runtime-ga-access.json`,
`20261007-deployed-credential-reader.json`,
`20261007-ga-staged-configuration.json`,
`20261007-production-pgdata-capacity.txt`, and
`20261007-{ga-auth-focused,mastra-typecheck,mastra-full,auth-lint}.log`.

## October 7 real catalog and input-policy verification

The read-only production content snapshot at `2026-10-06T20:48:05.001Z`
completed export at 20:58:48 UTC and import into the isolated local
`forge_capacity.catalog_producer_actual_20261007` schema at 21:01:24 UTC.
It contains public catalog metadata and transcript text, with no viewer data,
embeddings, or production writes. Its 280,046 stored chunks match the declared
counts of all 164,639 transcript records. The Admin catalog boundary confirms
1,031 eligible Videos.

A 40-video transport page repeatedly exceeded the existing five-second
transaction deadline on translated films, including after local ANALYZE.
Ten-video pages traversed the same complete catalog successfully without
widening production deadlines. The producer now requests those smaller pages.
Seventy-four real chunks exceeded the initial 5,000-character guard (largest:
8,035); the bounded guard now permits 8,192 characters without truncation.
A failing native boundary test preceded the change; long-text success and
oversized rejection both pass.

The owner approved complete English per Video Edition with complete
non-English fallback. The native boundary test first returned every translation
and failed, then passed with the new deterministic selection: English first,
otherwise language and transcript ID in code-point order. Every stored passage
of a selected transcript is returned. Incomplete transcripts are ineligible,
and selection identities, counts and skipped editions are explicit. A fresh
full catalog read selects 1,226 complete transcripts and 2,686 chunks, including
three non-English fallbacks, with zero skipped editions that have transcript
records. All 1,031 eligible Videos remain. Six native catalog cases pass.

Sequential Standards and Spec review of the catalog-policy diff found one
provenance defect: a zero-chunk transcript was excluded but not counted as
incomplete. A native failing assertion reproduced it; the summary now counts
it as incomplete and reports its skipped edition. Admin and Mastra typechecks
and scoped ESLint passed. The review found no remaining standards or spec
finding in this bounded input-policy change.

The first real two-video source pilot used GA and exact Astra via OpenRouter.
Summary, history-plan and discovery calls succeeded and reported $0.0827775
in total. The final judgment was rejected with HTTP 400 because the generated
evidence schema contains unsupported `oneOf`. The generation is correctly
failed with no accepted connections. A minimal real request reproduced
`invalid_json_schema`; this is an implementation defect being fixed, not a
credential or model-access blocker. These pilot costs are not a full catalog
cost report, and failed/unknown-cost attempts remain explicit.

Artifacts: `/tmp/forge-feat-590-real-catalog-20261007/{export-receipt,import-receipt,catalog,transcript-dimensions,two-video-pilot}.json`;
`/tmp/forge-feat-590-orchestration/20261007-{imported-catalog-inspection,selected-catalog-inspection,language-selection-red,language-selection-green,catalog-bounds-final}.log`;
`20261007-astra-judgment-schema-error.json` in the same orchestration directory.

PR #2578's published `9d2ff9944` checks have 42 successes and three skips;
only upstream Expo patch drift and its dependent CI gate fail. The separate
maintenance PR https://github.com/JesusFilm/forge/pull/2599 aligns seven Expo
packages. Commit `3b2063d60` passed normal hooks and all 26 applicable CI checks,
including Expo Doctor, Mobile, Auth and TV checks (six configured skips).
It has not been merged and publishes no Mobile binary.

## October 7 durable real-data pilot and preview recovery

The provider schema correction is integrated as `0636bf861`: evidence uses
`anyOf`, the strict-schema optional explanation is nullable on the wire, and
null is normalized before persistence. The old failed source pilot remains
visible. The new `actual-durable-two-video-pilot-20261007-v1` completed both
sources with two accepted connections through native Admin durable ingestion.
Eight model calls reported 14,383 input and 1,394 output tokens, with $0.2494275
known cost and no unknown model charges. Thirteen GA request receipts have
unknown byte/cost figures; those are not zero-cost claims. All 29 source rows
mapped, with three qualified referrer-navigation events. The successful resumed
session ran from 21:42:54 to 21:47:02 UTC on October 6; durable elapsed time
includes an earlier authentication interruption.

The full `actual-full-catalog-20261007-v1` manifest includes all 1,031 Videos.
Its first source saved summary, plan and discovery checkpoints, then two GA
report calls reached their 50-second deadlines. It remains incomplete with zero
completed sources; the two successful model calls reported $0.161118. Replaying
the same request digest later retrieved all 78 rows across two pages in 26.54
seconds. A bounded offline timeout correction is being validated before resume.
This is not a completed full-catalog cost or production capacity report.

The local full-build capacity observation at 21:47:50 UTC measured 6,468,198,400
available PGDATA bytes, a 5 GB reserve and 760,135,680 projected build bytes.
Its sample is the total physical precomputed relations after two completed
pilot sources, including shared/empty-table overhead, scaled conservatively.
It is not an attributable per-generation allocation or production admission.

The real Next Admin preview exposed a PrismaPg boundary defect: `schema=` in
the database URL did not select the model-query namespace. Native tests of both
application pools returned null from public instead of the isolated seeded row.
The adapter now receives the selected schema explicitly, while preserving the
raw libpq URI and the existing 10/5 pool budgets. The authenticated local pilot
page then returned HTTP 200 and rendered complete status, both saved connections,
provider charges, GA qualification and transcript-backed explanations. These
are HTTP-rendered observations; browser visual verification remains pending
because the browser surface disconnected at the interruption. The temporary
loopback-only demo sign-in harness is excluded from commits and deployment.

Receipts are under `/tmp/forge-feat-590-real-catalog-20261007`:
`pilot-durable-report.json`, `pilot-durable-calls.jsonl`,
`full-durable-report.json`, `full-durable-calls.jsonl` and capacity observations.
Native red/green and local server logs are under
`/tmp/forge-feat-590-orchestration/20261007-*`.

## October 7 GA recovery, strict-evidence failure and host preview

GA timeout source `08f5b05c9` is integrated as `de5a20bf2`. Detailed Watch
start/referrer reports receive a bounded 120-second timeout with two attempts;
summary/coverage reports retain 50 seconds. The same failed request digest was
replayed with all 78 rows. Mastra typecheck, all 3,264 tests, scoped lint/format,
and normal hooks passed. The resumed actual run got through the former timeout,
including a separately recorded HTTP 502 retry after approximately 60 seconds.

The first two full-catalog sources subsequently failed `provider_invalid_output`
after paid candidate judgments returned. This was local strict validation after
successful transport, not GA access or provider JSON-schema refusal. The durable
failure records retained the charges but intentionally removed failed source
checkpoints and provisional choices; the exact invalid field/excerpt is not
recoverable from those receipts. Bounded repair and compact reason codes are
being added without relaxing evidence acceptance.

The operator stopped the runner and cancelled `actual-full-catalog-20261007-v1`
through the authenticated durable service. Its final audit has 34 model call
reservations, $2.3197855 known cost, one unresolved call with unknown charge,
30 completed GA HTTP receipts, and no completed source. The unknown call was
in flight at process stop and is not recorded as free. The saved two-video pilot
is still complete and unchanged. A future full attempt requires a new generation;
no failed-source row or cost ledger was reset. The scratch runner now handles
termination by finishing the current receipt/checkpoint and stopping before
reserving another model or GA call. No further paid run occurred during diagnosis.

PrismaPg selected-schema regression checks pass 5/5, including both real app
pools and libpq multi-host URI preservation; integrated as `cb3a62001` with
normal hooks. Local Watch playback was enriched for the two pilot Videos only
using six public production HLS URLs, with no model-input timestamp changes or
production writes. The real route manifest and Watch page then returned 200.
Authenticated tester exchange and Web-to-Admin GraphQL preview delivery served
the saved Samaritan Woman choice from Nicodemus. Two warm HTTP API responses
were 344 and 218 ms. The initial development compile exceeded the preview
budget and correctly attributed incumbent fallback. These are development HTTP
observations, not production rendering performance or a visual browser check.

At the owner's request, a temporary gateway exposes only GET review/static-asset
paths over the existing Tailscale network, checks the connecting Tailscale user,
and expires after two hours. Its local Admin session stays inside the gateway.
The remotely addressable review returned 200 with the pilot, charges and target
visible. No public internet listener, production activation or serving mutation
was enabled. Browser tooling still has no connected surface; owner visual review
remains pending.

Additional receipts: `full-durable-stopped-report.json`,
`full-durable-cancelled-report.json`, `full-resume-code-provenance.json`, and
`local-playback-enrichment.json` under the real-catalog scratch directory;
`20261007-local-watch-delivery.jsonl` and `tailnet-preview.html` under the
orchestration scratch directory. The resume used the tested worker reader with
an explicit deployed-identity token provider; integration additionally contains
the sealed-credential default-provider branch, which this runner did not call.

## October 7 durable evidence repair and actual browser walkthrough

Worker A's `0784a97bf` and `0cfa3343f` are integrated as `aeb55b991` and
`e4ecc23ad`. Unsupported `themes` metadata evidence is no longer advertised.
Candidate judgment retries once after invalid evidence and supplies only a
bounded reason plus field or chunk identity. It never rewrites a quote to make
it pass. Each charged invalid answer remains a separate cost receipt. Root
review found that the original local attempt counter reset after interruption;
the follow-up persists its count and feedback atomically with that receipt.
A resumed candidate consumes its remaining attempt, or makes no further call
when both attempts were used. Prompt provenance advances to version 3. Existing
failed generations and their charges remain unchanged.

Worker validation: Mastra 3,266 passed and 44 skipped; Admin native durable-build
lifecycle 13/13; Admin and Mastra typechecks, focused repair/resume cases, scoped
lint, formatting and normal commit hooks passed. Root Standards and Spec review
found no remaining issue in the bounded repair after the durability follow-up.

A read-only throughput audit found 1,031 sources times 26 catalog pages, with
one analytics-plan and one discovery call per page: at least 53,612 model calls
before source summaries or candidate judgments. Only two pages have measured
prompt sizes and latency; those do not establish a full-runtime or cost forecast.
The next full paid run remains held while existing retrieval is audited. The
spec permits summaries and retrieval over the eligible catalog and does not
promise exhaustive all-pairs inference; all eligible sources and complete
selected source/target transcripts remain required.

The user requested a host-accessible tunnel. Owner-identity-checked Tailscale
listeners on ports 3315 (Admin) and 3316 (Watch) serve the isolated pilot for two
hours. Admin permits read-only review and assets; Watch permits the two pilot
videos and local recommendation/profile/evidence interactions. The local Admin
session and tester capability stay in gateway memory. The development proxies
forward static assets and HMR, provide UUID compatibility using browser
`getRandomValues`, and supply local Fetch Metadata only after checking the
owner's tailnet identity and exact request Origin. These temporary HTTP-origin
accommodations are not production human-verification or tracking-loss evidence.

Local headless Chromium inspected both actual application pages. The Watch row
served generation `actual-durable-two-video-pilot-20261007-v1`, displayed the
Samaritan Woman card, accepted its selection with HTTP 200, and navigated to
`/watch/jesus-speaks-to-a-samaritan-woman.html`. No Watch JavaScript exception,
console error or failed HTTP response occurred in the final click-through run;
media/telemetry requests aborted by navigation remain visible separately.

The actual pilot exposed a small Admin rendering defect: two excerpts from the
same transcript chunk shared a React key. Keys now distinguish each immutable
passage occurrence, preserving all excerpts. The canonical Admin URL then
rendered without JavaScript/console/network errors or horizontal overflow.
Development DOMContentLoaded was approximately 792 ms for Admin and 354 ms for
Watch in these observations; these are local development measurements, not
production Web Vitals or a comparative production performance guarantee.
The owner subsequently confirmed that the preview looks fine on October 7.
The requested local demonstration is accepted; production merge and activation
remain separate operations.

Receipts under `/tmp/forge-feat-590-orchestration`:
`tailnet-browser-report.json`, `tailnet-browser-admin-report.json`,
`tailnet-browser-watch-report.json`, `tailnet-admin-desktop.png`,
`tailnet-watch-desktop.png`, and `tailnet-watch-click-destination.png`.
The scratch gateways, preview session route and demo entry page are excluded
from commits and deployment.

## October 7 preview acceptance and resource cleanup

The owner requested cleanup because the host was running short of memory.
After acceptance, the orchestrator stopped only the task's two preview gateways,
Admin/Web development servers and temporary preview Redis. Ports 3300, 3313,
3315 and 3316 are no longer listening. The host links are intentionally offline.
The paid-data PostgreSQL clone remains available for the remaining native
checks and selected-transcript retrieval audit.

Removed approximately 1,823 MiB of disposable preview caches from `/tmp` and
404 MiB of generated Admin/Web server, static and log files. Generated route
types, source worktrees, screenshots, selected catalog inputs and actual build
receipts were preserved. Available memory rose from roughly 4 GiB before server
shutdown to 13 GiB afterward; this is a point-in-time host observation, not an
application memory benchmark. Unrelated containers and work were left alone.

The exact paid-result table archive, build JSON/JSONL receipts, catalog manifest,
browser reports and screenshots also have a protected copy at
`/home/nisal/.local/share/forge/feat-590-evidence-20261007`, with SHA-256 checksums.
The initial small archive preserves precomputed result tables. A subsequent
198,328,843-byte custom-format dump also preserves the full actual catalog schema
(`actual-catalog-schema.dump`, SHA-256
`978851f19f1bdc528c4a1d4ef0def2b17530326355748c309bfb1c7feb52f361`).
Its table of contents contains 251 table-data entries. Restoring it into a new
disposable database succeeded, preserving 1,180 Videos, 164,639 transcripts,
280,046 chunks, three generations and 46 model-call records, including pending
reservations. The durable pilot's
eight calls and $0.2494275, and the cancelled full attempt's 34 calls,
$2.3197855 known charge and one unknown charge, matched the saved records.
The disposable restore database was removed after verification. The original
public-content export remains available separately; source and original paid
data were not removed. The restore receipt is `catalog-backup-restore.json`
beside the protected archive.

Root's corrected native durable-build run passed all 13 cases, including the
persisted repair-attempt limit. Its initial run omitted the local fixture ingest
bearer environment variable and failed authorization; rerunning with that fixture
configuration passed. The Mastra catalog-generation cases passed 5/5. The Admin
excerpt-key fix and walkthrough record committed as `94a8e7912` through normal
lint-staged and full-repository formatting hooks.

## October 7 bounded retrieval feasibility

Worker A's scratch prototype indexed exactly the fixed 1,031 eligible Videos and
the selected 1,226 complete transcripts / 2,686 chunks (4,055,511 characters).
It includes all 172 metadata-only Videos and all three non-English fallback
cases. Five deterministic metadata, transcript, keyword, Bible and structural
lanes were combined without claiming semantic understanding. Two runs took
approximately nine seconds each, peaked at 299 MiB RSS, and produced identical
ordered-pool digest
`4b9bc61c5db77cb0259d331247fe0129c6d2ee956fe5e200f53fe92f31099cfb`.

The two saved directed pilot connections ranked 14 and 27. A depth of 12 missed
both, 24 missed one, and 40 included both. Two accepted connections cannot
establish recommendation recall. The independently defined structural and
fallback catalog proxies also exposed misses; these proxies are not judgments
that a link is worth recommending. No candidate depth was selected or integrated.
The measured reduction curve counts plan/discovery calls only, excluding source
summaries, judgments, retries, GA requests and provider costs.

The current integration already enforces the approved per-Edition transcript
selection at its authenticated catalog/chunks boundary. An initial worker audit
read its older checkout and incorrectly described that policy as missing; the
worker corrected the report against `94a8e7912`. Remaining work is retrieval
quality and generation binding, not another transcript-selection implementation.
The follow-up read-only production check found all 2,686 selected chunk IDs and
all 1,226 selected Edition transcripts fully covered by non-null, 1,536-dimension
vectors matching active storage contract `semantic-transcript-pgvector-v2`.
Every chunk/transcript identity, row timestamp and raw-text hash matched the
exported snapshot at or before the cutoff. All three fallback transcripts were
covered. This establishes compatible current vectors and matching selected rows,
not independent proof of the embedding's exact input-text lineage.

The public Watch visibility rule admits only 2,664 of those chunks: it excludes
the selected Amharic transcript's 22 chunks. The production transcript projection
authority table has no rows, so no selected chunk was qualified against a declared
physical Typesense collection. That does not establish that Typesense itself is
empty. The existing Postgres vectors support a bounded supplemental semantic
prototype; the broad public Typesense index remains unqualified for this build.

Reproduction and reports:
`/tmp/forge-feat-590-real-catalog-20261007/retrieval-audit/`.
The audit made no paid model calls or production writes and left the worker
branch clean.

## October 7 current-main integration and compiler memory

Merged main `5bed7ef5b` as `3a07547f1`, then integrated B's live-readiness,
immutable launch-evidence and capacity changes as `9055913ed`. The integration
retains root's complete per-Edition transcript policy and A's durable bounded
candidate repair. Normal lint-staged and full-repository formatting hooks passed.

Main's unrelated migrations share numeric prefixes with this feature. The native
recommendation fixture's numeric filename filter accidentally included Studio and
push migrations. In a new disposable database, the existing playback test failed
on the missing `short_source_snapshot` relation. Selecting migrations by their
`precomputed` name fixed the fixture: playback (18), profile candidates (4) and
profile projection (16) passed, 38/38 total. No actual catalog schema was used for
the failing migration reproduction.

The combined native precomputed suites passed 76 unique cases after correcting
the test environment. The initial run omitted the preview-enable flag, causing
seven Watch authorization failures; all 22 Watch cases passed with the flag set.
The other nine files had already passed and were not needlessly repeated.

Full Admin typechecking exhausted an 8 GiB heap both with and without its saved
incremental cache. A focused compiler probe traced a large comparison to a
narrowly inferred native-fixture Prisma constructor assigned to the default
`PrismaClient` type. Explicit `PrismaClient<Prisma.PrismaClientOptions>` constructor
typing preserved runtime behavior and removed that extra structural comparison.
On the same route test, compiler heap fell from about 2.1 GB to 1.5 GB and check
time from 16.0 s to 4.0 s. The type-only change was applied to 14 feature fixtures.
Full fresh Admin `tsc --noEmit --incremental false --extendedDiagnostics` then
passed in 228.25 s at the existing 8 GiB limit, with 8,208,826 KiB reported memory.
Task-owned failed compiler processes and their verified crash dumps were removed.

Logs in `/tmp/forge-feat-590-orchestration`:
`20261007-migration-scope-red.log`, `20261007-migration-scope-green.log`,
`20261007-combined-live-native.log`, `20261007-combined-watch-native.log`,
`20261007-prisma-assignment-baseline.jsonl`,
`20261007-prisma-assignment-explicit-options.jsonl`, and
`20261007-combined-admin-explicit-options-typecheck.log`.

The connected native build-through-Admin suite passed 25/25 after updating its
controlled model replies to include the required nullable added-viewing-value
field and its public fixture windows to one UTC calendar month. The unsupported
`themes` output now explicitly expects an unknown-usage receipt when provider
schema parsing fails; supported-but-unavailable `keywords` retains known usage.
The finalization check advances beyond both the month cutoff and raw expiry.
These fixture corrections leave production validation and usage accounting
unchanged. Standards review found no convention violations; Spec review confirmed
the approved month window, explicit unknown usage, and retained native end-to-end
assertions rather than bypassing the newer contracts.

B's additional capacity test is integrated as `f9f936409`, with the same explicit
Prisma options typing. Its root native run passed 1/1, covering refused thin
samples, persisted append-only receipts, ordinary unlinked request accounting and
database immutability. Logs: `20261007-combined-connected-native-red.log`,
`20261007-combined-connected-native-fixture-progress.log`,
`20261007-combined-connected-native.log` and
`20261007-combined-capacity-native.log`.

## October 7 native CI coverage and dependency repair

All 143 official migrations, including both `0138` directories and
`0139_precomputed_live_launch_evidence`, applied successfully to a fresh local
database. The database was removed after validation. Admin SDL and gql.tada
regeneration produced no diff. The connected integration TypeScript project also
passed. Logs: `20261007-full-official-migrations.log`,
`20261007-schema-print.log`, `20261007-admin-graphql-generate.log`,
`20261007-schema-drift.log`, and `20261007-combined-integration-typecheck.log`.

The existing CI job did not enable this feature's native tests. Added an owned
`forge_precomputed_control_test` database and explicit synthetic fixture settings
to run the precomputed directory, authenticated producer route and connected
source/catalog suite. The Web Redis job now also runs the authenticated measurement
route. File concurrency is explicitly disabled to bound shared database and host
load. These checks require no live GA, model or human-proof credentials.

The exact new commands passed locally: 122/122 precomputed/producer cases,
25/25 connected cases, and 12/12 Redis cases. The 122 cases include the verified
baseline fixture and loaded cleanup of 6,715 request/visit roots and 34,395 items.
Cleanup used 68 bounded runs, 43.805 seconds total and 720 ms maximum per run.
This is synthetic retention evidence; PostgreSQL relation allocation did not
shrink and it is not production human-traffic capacity evidence. The owned
temporary database and Redis container were removed afterward. Logs:
`20261007-ci-precomputed-native.log`, `20261007-ci-precomputed-connected.log`,
and `20261007-ci-web-measurement-native.log`.

The published `a9cbf8362` CI run exposed main's known Expo compatibility failure.
The integration incorporates the already-reviewed repair from
[PR #2599](https://github.com/JesusFilm/forge/pull/2599), commits `3b2063d60`,
`1a847ea1c` and `c4573155d`. That repair's 29 successful/six skipped checks include
online Expo validation. The maintenance PR subsequently merged separately as
`89f0f99a6`; the feature PR remains unmerged. Frozen lockfile-only
validation passes locally without installing another dependency tree. The native
capacity test's diagnostic payload parameter is now `Prisma.InputJsonObject`,
matching Prisma's JSON input contract without a type assertion.

The same published run exposed 25 failures in the ordinary retention and
selection unit fixtures: their mocked transactions lacked the new baseline
and launch-capacity delegates. Added empty baseline/capacity results and an
unbound baseline request link without changing existing assertions. Both
files now pass all 47 cases. Sequential Standards and Spec review found no
remaining issue in this CI repair: the new native checks exercise the real
seams, and the ordinary tests continue to verify their original behavior.
Logs: `20261007-ci-admin-test-failed.log`,
`20261007-ci-legacy-fixture-green.log` (intermediate failure), and
`20261007-ci-legacy-fixture-green-final.log`.

A separate read-only production snapshot at 2026-10-07T01:11:28Z found
26,442,077,887 database bytes and 11,210,350,592 bytes in recommendation relations.
The PGDATA filesystem had 22,118,305,792 bytes available out of 48,891,670,528.
There were no deployed precomputed relations. This is a physical snapshot, not a
launch receipt: actual full-build growth, verified baseline traffic and fresh
capacity attestation remain required. The protected
`production-physical-capacity.json` records its timestamp and cluster binding.

## October 7 retrieval integration

Worker A delivered `31dfe6fe6` and `b717ec718`, reviewed against `9055913ed`
on separate Standards and Spec axes. The catalog workflow now reads every
complete selected transcript and builds deterministic candidate pools from
catalog text, direct structural links, exact keyword/Bible overlap and protected
metadata-only/non-English candidates. All eligible source/target IDs and the
full GA route catalog remain available. The selected corpus, ordered pools and
policy revision bind the generation digest; stale transcript identity fails
before opening a generation. Accepted edges still require Astra judgments and
the existing strict evidence validation.

Two actual-catalog retrieval runs produced the same digest across 1,031 Videos
and 2,686 chunks, using at most 310 MiB RSS. The 56,291 candidate pairs require
4,128 initial plan/discovery calls, versus 53,612 for exhaustive pages. These
counts exclude judgments, repairs and GA calls. This is a runtime/work forecast,
not a cost or quality result. An independent 12-source comparison retained
64/180 top semantic neighbors, 184/184 direct structural pairs, 266/723
shared-keyword pairs and 236/722 shared-Bible pairs. These are diagnostic proxy
overlaps; omitted pairs are not negative labels or measured recommendation recall.

Worker validation passed 3,275 Mastra tests (44 skipped), eight focused cases,
nine connected catalog cases, Mastra typecheck/lint and normal format hooks.
Root review found no remaining Standards or Spec issue in this slice after the
typed `input_stale` correction. The bounded real-model comparison remains
separate from these deterministic checks and precedes the next full build.
The combined root checkout also passed all eight catalog unit cases and all
25 native source/catalog integration cases. Logs:
`20261007-retrieval-integrated-unit.log` and
`20261007-retrieval-integrated-connected.log`.

The CI repair is committed as `ba0376723`, but GitHub rejected its push because
the CLI OAuth login lacks the `workflow` scope needed to edit
`.github/workflows/ci.yml`. A device authorization request is pending with the
owner. The remote PR still points to the older `a9cbf8362` until publication
succeeds; no green published-head CI is claimed for these local repairs.
