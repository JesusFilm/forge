# feat-435 closure audit and dashboard receipt

Inspected September 22, 2026 for Ops J030. **Status: feat-435 complete under
Jaco’s explicit Option A closure decision; draft PR #2379 remains unmerged.**

This is the substantial investigation report required by J030 and the proof
receipt named by [feat-435](../../feat-435-rag-proof-soak-archive.md). The consumer
inventory is consolidated below rather than creating another evidence family.
Scope and review plan: [J030 plan](../../../../plans/2026-09-22-j030-rag-proof-soak-plan.md).

## Operator acceptance — September 22, 2026 (Option A)

After reviewing the initial audit, Jaco explicitly revised feat-435's closure
gates in the J030 continuation instruction:

- **Owner attestation:** Forge RAG is already the active owner and all consumers
  have migrated. No external traffic is in scope. This resolves migration and
  consumer/operational closure; it does not create a measured soak interval or
  an independently verified live consumer inventory.
- **Not applicable:** rollback rehearsal/expiry and final snapshot retention.
  These historical gates are superseded for feat-435, not reported as performed.
- **Deferred:** legacy JesusFilm-RAG service and credential retirement moves to
  [feat-532](../../feat-532-rag-legacy-service-credential-retirement.md), which is
  not started and does not block feat-435. No production or credential action
  is authorized in J030.
- **Accepted limitations:** unverified GotQuestions Icelandic import provenance
  and missing direct migration-record/`apps/rag/AGENTS.md` links in the archived
  README. The basic Forge directory redirect is sufficient for this closure.
