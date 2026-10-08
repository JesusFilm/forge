# Precomputed recommendation orchestration

Updated: 2026-10-08 (Pacific/Auckland).

Parent: https://github.com/JesusFilm/forge/issues/2565.
Draft integration PR: https://github.com/JesusFilm/forge/pull/2578.
Roadmap: [feat-590](../roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md), in progress.

The [verification and handoff record](2026-10-05-precomputed-video-recommendation-verification.md)
preserves exact source/integration commits, checks, browser artifacts, review
findings, and recovery history. The [CTR operations note](../operations/precomputed-ctr-report.md)
describes the private reporting contract and limits.

## Current checkpoint — October 8, 18:56 NZDT

The GA-only capture is sealed and independently verified. All 305 video-start
pages (152,304 rows) and 327 referrer pages (163,352 rows) matched across the
verification passes. Its 1,835 physical request receipts reconcile to 1,676
successes, 159 failures and zero pending requests. The 16,674,551-byte artifact
has SHA-256 `919ac8f73bc4a7e4b57677ca300acd480ff86e232a9c2723f7ab37e38ee9abd6`.
No catalog model call or source claim occurred in this capture. The wrapper
exited 143 after saving the sealed result; root separately verified closure,
disabled its launch flags and preserved an observed-close receipt. This is not
claimed as a normal wrapper exit.

An isolated PostgreSQL 18 clone was restored from the protected catalog archive
and final sealed control snapshot. Before migrations it verified all 24 sealed
control tables, the 1,031-source manifest and the complete request ledger. Only
0142–0145 were then applied to the clone; the original capture schema is unchanged.
The current Admin origin probe and artifact GET agree with the original bytes,
and the catalog reader matches all 1,031 frozen rows. Protected restore-proof
bundle manifest SHA-256 is
`ae23b05d338d15f818b652ae032cf0b31731db3b31a15250d8f14a2e7d58a71b`.

Admin's destination-owned GA import is integrated as `2f2d2013b`. The connected
Mastra import client/reader copies unchanged origin bytes, verifies destination
intent and preserves navigation provenance with zero destination GA requests.
The integrated import passed 184 Admin cases and 34 connected cases without
skips. Subsequent native tests exposed and fixed the manual runner's missing
history checkpoint, Admin's v4 checkpoint admission and imported report parsing.
The v4 checkpoint accepts only the exact imported-history shape under the active
lease/attempt and verified binding; it cannot rewrite existing evidence or admit
legacy writes. Full Admin typecheck passes with its configured 8 GiB heap.

The manual subscription catalog command is integrated as `82205f030`, with the
worker's checkpoint correction and root native orchestration proof verified.
Root also fixed the checkpoint request's missing execution-attempt identity. It rechecks the frozen catalog, current operator/allowance and measured
capacity; imports the sealed capture; prepares complete profiles; and judges
contiguous candidate pages through shared durable receipts. Every start/resume
remains manual. No paid API fallback or scheduled rebuild was introduced.
The two existing GPT-6 Sol implementation chats supplied the work; no Compound
Engineering workflow or additional implementation chat was used.

The final combined checks pass all 184 Admin tests, all 34 connected tests and
3,501 Mastra tests (45 existing gated skips). Both application typechecks pass.
The native manual command completes two source connections using one shared
controlled model receipt, reports its 200/40 fixture tokens once, and makes zero
new GA requests. This is contract evidence, not live Astra quality or usage.

The clone-only two-source pilot configuration and its HTTP bridge have passed
read-only checks, including bearer rejection, mutation blocking, artifact bytes,
full catalog equality and actual PGDATA/temp headroom. The capacity projection
uses an earlier two-source retained-storage sample and is not a bound on v4
profiles, edges, WAL or production. No real subscription catalog inference has
run yet. The stopped temporary read-only bridge can be explicitly restarted for
the pilot; its private credentials remain local.

Published checkpoint `ce5f25975` has 59 successful CI checks and five skips. An
existing HNSW fixture returned zero candidates on the first run; the failed job
rerun passed without code changes. Later local commits are not claimed CI-green.
The first root Admin typecheck hit the default 4 GiB Node heap limit; its owned
635 MB crash file was removed and the repository's configured check passed.
Heavy validation remains serialized to limit memory pressure.

The first real command invocation stopped during read-only preflight with
`catalog_mismatch`, before generation creation or model calls. All 1,031 videos
and current selected chunks were unchanged; Zod decoding reordered the four
selected-transcript descriptor fields, changing order-sensitive legacy digests.
The narrow decoder fix preserves Admin's existing JSONB serialization. The new
transport regression went red then green, and the full live HTTP read now recovers
the original corpus `9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db`,
pool `0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a`,
and manual input `a488b6b6534db2ca428f6b80c380756399b1c9e7dee0519831689fad7e994c3e`
identities. The sealed artifact, reviewed configuration and hash algorithms are
unchanged. The 18 focused checks, Mastra typecheck and full suite (3,502 passed,
45 existing gated skips) pass. The rejected attempt is protected separately; no
API fallback ran.

The decoder correction is published as `204a9b44b`; the preceding integration
`ff179a669` passed 57 CI checks with five skips. The next explicit pilot passed
catalog preflight and created its v4 generation, then stopped before import or
model work at the capacity gate. The restored clone had two older incomplete
build reservations. Through the authenticated cancellation lifecycle, root
retired only the abandoned v2 reference in that clone; its child evidence,
the sealed v3 origin, protected backups and original database remain unchanged.
Fresh capacity retains the 5 GB reserve and both 634,068,992-byte origin/new-build
projections, leaving 208,440,832 bytes of margin. Protected retirement manifest
SHA-256 is `9cb11ed28a345786a1b6d65de532353c9b3e5ace766d24e1d5c809e34f5e50b5`.

A new native regression reproduces the remaining recovery bug: resuming after
this pre-import capacity stop rejects the legitimately absent import. The narrow
correction is integrated from `8952a3c98`: it re-verifies the sealed origin and
requires a fresh active attempt and passed capacity before preparing the import.
Bound imports retain their reuse path; ambiguous partial imports still refuse.
The native regression went red then green and the integration typecheck passes
after adding the missing Zod dependency alias. All 34 connected cases pass without skips, and the full Mastra suite passes
3,509 cases with 45 existing gated skips. The destination attempt
is closed, all 1,031 sources remain pending, and no subscription catalog model
call or destination GA request has occurred. A fresh manual-resume configuration
is prepared but has not been executed.

