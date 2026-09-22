# feat-435 closure audit and dashboard receipt

Inspected September 22, 2026 for Ops J030. **Status: evidence recorded;
feat-435 remains in progress pending owner evidence/decisions.**

This is the substantial investigation report required by J030 and the proof
receipt named by [feat-435](../../feat-435-rag-proof-soak-archive.md). The consumer
inventory is consolidated below rather than creating another evidence family.
Scope and review plan: [J030 plan](../../../../plans/2026-09-22-j030-rag-proof-soak-plan.md).

## Authority and investigation coverage

- [RAG lane conventions](../../CLAUDE.md): status describes what lands in the
  current PR; completion requires a `## Resolution` with its Forge PR before
  merge. Neither an archive flag nor a task requesting closure supplies missing
  acceptance evidence.
- [Historical programme #130](https://github.com/JesusFilm/jesusfilm-rag/issues/130)
  and [final step #168](https://github.com/JesusFilm/jesusfilm-rag/issues/168):
  inspected issue bodies and comments; both are still open in the archived repo.
  Their final gates require more than repository archival.
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

| Requirement                                                                                                             | Established evidence                                                                                                                                                                                                                                                                                                                             | Remaining limitation or exact closure input                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Small source through acquire, stage, normalize, chunk, embed, index, retrieve, dashboard/eval exclusively through Forge | [Local slice](../../../../../apps/rag/docs/slices/gotquestions.md), [feat-466](../../feat-466-gotquestions-icelandic-slice.md), merged [PR #2202](https://github.com/JesusFilm/forge/pull/2202): 51 documents, 142 chunks/embeddings, local retrieval and 431-case evaluation. Fresh dashboard observes 51 embedded `gotquestions/is` documents. | Local proof explicitly excludes production and used an embedding credential from the legacy checkout. Jaco recalls a production import, but no repository receipt proves its time, operator, path, deltas, model/dimensions, pending rows, or before/after production eval. [Feat-471](../../feat-471-rag-production-operations-rollout.md) remains open. Retain uncertainty; do not infer provenance from counts. |
| Stable production and Seeker/NanoClaw soak                                                                              | [Seeker cutover receipt](../feat-434/seeker-cutover.md) records a successful September 3 grounded turn on the Forge private route. [Feat-433](../../feat-433-rag-dual-operations.md) records owner-managed operations completion.                                                                                                                | Neither supplies a dated observation interval, agreed pass criteria, repeat smoke/eval outcomes, incidents/disposition, or final owner soak acceptance. Elapsed time alone is not a passing soak.                                                                                                                                                                                                                  |
| Every public/private consumer accounted for                                                                             | Partial inventory below; external operations evidence is deliberately private under feat-433.                                                                                                                                                                                                                                                    | Owner must confirm an exhaustive inventory, each consumer's Forge/retired disposition, and relevant smoke/soak result, or supply a redacted pointer to approved private evidence. Do not recreate personal task files in Forge.                                                                                                                                                                                    |
| Rollback exercised or safely rehearsed; expiry approved                                                                 | September 3 cutover receipt documents the rollback procedure and out-of-band values.                                                                                                                                                                                                                                                             | It explicitly disclaims a timed rehearsal and measured interval. Need rehearsal result, approved expiry, approving owner, and decision date. Repository archival is not expiry approval.                                                                                                                                                                                                                           |
| Final jfrag snapshot with retention owner and recovery documentation                                                    | [Production-copy receipt](../feat-430/production-copy-reconciliation.json) records `railway-backup:3b65f69d-96aa-4ddc-a306-53ff9a7af982`, cutoff `2026-08-28T01:43:58.992Z`; [copy runbook](../../../../../apps/rag/docs/ops/corpus-copy.md) describes recovery.                                                                                 | This is the pre-copy snapshot, not a proven final retirement snapshot. Need final reference/cutoff, retention owner and period/location reference, and recovery responsibility, or explicit owner acceptance of the retained snapshot. No backup was taken or inspected by J030.                                                                                                                                   |
| Legacy service/secrets retired after rollback closes                                                                    | No retirement receipt found.                                                                                                                                                                                                                                                                                                                     | Need owner disposition for deployment and legacy credentials, tied to expiry. No Railway service, credential store, or live consumer setting was modified or inventoried in this job.                                                                                                                                                                                                                              |
| jfrag repository archived                                                                                               | GitHub API `archived: true` on September 22; `updated_at: 2026-09-16T06:40:15Z`.                                                                                                                                                                                                                                                                 | Satisfied as an observed repository state. `updated_at` is not an archive-event timestamp or proof of operational retirement.                                                                                                                                                                                                                                                                                      |
| README points to Forge, migration record, and `apps/rag/AGENTS.md`                                                      | [Pinned README](https://github.com/JesusFilm/jesusfilm-rag/blob/2170bf9fde56088a85e2920076d981dcd623b883/README.md), merged [legacy PR #169](https://github.com/JesusFilm/jesusfilm-rag/pull/169): prominent link to `https://github.com/JesusFilm/forge/tree/main/apps/rag`.                                                                    | Basic redirect satisfied. Notice still says “will be archived soon”; it does not directly link the migration record or `apps/rag/AGENTS.md`. Accept the existing directory redirect explicitly or authorize a later archived-repo correction; J030 does not unarchive or change settings.                                                                                                                          |
| Dashboard release evidence                                                                                              | Fresh production-read snapshot, compiled committed artifacts, and local checks below.                                                                                                                                                                                                                                                            | Prepared for PR handoff, not published or accepted. [Existing publication receipt](../feat-432/dashboard-publication.md) records reachability only and explicitly lacks full performance/owner acceptance.                                                                                                                                                                                                         |

## Consumer inventory

This is a bounded inventory of references, **not certification that all deployed
consumers have been found**. Do not read bearer registries into evidence.

| Consumer or surface                                                           | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeker / Forge Mastra, Railway-private `/v1`                                  | The [cutover receipt](../feat-434/seeker-cutover.md) establishes the September 3 transition and smoke. Current soak and rollback expiry remain unproven.                                                                                                                                                                                                                                        |
| Personal VM / NanoClaw operations                                             | [Feat-433](../../feat-433-rag-dual-operations.md) and [PR #2152](https://github.com/JesusFilm/forge/pull/2152) explicitly replace Forge-owned task variants with owner-managed external administration; details stay in the private operations system. That completion excluded live acquisition/indexing/migration/language writes and does not certify final soak or current default aliases. |
| RAGBot / `forge-rag-retrieve`                                                 | [Consumer programme](../../../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md) and [feat-529](../../feat-529-rag-consumer-dogfood-migration.md) describe future real HTTP dogfood; the task definition is not tracked here. This is planning, not live consumer migration evidence.                                                                                              |
| NextSteps, Forge content production, JesusFilm-AI, other public `/v1` callers | The pinned legacy README names these intended consumer categories, not an exhaustive deployed-client roster. Owner must distinguish active, never deployed, migrated, or retired callers and account for any unnamed private consumers.                                                                                                                                                         |
| Public status page                                                            | Static GitHub Pages artifact, with no runtime database or Railway dependency. Publication checks do not prove retrieval consumers' soak.                                                                                                                                                                                                                                                        |

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
as production proof.

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

## Review and documentation checks

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
None substitutes for the others. Keep private operator evidence private and
record its redacted disposition, as feat-433 already permits.

## Decision needed before completion

Jaco must supply or confirm approved operational evidence for the remaining
soak, consumer, rollback-expiry, snapshot-retention, and service/secret-retirement
gates, and decide whether the existing basic README redirect is acceptable.
The Icelandic import may be recorded as an accepted provenance limitation, but
that does not silently waive these independent retirement requirements.
If requirements are intentionally retired, record the exact scope replacement
and owner decision using the feat-433 precedent before marking feat-435 complete.
No new follow-up ticket is needed merely to duplicate these existing feat-435
requirements; feat-471, feat-463, and feat-467 retain their existing scope.
