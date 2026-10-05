# Precomputed recommendation orchestration

Updated: 2026-10-05 (Pacific/Auckland).

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
| #2573 | #2572        | Ready for dispatch               | Unassigned                                                     | None                                           |
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
unused ID, `feat-607`, with its existing plan/report/index references updated.
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