The ensuing explicit resume passed capacity but stopped before import/model work
with Admin unavailable. Read-only diagnosis reproduced Prisma `P2028`: the
catalog's default five-second repeatable-read transaction expired. With a bounded
30-second transaction, the full 1,031-video identity derivation succeeds in
50.110 seconds over 1,049 catalog transactions and preserves the original corpus
digest. This also exceeds the caller's prior 30-second request deadline.

The narrow fix extends only `ga_import_prepare_v1` HTTP requests to 120 seconds
and sets catalog transactions to 30 seconds, retaining the snapshot, cutoff,
version and pagination fences. Ordinary requests remain limited to 30 seconds;
no retry is added. The real-lock native regression fails with the old bound and
passes with the new one. Mastra's 35 focused checks, full 3,513-test suite (45
existing gated skips), typecheck and lint pass; all 34 connected PostgreSQL 18
cases pass. The first Admin test fixture used an incompatible extended Prisma
client; it now uses a real PostgreSQL table lock with the original client, and
the configured 8 GiB Admin typecheck and all eight native catalog cases pass on
PostgreSQL 18, including the 6.5-second lock case. The owned idle bridge
was stopped for the code update, freeing memory. Its clone and sealed artifact
remain intact. No subscription catalog inference or destination GA request has
run yet; the next manual resume has not been executed.

The next explicit resume committed import preparation, then the copy request
hit its unchanged 30-second client deadline: copy-bind also re-derives the full
catalog before reserving storage. The old handler settled with the row exactly
`prepared`, no copy/lease/staging fields, no destination object, no active query,
zero model/GA calls and a closed attempt. The read-only full-flow proof has
SHA-256 `b759ff9168fa9090cec070e5326a2611d91fc6cf40c9f65143d5f84c399f8624`.

Both prepare and copy-bind now have bounded 120-second HTTP deadlines; origin
probe, status and other requests retain 30 seconds. The manual runner can resume
an exact prepared digest through a fresh origin check, new active attempt,
passed capacity, one idempotent preparation replay and one copy-bind. It still
refuses copying/abandoned states and makes no automatic retry. The native
regression reproduces the prior prepared-state refusal and then preserves the
same preparation/destination through recovery, with zero model/GA activity at
the stopped state. All 34 connected native cases, 3,519 Mastra cases (45 existing
gated skips), both affected typechecks and scoped lint pass. A fresh manual
resume is prepared but has not run. Published `859b6cebc` has 57 successful CI
checks and five skips; this new correction requires its own CI result.

Public A/B remains off. Required work still includes the representative subscription
pilot, complete catalog and current capacity evidence, live baseline/calibration,
and agreed numeric policy. The accepted local preview does not authorize merge,
deployment or public start.

## Integration history

The following records describe earlier checkpoints; current state is above.

October 8 current direction: the owner selected the catalog-first architecture
with reusable complete-content profiles and batched Astra connection decisions,
using the existing Codex subscription instead of paid API generation. The
[implementation plan](2026-10-08-precomputed-recommendation-subscription-build.md)
preserves the accepted product requirements. A synthetic `gpt-6-astra` CLI probe
completed through enforced ChatGPT auth with valid structured output, no tool
events and 16,949 input/32 output tokens. This proves access only. The local
operator adapter and hosted launch guard are integrated at `a23879bd9`.
The supported account reader and read-only preflight are integrated at
`334420825`. Root's reader/adapter/registration checks pass 50 cases with CI
enabled; the earlier hosted-workflow checks pass another three cases. The
reader's worker suite passed 3,395 cases with 45 environment-gated skips before
the final meter refinement, then all 19 reader cases and type/lint checks passed
on the final code. The full build has not started, and no paid API fallback is
authorized.

Complete-content planning is integrated at `1caad5e80`: root planner/retrieval
checks pass 15 cases, and worker Mastra checks pass 3,409 with 45 gated skips.
The offline audit reconstructs all 2,686 selected chunks across the 1,031-video
catalog and preserves the existing corpus and candidate digests. With a 48 KiB
part-data ceiling it plans 879 transcript map parts; these counts exclude
instructions, reduction, judgments, outputs and retries and are not a quota
estimate. No model call was made for the audit.

Admin attempt provenance is integrated at `749d9875b`, including the
closed-attempt fence repair. Migration 0142 adds nullable legacy-compatible
generation/call attribution and bounded manual execution-attempt records. Root
passed all 30 focused native PostgreSQL 18 tests and all 33 build-through-Admin
regressions; neither suite skipped a case. Late observed-usage receipts remain
recordable after closure, while recommendations/checkpoints and direct writes
require the active matching attempt. Unknown-consumption reservations remain
pending and block redispatch. No reconciliation endpoint claims that a caller's
digest proves non-dispatch. The migration was tested only in owned disposable
databases; the running GA capture schema remains unchanged.

Complete-content profile execution and persistence are integrated at `b662143ea`
(Mastra `9b912dc68`/`9ef94dcba`, Admin migration 0143). Root passes 26
planner/executor checks, all 34 connected build-through-Admin tests, and all 163
Admin precomputed tests on PostgreSQL 18, with no environment skips. The new
connected test uses the real Admin ledger: a complete selected non-English
transcript yields a verified profile, replay and metadata-only input make no
extra model call, and the report records one physical 120/30-token fixture
receipt with unknown USD cost. These are controlled outputs, not real Astra
inference. Worker Mastra checks pass 3,423 with 45 existing smoke skips; Admin
passes 41 adjacent native PostgreSQL 18 cases and type/lint/schema checks.
The producer selects verbatim text while code resolves offsets and hashes.
Late or capacity-expired receipts retain usage but cannot become applied nodes
through reduction, finalization or a later execution attempt. JSONB storage
ceilings account for its extra whitespace while compact wire limits remain
strict. Both existing Sol chats now own the separate shared edge-batch slice;
the full build and public experiment remain unstarted.