- **Delivery:** update draft [PR #2379](https://github.com/JesusFilm/forge/pull/2379)
  without merging. The verified dashboard candidate remains prepared for the
  normal PR-to-main publication flow, not published or live-accepted by this job.

This explicit scope replacement follows the owner-managed disposition pattern
in [feat-433](../../feat-433-rag-dual-operations.md). The matrix below preserves
historical evidence gaps while recording their current disposition. No remaining
owner decision blocks the bounded J030 documentation/status outcome. Separate
production-maintenance proof in feat-471 and future consumer-programme work are
not completed or cancelled by this migration attestation.

## Authority and investigation coverage

- [RAG lane conventions](../../CLAUDE.md): status describes what lands in the
  current PR; completion requires a `## Resolution` with its Forge PR before
  merge. Neither an archive flag nor a task requesting closure supplies missing
  acceptance evidence.
- [Historical programme #130](https://github.com/JesusFilm/jesusfilm-rag/issues/130)
  and [final step #168](https://github.com/JesusFilm/jesusfilm-rag/issues/168):
  inspected issue bodies and comments; both are still open in the archived repo.
  Their historical final gates required more than repository archival; the
  Option A decision above now governs Forge-local closure. These archived
  issues were not edited or closed.
- Inspected current Forge `main` at
  `0f7bbe19586df2456942ce929b62a8cef5792377`, RAG roadmap/evidence, relevant plans,
  the GotQuestions slice, operator guides, related solutions, and `todos/`.
  Searched Forge PR history for `feat-435`, Icelandic, and soak, and the legacy
  repository tree for migration/soak/snapshot/consumer receipts. No relevant
  unresolved `todos/` finding or retained final-soak receipt was found. This is
  repository evidence coverage, not a search of private operator records.
- [PR #2186](https://github.com/JesusFilm/forge/pull/2186) is still open; its
  September 7 production baseline JSON is not on `main`. Its reported recall@10
  0.949519 and coverage 0.803193 remain descriptive, without an identity-matched
  historical comparator. The September 8 decision in
  [PR #2189](https://github.com/JesusFilm/forge/pull/2189) accepts that baseline
  for acquisition with concerns in [feat-463](../../feat-463-rag-baseline-concerns-investigation.md).
  It does not accept soak, retirement, or an unrecorded post-import evaluation.

## Closure matrix

| Requirement                                   | Established evidence                                                                                                                                                                                                                                                                                                                          | Revised disposition and retained limitation                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small-source end-to-end maintenance proof     | [Local slice](../../../../../apps/rag/docs/slices/gotquestions.md), [feat-466](../../feat-466-gotquestions-icelandic-slice.md), and [PR #2202](https://github.com/JesusFilm/forge/pull/2202): 51 documents, 142 chunks/embeddings, local retrieval and 431-case evaluation. Fresh dashboard observes 51 embedded `gotquestions/is` documents. | **Accepted limitation.** Jaco recalls the production import; its time, operator, path inventory, deltas, model/dimensions, pending rows and before/after production evaluation are unproven. Local proof used a legacy-checkout embedding credential and is not exclusive Forge production provenance. [Feat-471](../../feat-471-rag-production-operations-rollout.md) remains separate and non-blocking. |
| Production ownership and Seeker/NanoClaw soak | [Cutover receipt](../feat-434/seeker-cutover.md) records a successful September 3 grounded turn on the Forge private route; [feat-433](../../feat-433-rag-dual-operations.md) records owner-managed operations completion.                                                                                                                    | **Accepted owner attestation:** Forge RAG is active owner and all consumers migrated. A dated soak interval, repeated smoke/eval results and independent current deployment inventory were not supplied and are not invented.                                                                                                                                                                             |
| All consumers accounted for                   | Repository-reference inventory below plus Jaco's explicit all-consumers-migrated confirmation.                                                                                                                                                                                                                                                | **Accepted owner attestation.** External traffic is outside this closure scope; this is not a measured claim of zero external callers. Personal operations evidence remains private under feat-433.                                                                                                                                                                                                       |
| Rollback rehearsal and approved expiry        | Historical cutover receipt contains a rollback procedure, explicitly without rehearsal/interval proof.                                                                                                                                                                                                                                        | **Not applicable** under Option A. No rehearsal or expiry action was performed or inferred from the repository archive.                                                                                                                                                                                                                                                                                   |
| Final snapshot, retention owner and recovery  | [Production-copy receipt](../feat-430/production-copy-reconciliation.json) records pre-copy backup `railway-backup:3b65f69d-96aa-4ddc-a306-53ff9a7af982`, cutoff `2026-08-28T01:43:58.992Z`; [copy runbook](../../../../../apps/rag/docs/ops/corpus-copy.md) describes historical recovery.                                                   | **Not applicable** under Option A. The pre-copy reference is not relabelled a final retirement snapshot. J030 took or inspected no backup.                                                                                                                                                                                                                                                                |
| Legacy service/credential retirement          | No retirement receipt found.                                                                                                                                                                                                                                                                                                                  | **Deferred to feat-532**, not a feat-435 completion prerequisite. No live service, credential store, or consumer setting was changed or inventoried.                                                                                                                                                                                                                                                      |
| Repository archived                           | GitHub API returned `archived: true` on September 22 and `updated_at: 2026-09-16T06:40:15Z`.                                                                                                                                                                                                                                                  | **Verified repository state.** The update timestamp is not an archive-event timestamp or proof of operational retirement.                                                                                                                                                                                                                                                                                 |
| README redirect                               | [Pinned README](https://github.com/JesusFilm/jesusfilm-rag/blob/2170bf9fde56088a85e2920076d981dcd623b883/README.md), merged [legacy PR #169](https://github.com/JesusFilm/jesusfilm-rag/pull/169), prominently links to Forge `apps/rag`.                                                                                                     | **Basic redirect verified; missing direct links accepted.** The notice still says “will be archived soon” and lacks direct migration-record/AGENTS links. J030 does not unarchive or change the repository.                                                                                                                                                                                               |
| Dashboard refresh                             | Snapshot, compiled artifacts, local browser/load checks and allowlisted Pages assembly below.                                                                                                                                                                                                                                                 | **Prepared and verified locally.** Merge, publication and live acceptance remain separate; this PR does not claim them. The [historical publication receipt](../feat-432/dashboard-publication.md) retains its original limitations.                                                                                                                                                                      |

## Consumer inventory

This is a bounded inventory of repository references. Jaco’s Option A
attestation supplies the all-consumers-migrated disposition for this closure;
the inventory itself is **not an independent live audit**. External traffic is
outside this scope. Do not read bearer registries into evidence.

| Consumer or surface                                                           | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeker / Forge Mastra, Railway-private `/v1`                                  | The [cutover receipt](../feat-434/seeker-cutover.md) establishes the September 3 transition and smoke. Current migration is owner-attested under Option A; no measured soak is claimed and rollback expiry is not applicable.                                                                                                                                                                                                                                                   |
| Personal VM / NanoClaw operations                                             | [Feat-433](../../feat-433-rag-dual-operations.md) and [PR #2152](https://github.com/JesusFilm/forge/pull/2152) explicitly replace Forge-owned task variants with owner-managed external administration; details stay in the private operations system. That historical completion excluded live acquisition/indexing/migration/language writes. Option A supplies current migration acceptance, without publishing personal configuration or inventing soak/alias measurements. |
| RAGBot / `forge-rag-retrieve`                                                 | [Consumer programme](../../../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md) and [feat-529](../../feat-529-rag-consumer-dogfood-migration.md) describe future real HTTP dogfood; the task definition is not tracked here. This is planning, not live consumer migration evidence.                                                                                                                                                                              |
| NextSteps, Forge content production, JesusFilm-AI, other public `/v1` callers | The pinned legacy README names these intended consumer categories, not an exhaustive deployed-client roster. Jaco confirms all consumers migrated and excludes external traffic from this closure. These historical categories are not newly verified deployed callers.                                                                                                                                                                                                         |
| Public status page                                                            | Static GitHub Pages artifact, with no runtime database or Railway dependency. Publication checks do not prove retrieval consumers' soak.                                                                                                                                                                                                                                                                                                                                        |

## Icelandic observation and provenance boundary

Jaco's J030 brief reports the Icelandic import **from recollection**. The fresh
approved dashboard read independently observes 51 embedded documents labelled
`is` under `gotquestions`, consistent with the local slice count. The only
inventory change versus the previously committed snapshot is that additional
source/language cell and its 51 documents: GotQuestions totals rise from 10,558
to 10,609 and all-source embedded documents from 24,556 to 24,607.

That agreement does not identify the importer or import mechanism. The query
counts documents having at least one chunk embedding; it does not verify the
51 canonical `/islenska/` article paths, all chunks, vector dimensions, model
identity, raw staging completion, absence of pending work, or retrieval quality.
The `acquire` flag is source-wide. `evaluate: true` combines observed inventory
with the existing lifecycle `evaluate: green` from the **local** slice; it is
not a fresh production golden-run result. No lifecycle or golden data changed.

Apply the established [evidence/limitations pattern](../../../../../apps/rag/docs/slices/gotquestions.md#limits-and-dispositions):
retain measured facts and run identity, attribute operator statements, say which
comparison was not run, and keep missing acceptance separate. This follows
[documentation precedent guidance](../../../../solutions/conventions/documentation-precedent-is-not-policy.md).
Do not backfill an import receipt from recollection or relabel a local result
as production proof. Jaco explicitly accepts the provenance uncertainty for
feat-435 closure; acceptance does not establish the missing historical facts.

## Dashboard refresh

Used [status-dashboard](../../../../../plugins/jfp-rag/skills/status-dashboard/SKILL.md)
under the explicit J030 refresh instruction for `read dashboard snapshot`,
`Doppler forge-rag/prd production-read`. No public schema changed. Credentials
were injected only into the approved processes and were not printed or saved
to evidence.

- `status:check`: passed.
- Doppler-wrapped `env:check production-read`: valid. The dashboard command
  enforces the dedicated reader name and exact configured host pin; its fixed
  aggregate queries run inside `SET TRANSACTION READ ONLY` with bounded timeouts.
  This job did not independently re-provision or audit database grants.
- `dashboard:data`: passed, 71 observed source/language rows.
- `dashboard:snapshot:validate`: passed immediately after the read and again
  before compilation. Ignored snapshot remains uncommitted.
- Snapshot time: `2026-09-22T03:52:08.959Z`; source commit:
  `0f7bbe19586df2456942ce929b62a8cef5792377`; schema digest:
  `sha256:927d92d32167d9668b40c8c05f99f3eb8c735aa2e4584aa33d6a9774a4da18e6`.
- `dashboard:build` and `dashboard:verify`: passed; 59 source rows, 75
  source/language cells, 11 documented sources, 4 unclassified rows, 24,607
  embedded documents. Compiler and template are unchanged.
- `pages:assemble -- /tmp/j030-pages-candidate`: passed. Actual
  [manifest](../../../../pages/manifest.yaml) declares **three** files:
  `index.html`, `rag-status/index.html`, `rag-status/.dashboard-commit.json`.
  The skill/runbook's prose mentioning only two HTML files omits the existing
  integrity marker; the manifest and assembler are authoritative. No allowlist
  change was made.
- Assembled digest:
  `sha256:4533b85d9334e415bcff87ebbe732417482b7c107ea561b3ac97b7a0bbf68ad9`.
- Focused dashboard, snapshot, status, skill-layout and Pages suites: **136 tests
  passed in 12 files** under Node 24.21.0, pnpm 9.12.3.

Local preparation is not a claim that
`https://jesusfilm.github.io/forge/rag-status/` serves this candidate. Merge,
Pages deployment, live comparison with the retained standalone page, and
repository-owner acceptance are outside J030's authorization.

### Local browser and load verification

Chromium 153.0.8010.12 served the assembled candidate over loopback. Root and
`/rag-status/` both passed direct navigation and refresh with HTTP 200, one
document request, no external/resource requests, and no page errors. All 59
source-row counts matched `compiled-data.json`; the GotQuestions Icelandic chip
showed 51 and the page showed the snapshot timestamp. Desktop (1440 × 1000) and
mobile (390 × 844) screenshots were visually inspected; the existing mobile
table uses horizontal scrolling. The temporary browser and server were stopped.

Three warm local navigations per version compared the previous committed Forge
page with the candidate; this is **not** the outstanding live comparison with
the retained standalone page:

| Measure                       | Previous committed page |        Candidate |
| ----------------------------- | ----------------------: | ---------------: |
| DOMContentLoaded samples (ms) |        30.0, 28.8, 36.2 | 31.5, 31.6, 40.0 |
| Median DOMContentLoaded (ms)  |                    30.0 |             31.6 |
| Transfer bytes per navigation |                  61,490 |           61,624 |
| Encoded document bytes        |                  61,190 |           61,324 |
| Document / other requests     |                   1 / 0 |            1 / 0 |

Transfer rose 0.218%; median DOMContentLoaded rose 1.6 ms, below the procedure's
5% bytes and greater-of-100-ms-or-10% timing thresholds. No renderer, hydration,
script, media, route, or runtime initialization code changed.

## Initial review and documentation checks

The following checks describe the initial audit before Option A and the new
follow-up ticket. Continuation verification is recorded separately below.

- All 33 RAG ticket frontmatter records and index totals agree: 21 complete,
  1 in progress, 11 not started, 0 blocked. Every intra-lane dependency is
  reciprocal after restoring the existing feat-461 → feat-435 edge.
- Local Markdown links/anchors in the four changed/new documents resolve.
  GitHub API checks establish the archive state, pinned README/commit, and the
  cited historical issue/PR states. No external mutation was used to verify them.
- Hidden-roadmap-lane validator and its two tests passed. The validator emitted
  existing missing-frontmatter warnings for unrelated public-lane tickets;
  the RAG lane remains excluded from public outputs and root totals.
- Changed Markdown and generated JSON pass Prettier; generated HTML is
  intentionally formatter-ignored and passes the exact dashboard verifier.
  `git diff --check` and repository-wide `pnpm run format:check` pass.
- Diff review found only documentation and the three generated dashboard
  artifacts. No credentials, corpus passages, query/result content, lifecycle
  changes, generated GraphQL output, or new public fields were introduced.
  No production acquisition, indexing, evaluation, service mutation, merge,
  deployment, archival, or repository-setting change was performed.

Durable review rule: a current count proves presence, a source lifecycle flag
records a review decision, a repository archive proves a repository state, and
an operational retirement receipt proves its specifically recorded acceptance.
An explicit owner scope decision can supersede a closure requirement; it does
not convert missing historical evidence into an observed pass. Keep private
operator evidence private and record its redacted disposition, as feat-433
already permits.

## Continuation review and verification

Option A resolves the initial input request. Feat-435 is complete under the
revised gates, with a Resolution linking draft PR #2379. Feat-532 tracks deferred
retirement with reciprocal `depends_on`/`blocks` edges. The lane index now has
34 tickets: 22 complete, 0 in progress, 12 not started, 0 blocked. Its historical
soak invariant is qualified by the explicit Option A exception. Feat-471,
feat-463, feat-467, and the consumer programme retain their existing scope.

The already verified September 22 dashboard artifacts are unchanged. This
continuation makes documentation changes only and runs no production read,
credential command, corpus operation, deployment, or repository-setting change.

- `status:check` and `dashboard:verify` passed again under Node 24.21.0 and
  pnpm 9.12.3. No new snapshot or dashboard build was needed.
- Pages assembly into `/tmp/j030-option-a-pages-candidate` passed with the same
  three allowlisted files and unchanged digest
  `sha256:4533b85d9334e415bcff87ebbe732417482b7c107ea561b3ac97b7a0bbf68ad9`.
  Prior browser/load evidence remains applicable to identical artifact bytes;
  no browser or performance rerun is claimed for this documentation continuation.
- All 34 RAG frontmatter records, index rows/totals, and reciprocal dependencies
  passed validation. Feat-532 is the next global ID after 531 in both this
  checkout and freshly fetched `origin/main`; its only dependency is feat-435.
  The feat-435 Resolution links PR #2379 and feat-532 stays not started.
- All 71 local Markdown links/anchors across the five continuation documents
  resolve. Changed Markdown formatting and `git diff --check` passed.
- Hidden-lane validation and both tests passed again, with the same existing
  unrelated public-lane frontmatter warnings. No public roadmap registration or
  generated root totals changed.
- Review confirmed the continuation changes only the plan, lane index, ticket,
  receipt, and new follow-up. It does not cancel feat-471 or claim any deferred
  action was performed. Final-head CI results are recorded in the PR handoff.

## PR handoff

- Draft [Forge PR #2379](https://github.com/JesusFilm/forge/pull/2379).
- Branch/base: `docs/j030-rag-proof-status` → `main`, based on
  `0f7bbe19586df2456942ce929b62a8cef5792377`.
- Initial commits: `3c1931b09` records the audit/dashboard and `6a488bb12`
  records the PR reference. The Option A continuation adds the accepted closure
  and deferred retirement ticket. The original `ops/j030` branch remains untouched.
- Eight changed files: this report, `docs/roadmap/rag/README.md`,
  `docs/roadmap/rag/feat-435-rag-proof-soak-archive.md`, the J030 plan,
  `docs/roadmap/rag/feat-532-rag-legacy-service-credential-retirement.md`,
  `apps/rag/dashboard/compiled-data.json`, and dashboard
  `site/rag-status/{index.html,.dashboard-commit.json}`.
- Required commit hooks ran without bypass, including staged formatting,
  repository-wide formatting, and commit-message validation. Local evidence
  above is complete; remote PR checks are reported separately from those local
  results. Completion follows the explicit owner decision above, not an
  inference from CI success.
