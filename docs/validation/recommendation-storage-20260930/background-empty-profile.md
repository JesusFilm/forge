# First-empty profile completion validation

The new writer is disabled by default with
`RECOMMENDATION_PROFILE_EMPTY_COMPLETION_SKIP=false`. It changes only future
first durable projections. A claimed run can complete with
`projection_id = NULL` and `last_transition_reason = first_empty_no_evidence`
when the original and transaction-reloaded eligible source arrays are empty,
the profile/privacy authority is active, the run claim has an explicit virgin
pointer fence (`generationId = null`, `pointerGeneration = 0`), that fence is
current, and there is no retained generation for that profile/privacy scope.
The completed run keeps its original expiry. There is no retained rewrite,
erasure change, or session-projection change. Existing empty generations still
publish and replace later versions under the established fences.

The four current eligible source arrays are durable outcomes, session selections,
explicit preferences, and negative evidence. A source without an embedding is
still present in the raw-array guard. New persisted evidence channels must update
this guard and its tests before writer activation. The transactional evidence
digest recheck prevents an empty result after the source snapshot changes.

`COMPLETED` with a null projection is recognized as successful replay only with
the exact transition reason above. Other completed-null states remain fenced.
Eligibility feedback carrying an older source watermark cannot coalesce into a
completed-empty run. Feedback during a claimed initial no-pointer run also
queues a new run, so a publication that finishes empty cannot swallow the new
source. These feedback fences remain active when the writer flag is turned off,
because existing completed-empty runs and in-flight ON workers outlive a flag
rollback. Consequently, an entirely OFF fleet can queue an extra run when
feedback races a claimed virgin run; this preserves compatibility without
changing its publisher behavior. Pending runs continue through the existing recovery path. Feedback
dispatch is best effort, as before; this change does not create a new outbox.

## Local proof and limits

- CI-selected `profile-projection.service.db.test.ts`: 16/16 native cases passed
  against a task-owned loopback database. The new PrismaPg case verifies zero
  generation/pointer rows, a preserved claimed run, a simulated crash before
  completion, real job reclaim/completion with the typed reason and original
  expiry, replay, null profile nominations, parity with a published empty
  generation, and privacy-reset fencing. A separate claimed null-pointer-fence
  case proves that an older/malformed run publishes its empty generation through
  the baseline path. The other fixture cases cover eligible playback, lineage,
  reconciliation, and vector migration. The final full native run passed 16/16
  on the task-owned loopback database.
- `job.test.ts`, `profile-projection.service.test.ts`, and `env.test.ts` passed
  138/138 after the final edits. These cover the exact completed-null reason,
  replay, other completed-null fences, an older evidence watermark, claimed-run
  feedback under both writer flag settings, missing-embedding sources, and
  explicit/default-off configuration.
- The native case uses a 10-connection `PrismaPg` pool for the new path. The
  pre-existing cases in the same fixture still use the datasource Prisma engine.
- In a 100,000-profile synthetic fixture with 25,000 links and 100,000 completed
  runs in **both** arms, the candidate avoided 96,247,808 B of generation
  table/index/TOAST allocation and 41,304,064 B of pointer allocation:
  137,551,872 B (131.18 MiB) total. Its retained run relation was 1,761,280 B
  smaller because `projection_id` is null. Core profile and link allocation was
  identical. Baseline/candidate cluster-wide WAL intervals were 546,341,280 B
  and 222,280,864 B in a requested quiet window; they are not isolated per-arm
  WAL measurements. Workflow-engine rows were excluded. The fixture proves
  physical allocation only for its synthetic first-empty mix, not the production
  raw-empty share or filesystem recovery. Script and receipt are in the adjacent
  private `background-empty-load/bytes.ts` and `bytes-receipt.json` output.
- A populated `PrismaPg` publisher fixture had 100,000 profiles, 25,000 links,
  20,000 unrelated pending episodes, 99,900 unrelated generations/pointers, a
  10-connection pool, and interleaved OFF/ON/ON/OFF blocks. At concurrency two,
  all 50 jobs per arm completed without errors or observed pool waits; first-job
  p95 was 252.33 ms OFF versus 96.99 ms ON, while replay p95 was 6.60 versus
  6.83 ms. At concurrency eight, OFF exhausted serialization retries for 18/50
  jobs while ON completed 50/50; those unequal success sets preclude a clean
  latency comparison. The retained failure receipt is
  `background-empty-load/job-load-c8-receipt.json`.
- Actual loopback Next `/api/graphql` status requests started the local Postgres
  workflow runner, and every first-empty workflow reached its real terminal
  state. For each 50-profile arm, three passes of status requests ran at
  concurrency ten, with zero HTTP/GraphQL errors and zero failed/open runs after
  drain. OFF retained 50 `COMPLETED/projection_published` runs, 50 generations,
  and 50 pointers. ON retained 50 `COMPLETED/first_empty_no_evidence` runs with
  null projection IDs, zero generations, and zero pointers. The first sequential
  OFF→ON Next-dev run was unbalanced: ON first-status p95 was 2027 ms versus
  1105 ms OFF, and repeated-before-drain p95 1099 versus 789 ms. A reverse
  ON→OFF run warmed the actual status route and completed one workflow before
  each fresh 50-scope arm: first-status p95 1483 versus 1515 ms, and
  repeated-before-drain p95 778 versus 775 ms. After draining, another 50
  coalesced requests per arm had p95 713 versus 686 ms and created no extra
  runs. These small, sequential Next-dev samples are functional and load
  smoke tests, **not** a production latency estimate or activation pass. The
  scripts and private aggregate receipts are in adjacent `background-empty-http/`.

## Release and rollback gates

1. Land reader support with the flag false and verify every HTTP and worker
   instance has the compatible image before enabling the writer. Old runners
   do not recognize the typed completed-null replay result.
2. Enable the writer in a separate normal PR/config release after mixed-reader
   convergence. Verify the effective flag on each live role, not only raw env
   strings, and verify typed completed-null counts, zero unintended generations,
   health, expiry, erasure, feedback-driven first nonempty publication, and
   fallback parity with aggregate-only probes.
3. On trouble, set the flag false with a compatible reader image. Existing
   completed-empty runs remain valid until their original expiry. Do not roll
   back to an image that lacks completed-null replay support while they exist.

The local fixture does not establish the production raw-empty fraction; the
observed declared-empty generation proportion is an upper bound. Production
activation requires the normal PR-to-main process and root-owned rollout review.

## Reader convergence before writer activation

The root-owned September 30 reader receipt records actual Admin HTTP and worker
processes converged on `a549b86a4`, healthy, with the effective empty-completion
flag false and compatible rollback images captured. Aggregate-only receipts are
`outputs/heartbeats/20260930T0243-background-empty-profile/{runtime-reader-converged,effective-reader-converged,retention-reader-converged}.json`
in the task artifact directory. This establishes the reader-first prerequisite;
it does not show that the writer flag is active or that production has saved
storage. The separate default-on activation still requires CI, normal merge and
deploy, effective flag verification on both roles, and the post-activation
acceptance probes above.