The owner further required manual-only builds/rebuilds/resumptions using the
initiating person's own subscription. The operator adapter requires fresh
same-account identity/allowance admission and pauses after failure. It isolates
and terminates the owned CLI process group on timeout or unexpected tools;
this local adapter supports POSIX hosts and explicitly rejects Windows. Hosted
source/catalog launch routes return `403 local_manual_operator_required`, and
neither workflow is registered on the native hosted API. The concrete identity
reader uses fresh local app-server processes and read-only account/quota RPCs;
it validates the named Codex allowance and an opaque backend account binding.
The manual build command, complete catalog attempt propagation, and distinct
shared-batch receipts remain implementation seams. Profile execution now carries
the active attempt and stores separate physical receipts. An Admin
login does not select a remote machine's Codex account.
Included subscription use has no
separate model API charge; the report must distinguish consumed allowance,
subscription fees and possible paid credits instead of labeling tokens free.

Manual-run requirements are committed at `21dac9230`. A read-only local Codex
app-server probe returned a stable ChatGPT account and backend account ID with
fresh quota windows; only a hashed account reference was retained. Those reads
do not expose a provider-enforced included-only spending cap. Pro's absent
five-hour window is explicitly not applicable under the current documented plan
rules, not inferred to be 100% remaining. The concrete reader's real preflight
passed on the same Pro account without model calls. The manual generation
runner and shared-call accounting still require implementation and verification.

The October 8 usage snapshot shows 66% of the account-wide weekly allowance
remaining. With a 25% reserve, this leaves 41 percentage points of admission
headroom, shared with coding chats. This is not a full-catalog forecast or a
hard cap on an active call. No representative batched catalog pilot has run;
the full-build subscription percentage remains unmeasured. Measure complete
transcript profiles and batched connection judgments, account for rounded
meters and concurrent coding usage, then extrapolate by catalog strata.
API token prices cannot be converted into included-subscription percentages.

The subsequent docs CI run at `b25bd89fa` failed the native GA concurrency
fixture's fixed 10ms overlap assumption (observed peak one, expected two).
The fixture now waits for a second source request after qualification, retaining
the exact concurrency and durable-receipt assertions. All 33 native PostgreSQL
build-through-Admin cases pass locally with this repair. Earlier green CI below
applies only to its named application commit; the latest head is not yet claimed
CI-green. A subsequent run at `5c90e8abf` exposed a non-conventional hosted-guard
commit subject. A message-only reword, published as `15fc322ef`, preserves the
exact pre-rewrite tree and passes normal hooks and local commit lint.
CI at `69144ebd0` exposed a legacy model-call replay comparison that accidentally
included the new nullable attempt ID. Repair `c2a4d41e1` excludes that field from
the legacy comparison. Root reproduced the failure, then passed all 15 contract
tests and all 152 pre-profile Admin precomputed tests on PostgreSQL 18; normal
hooks and full formatting passed. This does not weaken subscription attempt
fences. Newer profile integration has its own verification above.

Published integration `0f6d65170d2b39a1b6f39484392e6f946e492448` has 101
successful and three skipped CheckRuns, with two successful Railway status
contexts and no production deployment. After reviewed executable pins, lock
admission and recovery proofs, GA-only capture attempt 6 started on October 8
at 11:09 NZDT. It remains separate from model generation. At 15:20 NZDT it had
all 305 start pages durably matched and 152 of 327 referrer pages matched;
the journal was unsealed and a subsequent read unresolved. The earlier attempt
records below are historical, not the current running-state description.

Current checkpoint: the v3 GA capture repair is integrated from Mastra
`f10ae9611`/`0ace73779` and Admin `3abf2900c`/`ca1faf404`.
The native capture, interruption, sealed resume, Admin report and stale-runtime
cleanup case passes with a GA/token trap proving no post-seal GA calls.
Worker checks include 3,326 Mastra tests, Admin native lifecycle/retention tests,
types, lint and normal hooks. The combined integration suite passes all 33 cases.
The earlier application commit `99d7e8a62` passed all 42 applicable CheckRuns;
the subsequent docs commit `afa911729` exposed a flaky concurrency assertion
that compared receipt completion order with reservation order. Root corrected
that assertion to compare every call/source pair without requiring order.
Integrated repair `c7e2768e3` passed published CI, including the final CI gate.
The transport repair is integrated as `b430f8c41`: only proven transient
physical failures with settled terminal receipts may use the existing
three-attempt/600-second retry budget. Root's 54 focused cases and native
PostgreSQL capture/resume regression pass; that published commit passed 42
CheckRuns, with seven skipped and both Railway statuses successful. The
external adapter's physical-fetch binding, 25 offline cases, shared module
provenance check and 32 executable hashes were verified before continuation.

The real v3 first pass is complete: **152,304 start rows and 163,352 referrer
rows**, across 305 and 327 pages. All 632 compressed/raw page hashes match,
with 16,481,890 compressed bytes and 93,929,140 raw bytes. The second pass is
still incomplete. Attempt 4 stopped after three HTTP 502 responses on start
page offset 5,000. Attempt 5 recovered that page, then stopped on three HTTP
502 responses at offset 94,000 after 188 of 632 successful verification reads.
The existing verifier restarts at zero after interruption, so these partial
reads cannot be treated as completed or checkpointed verification.

All **1,028 GA requests** reconcile between native and protected records:
943 succeeded, 85 failed, none pending. No model calls, source claims, sealed
artifacts or qualification digest exist for this generation. Both attempts'
final checkpoints, records and complete first-pass pages have protected
backups. All paid launch flags are disabled; no further retry is running.
The verification-resume repair is integrated from worker commits `93a9c6dca`
and `13b21524f`. Only fully matched and fsynced second-pass pages may be reused
after a recorded `analytics_unavailable` outage. Legacy journals start
verification at zero; observed drift, an unresolved crash or an unknown error
forces a full second-pass replay. Durable reading/qualification/postflight
markers prevent a failed invalidation write from silently accepting prior
progress. The same complete-pass, fresh qualification, total and receipt gates
still precede sealing; the prior 188 uncheckpointed reads are not adopted.
Queries, usable history, 500-row pages and Admin's artifact contract are unchanged.

Root passed 49 focused tests and the native PostgreSQL capture/sealed-resume
case. The worker's full Mastra suite passed 3,348 tests (45 skipped) after fixing
an unrelated test's unmocked public route probe; a later unknown-interruption
regression passed with the two affected files (28 cases). Types, scoped lint,
format and sequential Standards/Spec review passed. The conservative unresolved-
crash replay remains an explicit liveness tradeoff, not a full crash-prefix
resume claim. Continued capture requires green CI, reviewed executable pins
including `ga-watch-capture.ts`, a dedicated single-writer process lock and fresh
quota/capacity admission. Model and full-catalog phases remain disabled.
The local preview is accepted and stopped. The bounded Nicodemus
full-universe reference remains incomplete at 360 of 1,001 discovery targets.
Its latest recovery completed eight GA requests, then stopped before any source
claim or new model call because the provider-declared usable history start had
advanced from August 7 to August 8, 2022. Offline request-digest reconstruction
confirmed the changed interval; replaying the old qualification would be unsafe.
All 232 model calls, 146 GA attempts and 197 provisional choices are preserved,
with $21.3688725 known model cost, matching receipts and no pending calls or
unknown completed-model charges. Existing artifacts do not contain a complete
replayable old-range history snapshot, and changed qualification changes model
inputs; previous choices cannot simply be carried into a new generation.
New historical generations can capture
and seal complete Watch aggregates before model work; v2 generations are not
rewritten. The owned local database has migrations 0139–0141 after a successful
disposable-clone rehearsal and protected backup; old evidence digests match.
All five incomplete capture attempts have protected recovery evidence. Root
verified all 632 first-pass page hashes and every settled request before
preserving the latest final checkpoint. Cleanup recovered another 1,028,755,456 bytes from an
integrated telemetry worktree and retired worker dependencies; source branches,
shared runtime dependencies and the historical browser timing artifact remain.
No provider calls are running. The full 1,031-video
catalog build remains unstarted. Live baseline/calibration and owner numeric
policy are still required.

October 7 continuation: the owner requested completion of the live measurement
verifier, deployment configuration, actual catalog report and capacity checks.
The test must stop after one calendar month and return to the incumbent for
manual reevaluation. A working local demonstration is required before any
production merge. Numeric winner/health thresholds remain pending; fixture
settings are not live authority. Workers A/B continued from `5c9f38c6f`. Deployed-identity GA auth is
`9d2ff9944`; the one-month cutoff and browser-proof verifier are integrated as
`2069e87f6`. Their remaining live verifier/baseline work is still in progress.
The real GA/Astra two-video durable pilot is complete: two saved connections,
eight calls and $0.2494275 known model charges. The full 1,031-video generation
passed the GA timeout after `de5a20bf2`, then two candidate judgments failed
strict local evidence validation. That attempt is now cancelled, preserving
$2.3197855 known model charges and one unresolved call with unknown charge.
A bounded candidate repair is integrated as `aeb55b991` and `e4ecc23ad`:
strict evidence checks remain, each invalid response retains its charge, and
the two-attempt limit plus safe feedback survive checkpoint resume. The next
full build awaits the bounded real-model retrieval comparison: the exhaustive
implementation requires at least 53,612 plan/discovery calls before individual
judgments, versus 4,126 with the reviewed selected-content retrieval policy. The spec
permits catalog-wide retrieval without requiring exhaustive all-pairs reasoning.
The first retrieval benchmark source exposed an overly broad core-prefix
duplicate check at its final save. Fix `e7a30b4ae` preserves the allowed
chapter/parent-film links while retaining real duplicate rejection; all 28
related native cases pass on the combined root checkout. Root integration
`f7867f744` passed normal hooks. Its 38 paid responses and $2.51959 known charges
were reused to finalize all 31 recommendations, with no additional model or GA
calls for the replay. The metadata-only Magdalena source then reached its
final save with 55 provisional choices, but correctly failed the retained
same-title duplicate policy. Its 65 responses and $4.7986875 known charges are
preserved; the benchmark total is 103 responses and $7.3182775 known charges.
A's producer-side identity filtering is `2b1c689d1`, advancing retrieval to
`selected-catalog-lexical-v2`. Root verification passed 11 Mastra cases, 22 native
Admin catalog/identity cases and 25 connected source/catalog cases. The full
1,031-pool audit has no identity conflicts or unconflicted protected-lane
omissions. Nicodemus and Amharic pools are unchanged; Magdalena replaces one
same-title film. The fresh metadata/Amharic generation paused after one charged analytics plan
failed strict page-membership validation ($0.221305 known cost). Worker A committed the bounded, durable two-attempt plan repair as
`3729a7817`, advancing the historical prompt and generation input digest to v5.
Combined verification passed 13 native durable cases, 10 Mastra cases and all
27 connected build-to-Admin cases. The new v5 benchmark ran for 16 minutes 38 seconds, then stopped after a
transcript citation failed exact matching twice. It preserves 43 provisional
choices, 54 terminal model receipts ($3.7590575 known cost, no unknown model
charges) and 37 successful GA receipts. No source finalized; the Amharic source
is still unstarted. Worker A delivered exact model-visible passage selection as `d37bcae2d`.
Root verification passed 14 Mastra cases and all 28 connected native cases,
including later-page Amharic evidence. Historical prompt v6 and content prompt
v5 both enter their generation input digests; Admin evidence/validation is
unchanged. The paid v6 benchmark at committed root `64aaf0848` completed both sources: Magdalena saved 55 connections and the Amharic source saved 18. The run took 20 minutes 7 seconds, made 85 successful model calls and recorded $7.1801625 known model cost with no pending or unknown model charge. Its 45 GA attempts include 43 successes and two recovered failures; GA bytes and monetary cost remain unknown. This is a completed two-source cohort within an incomplete 1,031-source generation, not the full build. Worker A delivered bounded source concurrency as `68c47c0c`; root integration passed 19 Mastra and 32 native connected cases. Worker B prepared the separate one-source full-universe discovery reference, and root launched it after exact-code review on October 7. It is an in-progress diagnostic, not a completed quality comparison. The older Nicodemus result stays labeled as prior-policy evidence. Both
superseded benchmark generations are now cancelled through the supported Admin
protocol, releasing capacity reservations while preserving every checkpoint,
choice and model/GA receipt; before/after digests match. The base catalog and
latest supplemental benchmark backup have both passed an actual restore check. The completed v6 cohort was also restore-verified and its generation cancelled through the supported protocol to release its diagnostic capacity reservation; hashes confirm both finalized sources and all usage/checkpoint evidence were preserved. The remaining benchmark and bounded reference
comparison still precede the full build.
The local Admin preview served the saved pilot after correcting PrismaPg's
selected-schema handling. Local Chromium verified the Admin review, Watch card,
successful selection and navigation to the target. Temporary gateways on the
existing Tailscale connection let the owner inspect this isolated pilot from
their host machine. On October 7 the owner confirmed that the preview looks
fine. The preview servers, gateways and temporary Redis are now stopped at the
owner's request to recover memory; their links are offline. Approximately
2.4 GiB of disposable caches, generated preview files and the clean merged Expo
repair worktree were removed, with
source, selected catalog inputs and paid-build evidence preserved. No production
experiment is active; preview acceptance does not authorize its activation.

- Orchestrator: `01a109d7-dc1c-7600-a2c4-07dee79b4aff`.
- Initial base: `d661b99939e24ba41834adce53c6bad9262bcee9`.
- Branch: `codex/precomputed-video-recommendations`.
- Checkout: `/home/nisal/.codex/worktrees/precomputed-video-recommendations/forge`.
- Latest broadly verified integration: `5c9f38c6f`, with real source-build through
  manual controls and rollback under controlled local measurement. GA auth
  `9d2ff9944` passed the full Mastra suite and real read-only GA coverage.
  Follow-on baseline/browser-proof work and real-catalog compatibility fixes
  still require combined validation.
- Previous verified application integration: `6b9c9836a44c90983489534355857858ddab0708` (#2574 Mastra `af835cdd0`, Admin `f18768c39`, current-main merge `ae9bc5363`, root verification `6b9c9836a`). Current-main baseline is `1daa80373`; storage CI passed: [run 37419891818](https://github.com/JesusFilm/forge/actions/runs/37419891818), 37 successful jobs, three skipped, no failures.
  #2568 GA ingestion is `084fe3eae`, Admin validation is `58b2aaa18`,
  and the OpenRouter adapter is `b7926faf5`.
- Catalog integration `285bb46eb` passed [forge-ci run 37411231982](https://github.com/JesusFilm/forge/actions/runs/37411231982): 37 successful jobs, three skipped and no failures.
- The PR records the current published integration SHA and [CI checks](https://github.com/JesusFilm/forge/pull/2578/checks).
  The published navigation integration `ffd1feb21` passed [forge-ci run 37403077030](https://github.com/JesusFilm/forge/actions/runs/37403077030), with 37 successful jobs, three skipped jobs and no failures.
- The original dirty `/home/nisal/forge` checkout is preserved.
- Development chats use exactly `gpt-6-sol`; the application model remains
  `gpt-6-astra`. Matt Pocock implement/TDD/code-review workflow only; no
  Compound Engineering skills or agents. Normal hooks remain required.

## Execution ledger

All issues remain open until merge. Dependencies advance on verified acceptance,
not issue closure. Implemented, integrated, merged, and live are distinct.

| Issue | Immediate blockers | State                                         | Integrated work                                                                                         |
| ----- | ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| #2566 | None               | Integrated-and-verified                       | `9a984c544`; saved Admin comparison                                                                     |
| #2567 | #2566              | Integrated-and-verified                       | `c89db0e4e`, `0636bf861`; exact Astra durable two-video pilot complete                                  |
| #2568 | #2567              | Integrated-and-verified                       | `084fe3eae`, `58b2aaa18`; real GA pair and Astra judgment passed                                        |
| #2569 | #2568              | Code verified; full real build incomplete     | `1298713cc`, `04200cd9f`; 20 connected native cases and 37 Admin cases passed                           |
| #2570 | #2566              | Integrated-and-verified                       | `0a93244a3`; private Watch serving                                                                      |
| #2571 | #2570              | Integrated-and-verified                       | `267a65281`, `b69592b6c`, corrections in `a7f36d778`                                                    |
| #2572 | #2571              | Integrated-and-verified                       | Core `a7f36d778`, UI `af8eba415`                                                                        |
| #2573 | #2572              | Private reporting verified; live incomplete   | Sources `acbb33fe4`, `302dffe31`; migration `0134`                                                      |
| #2574 | #2569, #2573       | Code integrated-and-verified; live incomplete | `af835cdd0`, `f18768c39`; native retention and measured fixture load passed                             |
| #2575 | #2574              | Code integrated-and-verified; live incomplete | `082fc550f`, `84ef7ce38`, `127b61e1f`, `8401049c1`; isolated native rehearsal and browser checks passed |

## Ownership and continuation

Both workers started #2575 from locally verified integration
`6b9c9836a44c90983489534355857858ddab0708`, also their fixed review base.

Worker A, `01a109e1-47c8-7043-bfd4-a85592cfafc5`, titled
`#2575 Wire Watch experiment controls`, owns Web consumption, stable browser
assignment, trusted admission propagation and click flow, plus the thin Admin
public-delivery GraphQL adapter and generated SDL/client operation.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2566/forge`;
branch: `codex/feat-590-2575`.

Worker B, `01a10a28-aa8e-7080-b3d1-c59293f8f4dd`, titled
`#2575 Add Admin launch and rollback controls`, owns Admin authorization,
manual controls, readiness/audit, migrations, public delivery services,
report qualification and operator run procedure.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2570/forge`;
branch: `codex/feat-590-2575-live-admin`.

Current recovery ownership: A delivered the Mastra capture/reader and v3 runtime
cleanup on `codex/feat-590-2569-ga-capture`; B delivered Admin transport,
provenance, retention and report compatibility on `codex/feat-590-2574-ga-capture`.
The agreed contract SHA-256 is
`ed2ea641ad2204bd7c0c96c86eebcd4e5a8908e4d8c4fac2c1191d76cad2be6a`.
Their current operator/migration readiness audits are read-only. Existing reference/full runners
remain disabled, with no active paid process. Root owns integration, evidence
preservation and the decision to proceed to the full build. Persistent checkpoint
and call-receipt files are under the protected evidence directory, not `/tmp`.
After a crash or restore, reconcile those receipts with the database before any
resumption; a compact receipt cannot reconstruct an uncheckpointed model output.

Current continuation ownership: A completed strict candidate-evidence repair and
the retrieval audit, and delivered deterministic catalog-wide retrieval in
`31dfe6fe6` and `b717ec718`. A bounded real-model reference comparison precedes
the next full build. B's conditional
live prepare/start readiness and fresh append-only launch-capacity evidence are
integrated; B delivered experiment-scoped Web attribution telemetry and its Admin
report reconciliation as `cc4e97fd4`, now integrated and locally verified. B owns the
final calibration receipt and evaluator in `7294be5d8` and `0631d5965`, now
integrated and locally verified through migration `0140`. Root checks passed
135 precomputed cases, 25 connected cases, all 144 official migrations, and
generated schema/client drift. The verifier binds independently signed
observations to the frozen cohort and charges both missing attribution and
observed failed responses against the agreed loss limit. The trusted independent
calibration source/key/method and owner loss threshold remain external inputs;
unknown browser/network loss stays explicit.
The orchestrator owns local preview/schema selection and actual build resumption.
The CI repair is committed locally as `ba0376723`. Retrieval integration
`16cce70f4` includes the reviewed worker commits and main `89f0f99a6`, which contains the separately
merged Expo maintenance PR. GitHub initially rejected publication of the CI
repair because the OAuth login lacked workflow scope. After the first device
code expired, the owner completed fresh device authorization; `gh auth status`
now confirms workflow scope. Published checkpoint `3ea71d9a8` passed all 43
GitHub check runs, with five skipped. The subsequent published identity correction `9bb0ab83b` has 42 successful
GitHub CheckRuns and five skipped; both separate Railway StatusContexts are
also successful in the automatic `forge-pr-2578` preview environment.
The subsequent plan-repair integration `9512a6416` also passed all 42 GitHub
CheckRuns (five skipped) and both Railway preview StatusContexts. The exact span integration `64aaf0848` passed 42 CheckRuns with five skipped and no failures. The two published Railway contexts both reported success with no deployment needed; no Mastra preview deployment result was present. The feature
PR remains a draft. No production deployment was issued.
The completion notes below record earlier slices.

Both workers have completed their owned implementation and normal-hook commits.
A source `3112244b7` is integrated as `127b61e1f`; B sources `ac78b3c85` and
`a41a6807a` are integrated as `082fc550f` and `84ef7ce38`. They remain available
for specific review or CI fixes. B’s follow-up `452fd51dc` is integrated as
`8401049c1`, restoring closed private report evaluation and correcting the
bounded-retention fixture. No additional implementation chat was created.
Previous branches and integrated work remain saved.
The orchestrator owns cross-app integration tests, live operator verification,
shared docs/roadmap, integration and the single PR. The October 7 instruction
authorizes necessary deployment preparation; production merge/deployment remains
behind the requested local demonstration. No public activation, promotion or
recurring schedule has occurred. At most two implementation
chats may run. Serialize heavy validation with
`/tmp/forge-feat590-heavy-validation.lock`.

A read-only current catalog count at 2026-10-06T02:11:35Z found 1,031 eligible
Videos, 859 with transcripts and 858 with English transcripts. Across all
languages it found 164,639 transcript records declaring 280,046 chunks; one Video
declares 80,248 chunks. This measures the current workload, not a frozen build
snapshot, completed generation or capacity proof. Artifact:
`/tmp/forge-feat-590-orchestration/catalog-build-dimensions.json`.

## Verified acceptance and qualifications

Private visits use signed browser identity independently of profile learning
controls. Multiple accepted clicks/retries contribute one clicked visit; empty,
failed, and fallback visits remain in the assigned denominator. Individual card
traces require trace-review permission. Raw data retains the ordinary 29-day life.

#2573 transfers expired visits atomically into per-browser counts and arm totals,
retains compact replay markers, and preserves private request provenance after
links expire. Shared transaction fences and the fixed cutoff protect accepted
receipts, snapshots, and delivery summaries. The method uses visit-weighted CTR
with a conservative browser-cluster Student-t approximation. Reports are immutable,
bounded to 32 provisional revisions plus one final result, and cannot activate
or promote anything. Private unverified measurements always remain inconclusive.

Combined checks through migration `0134` passed: 89 precomputed/playback/profile/
Admin-action cases, the exact 20-case profile-scale CI pair, 15 ordinary-delivery
native cases (one intentional skip), 130 default-off Admin regressions, 109 Web
cases, and six retention cases on a fresh migrated database. The first profile
pair run exposed duplicate fixture DDL; the source-chain correction passed all
20 on repeat. Three typechecks and regenerated SDL/client drift checks passed.
The worker full Admin suite passed 8,986 tests (774 skipped, one todo); earlier
verified full Web and Mastra runs are preserved in the detailed record.
Final whole-spec Standards and Spec review against the initial base found zero
confirmed defects in the delivered slices. The known fixture caveat is closed.

Root inspected the #2573 desktop/mobile screenshots and loading data. Eight
alternating warm HTTP samples per mode measured median total response time
178.95ms baseline / 207.8ms with the report, and 61,022 / 78,004 HTML bytes.
Both modes used 19 identical static assets. Tables scrolled within their mobile
containers; no browser console errors were recorded. This is synthetic development
HTTP/layout evidence, not FCP, production auth/database performance, or capacity.

The report API is
`GET /api/recommendations/precomputed/ctr-report?experimentId=...&revision=...`,
using an existing Admin OAuth session cookie and `read:recommendation-aggregates`.
Omit `revision` for the latest saved result. No new AI plugin or bearer credential
was introduced. Evaluation and fixture-policy declaration require operator permission.

The GitHub credential cannot change workflow files. Retention regressions run
through the existing CI entry point; no workflow edit remains. Published history
was preserved when the earlier unpublished workflow revision was rejected.

The #2568 qualification continuation passed independent Standards/Spec review,
with its single source-identifier length/wrapping finding fixed. Combined checks
passed 70 Admin/native, 15 source-build-through-review, 59 default-off and nine
Mastra cases. Both affected package typechecks passed. Full worker suites passed
8,987 Admin and 3,223 Mastra cases before the final bounded cap/wrap fix; focused
checks covered that fix. No migration or GraphQL change was introduced.
Ten alternating synthetic Next samples measured median total response times
130.6ms without qualification and 136.9ms with it, adding 2,189 HTML bytes with
the same 19 static assets. This remains local development evidence.

The GA reader continuation is integrated from `b0892f4e4`: full Mastra tests
passed 3,238 cases (37 configured skips), and final independent review found no
unresolved defects. Real Node impersonation/coverage and aggregate-page reads
succeeded while explicitly retaining source truncation and unknown mappings.
After merging current main `8ebd6500c`, both application typechecks, 15 native
generation-to-Admin cases, 23 Mastra cases, 68 retention unit/workflow cases and
seven fresh PostgreSQL retention cases passed. The additive test conflict kept
both implementations' cases. The completed fixture ticket now uses feat-612;
main's new feat-609 HNSW work is preserved. No history-backed model build or
public experiment activation is implied by these checks.

## External inputs and boundaries

The user signed into GA4 property `320198532` and the Cloud console. Browser
inspection confirmed its existing daily BigQuery link to `cru-ga4-prod-1` and
successful metadata/aggregate reads in `jfp-data-warehouse`. The candidate
`cru-ga4-prod-1.analytics_320198532` remains denied-or-nonexistent, not a verified
source path. Two readable exact-property copies cover only March–July 2023 and
have no viewer/session keys for video starts. They cannot establish transitions.
A combined-event candidate has nonplaceholder keys for mostly 2021–2022 Watch
starts; its lineage, sequence semantics and canonical mapping remain unverified.
See the [GA discovery record](2026-10-06-precomputed-video-recommendation-ga-discovery.md).

The user explicitly restricted historical evidence to verified JesusFilm.org
hosts and exact `/watch` or `/watch/` descendants. Query strings/fragments do not
change scope; unrelated hosts, `/watching`, and other pages are excluded. The
current event source or a verified aggregate transition source and canonical
Video mapping remain unresolved. Remote ADC is now saved with owner-only
permissions and BigQuery API metadata reads succeed. Current GA reports also
contain Watch data: the exact host/path-filtered September 8–October 5 report
shows 283,064 page views and 1,014 `videostarts`. Older warehouse-copy dates do
not describe the live GA reporting range. The direct GA Data API probe failed
with insufficient OAuth scopes because the sign-in command omitted
`analytics.readonly`. Adding it to the default ADC client was subsequently
blocked by Google. The installed SDK lists that scope as being blocked for its
default client; a supported project-owned OAuth client or appropriately
configured service identity was required. The existing Cloud credentials remain
present. No policy bypass was attempted.
Tatai subsequently supplied project `jesusfilm-org-1738781064783` and service
account `watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com`.
Remote impersonation with `analytics.readonly` now succeeds using the existing
Cloud ADC login, and GA Data/Admin API reads return HTTP 200. No downloaded key,
new user login, or agent-created IAM change was needed. The standard API request
works without a quota-project override; explicitly overriding the quota project
returned `USER_PROJECT_DENIED`, so no additional role was requested for that
unnecessary override. API authentication is resolved.

The Watch-filtered report from property creation (June 21, 2022) through October
3, 2026 returned all 200 monthly/event aggregate rows, including 4,006,892
`videostarts` across September 2022–October 2026. This is report coverage, not
verified complete raw-event history. Recent video-ID coverage is incomplete:
720 of 1,017 starts in a separate September 8–October 5 observation have an empty
or unset `mediacomponentid`. Page paths provide a mapping lead. The dedicated
TypeScript reader performs scoped reads with bounded pagination, property-local
cutoff guards and explicit source truncation. Actual live coverage and aggregate
page reads passed; they do not yet constitute a qualified model build.

On 2026-10-06 the user approved validated Watch referrer links plus engagement
for the first build, labeled as navigation evidence. This replaces the original
requirement to prove consecutive playback for this GA input. A bounded probe
confirmed 450,061 destination starts with a Watch referrer, including homepage
and self-referrals, and retrieved 100 of 163,347 pair rows. One pair associated
1,648 starts of the Spanish Birth of Jesus page with the Spanish The Beginning
referrer. These are aggregate associations, not unique navigations or individual
journeys. Current endpoint mapping passed a bounded live pair read, and the connected
reader-to-model-to-Admin path passed native tests with controlled inputs. The
full production catalog build remains pending. Provider-declared historical gaps stay unknown even when
all pages of the separately declared usable interval have been processed.

#2568 navigation ingestion and #2569 resumable builds are integrated and verified. No unavailable transition,
exposure, bot-filter, or exclusion count becomes zero. No new export/link or
warehouse write is authorized.

#2573 live winner certification remains incomplete: the measured human baseline,
agreed numeric stopping settings, trusted bot qualification, and tracking-loss
evidence are absent. Production cookie forwarding, actual catalog cost, and
measured capacity/headroom also remain prerequisites where required. Fixtures
cannot satisfy these criteria. #2574 code and local loaded cleanup are verified; actual production capacity approval remains incomplete. #2575 code is integrated and locally verified through `8401049c1`. Live start remains unavailable until a trusted qualification verifier and its real inputs exist.

Public experimental serving stays default-off and the incumbent remains available.
Do not merge, deploy, start public A/B traffic, promote a winner, or enable refresh
scheduling without the separate required authority. Preserve useful worktrees and
the owned PostgreSQL 18 integration database on loopback port `32810`.

## OpenRouter continuation

The user requested OpenRouter instead of provisioning a direct OpenAI key.
The existing Railway Mastra service has a configured OpenRouter credential, and
the live provider catalog includes the exact `openai/gpt-6-astra` model with
structured-output support. The orchestrator owns the narrow provider adapter
and transport tests; the Sol chats retain their GA/Admin ownership.

The actual adapter passed a live structured-output smoke on 2026-10-06:
41 input tokens, 12 output tokens, and $0.00101 reported cost. The response
identified `openai/gpt-6-astra`. No credential was printed or saved. Evidence:
`/tmp/forge-feat-590-orchestration/openrouter-astra-live-smoke.json`.
This verifies model access and transport, not recommendation quality, catalog
cost, or a completed GA-backed generation. The adapter retains validated
structured output, the same application model stamp, and explicit token usage;
it disables provider fallback and SDK retries. Development chats remain Sol.

## Verified live navigation sample

The read-only GA smoke processed all 4,329 snapshot rows over 44 pages for
The Beginning → Birth of Jesus. Current catalog mapping qualified 3,948
navigation-associated destination starts and left 27 unmapped; destination
engagement was 123,894 starts, with engaged views and exposures unavailable.
The usable interval was August 6, 2022–October 3, 2026, preserving the unavailable
requested prefix. This used a local fixture of real read-only current catalog
rows, not a production Admin build or verified historical URL ownership.

Astra then judged the real pair through OpenRouter using its published metadata
and these GA aggregates. The explanation preserved all evidence limits. This
one-pair call used 865 input/198 output tokens and cost $0.01855. Native controlled
build-through-Admin review and the bounded live checks are distinct evidence;
none is a full catalog cost/coverage report.

Saved GA usage counts are snapshot-scoped. The smoke made 53 report requests:
44 snapshot pages, seven qualification reports, and two smoke-only size previews.
#2569 must account for qualification and retry overhead in complete build reports.

## Final navigation integration verification

The combined committed Mastra/Admin implementation passed all 16 native
build-through-review cases and 23 focused Admin catalog, contract and view cases.
Both application typechecks, focused lint/format and diff checks passed.
The worker full suites passed 3,250 Mastra and 8,999 Admin cases. Separate
Standards and Spec reviews have no unresolved findings in this slice. The new
root integration case uses synthetic GA HTTP and controlled model output; live
qualification and the real Astra pair judgment remain separately labeled above.
#2568 is integrated-and-verified under the approved navigation revision, unlocking
#2569. Full catalog execution and its capacity/cost report remain future work.

## Catalog integration verification

#2569 passed 20 native build-through-Admin cases, including four new catalog
resume/refresh/charged-retry/GA-receipt cases, plus 37 focused Admin native and
view cases. Both package typechecks, root lint/format, and the fresh full
migration chain through `0135` passed. Worker suites passed 3,257 Mastra and
8,999 Admin cases. Standards and Spec reviews found no remaining confirmed
defects in this slice; capacity-race and protocol-isolation findings were fixed.

Desktop and mobile report checks found no horizontal overflow or console errors.
Ten alternating warm synthetic development requests measured median total HTTP
response time 142.34ms baseline / 147.28ms with the report, and 62,426 / 76,420
HTML bytes, with the same 19 assets. This is local rendering evidence, not
production latency or capacity. The temporary preview route was removed.

The current OpenRouter adapter also captured the exact $0.00101 provider charge
on a fresh live Astra smoke. Full catalog execution, deployed GA credentials,
measured build/retention capacity, and public experiment readiness remain pending.

## Storage integration verification

#2574 passed 21 connected build-through-Admin cases, 63 focused Admin native/view
cases, 13 Mastra runtime/workflow cases and seven dedicated ordinary-retention
cases. The official migration chain through `0136`, both package typechecks and
the root seam typecheck passed. Worker full suites passed 3,267 Mastra cases and
8,999 Admin cases; focused native checks cover the subsequent pin-race fix.
Sequential Standards then Spec review found no unresolved defect in this slice.

The isolated loaded fixture reclaimed 6,715 expired request roots and 34,395
served items in 68 successful bounded runs, preserving 6,715 archived visit
receipts. Allocated relation bytes did not shrink. This is measured local
throughput, not a production capacity budget. The actual controlled source
workflow also verified compact native runtime persistence. Full qualifications
and machine receipts are in the storage runbooks and detailed verification record.

Desktop/mobile report layout passed, including a 191-character generation ID
and independent table scrolling. Five alternating warm HTTP samples per mode
measured median 123.090ms for the empty comparison view and 196.456ms for the
storage view, 62,428 versus 82,582 HTML bytes, with the same 19 assets. The added
report has a measurable local development render cost; this is not a before/after
comparison of the same page or production latency proof. Protected route access
without authentication still redirects to login. Temporary preview files and
server were removed. Public serving remains off.

## Manual-control integration verification

The complete connected native suite passed 25 cases, including actual controlled
catalog builds, no implicit activation, explicit fixture preparation/start,
stale-target rejection, signed clicks after rollback, raw expiry with identical
retained arm counts, fixed browser assignment, frozen-cohort exclusions, and an
actual evaluator-produced fixture winner followed by exact promotion/rollback.
A separate case exercises real native incumbent retrieval and signed selection
after saved-signer failure, preserving the original challenger denominator.
Fixture counts and provider receipts are synthetic; no live winner is claimed.

The official migration chain through `0137` and seven ordinary-retention tests
passed on a fresh disposable native database. Watch's full worker suite passed
4,780 tests (10 skipped, one todo); Web and typed-client checks passed. Admin's
final full suite passed 9,019 tests (810 skipped, one todo), and all 42 focused
native cases passed. Admin and seam typechecks, regenerated schema/client drift
checks and Next route types passed. Final published-head CI is tracked on the PR.

Admin desktop/mobile checks passed with 191-character IDs, table scrolling,
report expansion, and no console errors or document overflow. Unauthenticated
prepare/rollback showed an error without changing the pointer. The real page
redirected to login (307); the API returned 401. Four alternating warm samples
per mode measured median 112ms baseline / 106.5ms controls, 52,911 / 62,381 HTML
bytes and 22 script tags in each mode. These small local development samples do
not establish production latency or authenticated query cost. Temporary preview
route/server were removed and viewport reset.

The live start/promotion verifier is deliberately incomplete pending trusted
human/bot and loss-audit inputs. The Admin page reports this as blocked and the
services reject live authority. Thus #2573–#2575 and feat-590 retain incomplete
live acceptance; PR #2578 remains a draft. No public A/B traffic was activated.
