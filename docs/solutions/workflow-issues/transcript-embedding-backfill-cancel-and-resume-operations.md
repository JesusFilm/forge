---
title: "Transcript embedding backfills need cancellable resume batches"
date: "2026-06-19"
last_updated: "2026-06-29"
category: workflow-issues
module: apps/admin transcript embedding backfill
problem_type: workflow_issue
component: background_job
severity: high
applies_when:
  - "Operating long-running embedding backfills through Admin Workflow"
  - "Recovering after a GraphQL client timeout while the durable run continues"
  - "Resuming enriched transcript embeddings without rewriting already-enriched rows"
tags:
  - admin
  - useworkflow
  - transcript-embeddings
  - backfill
  - graphile
  - cancellation
  - resume
  - railway
---

# Transcript embedding backfills need cancellable resume batches

## Context

The enriched transcript embedding backfill was triggered through
`triggerTranscriptEmbeddingBackfill`, which starts a useworkflow run and then
waits on `run.returnValue`. For small smokes that is fine. For full-corpus
work, the HTTP caller can time out while the Workflow run keeps executing.

On June 19, 2026, an unfiltered production `MODEL_UPGRADE` run enumerated
208,073 transcript targets and 1,452 groups. The GraphQL caller received a
Cloudflare 524 after roughly 125 seconds, but the Workflow run continued. The
run had to be found from `workflow.workflow_runs`, cancelled by run id, and the
Admin worker had to be restarted because the current step body kept launching
work after the run was marked cancelled.

## Guidance

Treat a full transcript embedding backfill as an operator-controlled resume
process, not as one giant GraphQL call.

Use these rules when recovering or designing the next surface:

- Return or record the Workflow run id immediately. Do not rely on a
  long-lived GraphQL request to be the operator's only handle.
- Select remaining work from storage state. Rows whose transcript chunks already
  have enriched v2 fields such as `embedding_input_text`, structured metadata,
  and source provenance should be skipped by resume mode.
- Prefer bounded batches scoped by language and core id over the full
  data-derived target catalog. The production data set can contain many more
  target candidates than rows that actually need rewrite.
- Make cancellation stop future launches promptly. A Workflow `run_cancelled`
  event marks the run terminal, but it does not automatically interrupt an
  already-running JavaScript loop inside a long step body.
- If a run is already inside a giant step and still writing after cancellation,
  restart the worker to kill the in-flight process, then verify that transcript
  write logs stop.

The safe recovery sequence used in production was:

```text
1. Find the active run in workflow.workflow_runs.
2. Call Workflow's native cancel path for that run id.
3. Verify the run status is cancelled.
4. Watch worker logs for continued transcript writes.
5. If writes continue, restart @forge/admin/worker.
6. Verify fresh worker and Admin web log windows show no transcript writes.
7. Resume with scoped language/coreId batches selected from legacy rows.
```

## Why This Matters

The transcript backfill has side effects outside the Workflow event log:
Mastra launches provider work and Admin ingest writes vectors. Once a long step
has started, Workflow cancellation protects future replay, but it does not
rewind or preempt arbitrary code already running inside that step.

That distinction matters operationally. In the June 2026 recovery, the run was
successfully marked `cancelled`, but the worker still wrote additional
`transcript_index_complete` events until the worker deployment was restarted.
Only a fresh log window with zero transcript writes confirmed containment.

It also matters for cost and relevance. Existing enriched rows are upserts, so
rerunning does not duplicate transcript rows, but it can still spend provider
work rewriting healthy rows. A resume selector should preserve completed
enriched rows and process only legacy or incomplete transcript embeddings.

## June 20, 2026 All-Language Run Notes

The production all-language run `wrun_01KVFXCQ9QWP17H2F8Q4FWZ64G` was started
with no `coreIds` filter and no `languages` filter, so the Admin enumerator
used the intended all-language/default path. Its start log reported
`totalTargets=208073`, `groupCount=1452`, `languageFilter=null`, and
`concurrency=5`. The GraphQL trigger request still returned a 524 because the
resolver waits on the Workflow return value, but the Workflow row and worker
logs proved the run continued.

Do not confuse "the run is still writing" with "the all-language backfill is
healthy." During the June 20 monitor window, Admin kept writing successful
short transcript targets while long transcript targets such as `1_jf-0-0`
repeatedly failed at the launch boundary. Admin recorded those as
`transcript_index_failed` with `reason=network_error` and `durationMs` around
180 seconds. Mastra storage showed the deeper state: many corresponding
`transcript-embedding` workflow snapshots failed in `embed-transcript-chunks`
with `provider_failed`, while other snapshots remained `running` after Admin
had already moved on.

The causal shape is:

1. Admin launches Mastra through `/forge-transcript-embeddings`.
2. The Mastra route starts `transcriptEmbeddingWorkflow` and waits for the full
   workflow result before returning.
3. Long transcript targets can exceed the request boundary, so Admin receives a
   504/network failure and records the target failed.
4. The Mastra workflow may keep running after Admin has already recorded the
   failed launch, which can leave orphaned in-flight work and incomplete Admin
   transcript rows.
5. Mastra's provider client currently collapses non-OK provider responses into
   `provider_failed` without persisting the provider HTTP status/body in the
   workflow result, so operators cannot distinguish gateway rejections,
   payload-size issues, and provider policy failures from storage alone.

That means the final outcome report for this run must include both Admin row
health and Mastra workflow snapshot health. Parent Workflow status alone is too
weak: a `running` or eventually `completed` parent run can coexist with failed
per-target launches.

### Interim checkpoint: 2026-06-20 03:20 UTC

The parent Workflow row was still `running` at 2026-06-20 03:16 UTC, and Admin
storage was still receiving transcript writes through 03:17 UTC. At 03:17 UTC,
Admin showed 4,278 transcript rows touched since the run start, spanning 369
languages, 114 videos, and 162 video editions. The current enriched-healthy
count was 8,119 transcript rows, with 43,513 rows still legacy or incomplete by
the v2 health predicate.

The live app logs showed the same split-brain shape as storage. Admin worker
logs reported successful short-target completions for `1_jf6101-0-0` and
`1_jf6102-0-0` while adjacent `1_jf-0-0` launches failed with Mastra HTTP 504
responses and then `transcript_index_failed` events:

```text
2026-06-20T03:17:16Z mastra_transcript_embedding_launch_failed status=504 body={"error":"Gateway Timeout"}
2026-06-20T03:17:16Z transcript_index_failed coreId=1_jf-0-0 language=bkq reason=network_error durationMs=180005
2026-06-20T03:20:13Z transcript_index_failed coreId=1_jf-0-0 language=bla reason=network_error durationMs=180006
```

Mastra snapshots and app logs pointed at the deeper failure. Since 2026-06-20
01:20 UTC, `transcript-embedding` snapshots showed 484 successes, 247 failures,
and 39 running snapshots. All 247 failures were `1_jf-0-0` with
`provider_failed` and `retryable=false`; their median transcript text length was
about 58k characters. In the same window, `1_jf6101-0-0` had 340 successes and
`1_jf6102-0-0` had 144 successes. This proves the gateway/provider path was not
globally down; the failure concentrated on the long `1_jf-0-0` payload shape.

Mastra app logs matched the snapshot result:

```text
Error executing step workflow.transcript-embedding.step.embed-transcript-chunks:
TRANSCRIPT_EMBEDDING_WORKFLOW_FAILED:{"ok":false,"reason":"provider_failed","retryable":false}
```

The run was not terminal at this checkpoint. Do not treat these counts as the
final outcome; use them to preserve the root-cause trail for the eventual final
report.

### Interim checkpoint: 2026-06-20 04:07 UTC

The parent Workflow row was still `running` at 2026-06-20 04:07 UTC and Admin
continued to receive transcript writes. The latest observed write was
2026-06-20 04:07:24 UTC. At that point Admin showed 4,356 transcript rows
touched since the run start, spanning 410 languages, 114 videos, and 162 video
editions. The enriched-healthy count had moved to 8,197 transcript rows, while
43,440 rows remained legacy or incomplete by the v2 health predicate.

Mastra snapshots in the same recent monitor window showed 719 successes, 340
failures, and 39 running `transcript-embedding` snapshots. The failure signature
had not changed: failures were still concentrated on the long `1_jf-0-0`
payload with `provider_failed` and `retryable=false`, while shorter
`1_jf6101-0-0` and `1_jf6102-0-0` targets continued to complete successfully.

This checkpoint is progress evidence, not completion evidence. The final report
still needs the parent Workflow terminal state plus final Admin and Mastra
health counts.

### Hotfix checkpoint: 2026-06-20 split long provider batches

The long-target failure was not a global AI Gateway outage. Direct gateway
health checks worked, and short transcript targets kept succeeding. The
production failure concentrated on long `1_jf-0-0` transcript payloads where
Mastra returned `provider_failed` with `retryable=false` after the
multi-chunk embedding request reached the provider.

The targeted Mastra hotfix is in
`apps/mastra/src/mastra/workflows/transcript-embedding.ts`:

- Split fallback is narrow: only multi-chunk batches, only
  `EmbeddingProviderError`, only `code === "upstream_failed"`, and only when
  `retryable=false`.
- Fallback recursively halves the batch until the provider accepts the smaller
  requests or the error reaches a single chunk and propagates.
- Every successful child response is validated against that child batch size
  before combining, so compensating count mismatches cannot shift vectors onto
  the wrong transcript chunks.
- Combined split responses must agree exactly on dimensions, model, provider,
  request model, native dimensions, and transform version before Admin ingest.
- Split diagnostics are logged with scrubbed correlation fields:
  `mastraRunId`, target identity, language, model, provider, request model,
  error code, retryable flag, split depth/path, chunk count, and token count.
  The log must not include transcript text, embedding input text, vectors,
  API keys, request bodies, or raw provider bodies.

The regression coverage is in
`apps/mastra/src/mastra/workflows/transcript-embedding.test.ts`:

- Recursive split from 4 chunks to singleton requests preserves Admin chunk
  order and vector assignment.
- Malformed child responses fail before Admin ingest.
- Inconsistent split-child provenance fails before Admin ingest.
- Split fallback warning logs contain safe operator correlation fields and do
  not leak transcript text, embedding text, vectors, keys, or raw provider
  messages.

The formal review for this hotfix is staged at
`/tmp/compound-engineering/ce-code-review/20260620-043548-hotfix/report.md`.
Reviewers found and the hotfix addressed child count validation, strict
provenance combination, recursive-depth test coverage, and scrubbed operator
diagnostics.

One residual operational risk remains: the default top-level provider batch is
bounded by `DEFAULT_MAX_BATCH_CHUNKS = 8`, so worst-case split fallback is
small on the normal path. A caller-supplied larger `maxBatchChunks` override
can still amplify one rejected batch into up to `2N - 1` provider calls. Do not
broaden this hotfix into a chunking contract change during incident recovery;
add a reviewed follow-up if operators need a hard max override or split-attempt
budget.

### Hotfix checkpoint: 2026-06-20 invalid Gateway envelopes and singleton retry

After the split-batch hotfix was deployed, scoped retries were started through
the existing Admin GraphQL mutation, one `coreId` at a time with only that
core's failed languages. This avoided a corpus restart, but new
`1_jf-0-0` snapshots still failed after the deploy with `provider_failed` and
`retryable=false`.

The important reproduction result was negative: the exact stored workflow input
for a failed `1_jf-0-0/chk` run planned 35 chunks in five provider batches
`[8, 8, 8, 8, 3]` with about 18.9k total chunk tokens, and every batch
succeeded against the same AI Gateway when replayed in isolation. That proves
the transcript payload itself was not intrinsically unembeddable. The remaining
failure shape was load- or response-shape-sensitive: Gateway could still return
an error that Mastra collapsed to `provider_failed retryable=false`, but the
first split hotfix only recovered `upstream_failed` multi-chunk errors.

The second Mastra hotfix keeps recovery narrow:

- Treat `EmbeddingProviderError` codes `upstream_failed` and `invalid_response`
  as recoverable Gateway provider errors.
- Split only non-retryable recoverable multi-chunk errors. Retryable overload
  errors are retried in place and are not split after retry exhaustion, because
  splitting retryable 429/5xx-style failures amplifies load.
- Retry unsplittable singleton recoverable errors with bounded exponential
  backoff. This handles transient Gateway envelopes once a batch has already
  been reduced to one chunk.
- Keep the catch boundary around the provider call only. Post-provider
  validation errors, such as a child batch returning the wrong number of
  vectors, remain hard failures and cannot be hidden by further splitting.
- Log scrubbed `transcript_embedding_batch_provider_retry` diagnostics with
  run id, target, language, model, provider, request model, error code,
  retryable flag, attempt, delay, chunk count, and token count. Do not log
  transcript text, embedding input text, vectors, keys, or raw provider bodies.

The formal review for this second hotfix is staged at
`/tmp/compound-engineering/ce-code-review/20260620-053700-transcript-provider-retry/report.md`.
It caught the retryable-error fanout risk before deploy; the fix now preserves
the split fallback for non-retryable Gateway envelopes while avoiding extra
load during retryable overload incidents.

### Hotfix checkpoint: 2026-06-20 launch timeout correlation and ingest retry

After the provider split/retry hotfixes, fresh all-language backfill logs
showed a different failure shape. Admin received a Mastra HTTP 504 after about
180 seconds and recorded `transcript_index_failed reason=network_error`, but
the corresponding Mastra workflow could continue past the Admin request
boundary and ingest transcript rows later. Admin's own timeout was already set
higher than the observed 180 second cutoff, so the likely boundary was the
private HTTP/proxy path between Admin and Mastra, not the local fetch timeout.

This creates a false-negative launch result: the target looks failed in the
backfill report even though the run may still complete and write vectors.
Retried targets can then overlap with an in-flight Mastra run, which also
showed up as transient serializable/deadlock conflicts during transcript
ingest (`P2034` and `P2010` with `40001`/`40P01`-style messages).

The third hotfix keeps the synchronous endpoint but adds a correlation bridge:

- Admin generates or accepts a caller run id for each Mastra launch and sends
  the route body as `{ runId, input }`.
- Mastra's `/forge-transcript-embeddings` route accepts that envelope and uses
  the caller run id when creating the workflow run. Legacy callers can still
  send the original raw workflow input body.
- When Admin receives a retryable launch network error with a run id, the
  backfill step polls Admin transcript storage for an exact
  `video_edition_id`, `language`, and `mastra_run_id` match before marking the
  target failed.
- The confirmation query only succeeds when the transcript row has all chunks
  present with non-null embeddings, so a partial write is not counted as a
  successful backfill target.
- Admin ingest retries the serializable transaction up to three attempts for
  retryable Prisma transaction conflicts, logging only scrubbed correlation
  fields.

The important implementation boundary is that this is a bridge, not the final
architecture. It prevents successful-but-slow Mastra runs from being reported
as failed, but a first-class operator surface should eventually launch Mastra
as an asynchronous job with a durable ledger or callback instead of waiting for
the full workflow result through one HTTP request.

The regression coverage is split across the two services:

- `apps/mastra/src/mastra/workflows/transcript-embedding.test.ts` proves the
  route accepts the caller run-id envelope and passes the same run id into the
  workflow launcher.
- `apps/admin/src/services/mastra-transcript-embedding-client.test.ts` proves
  Admin preserves the caller run id on 504/network launch failures.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts` proves a
  timed-out launch is converted back to success when the exact Mastra run later
  appears as a healthy transcript ingest row.
- `apps/admin/src/services/transcript-embedding-ingest.service.test.ts` proves
  retryable transcript transaction conflicts are retried, including the edge
  case where the retryable Prisma code is on the top-level error and a nested
  cause is non-retryable.

The formal review for this hotfix is staged at
`/tmp/compound-engineering/ce-code-review/20260620-071501-launch-timeout-correlation/report.md`.

### Hotfix checkpoint: thrown launch timeouts must preserve run ids

After the Admin worker received the launch-timeout correlation hotfix, the
all-language run resumed and successfully wrote fresh `1_jf-0-0` transcript
rows. Progress later paused with no Admin ingest writes after
2026-06-20 07:45:27 UTC while two transcript Workflow runs still held locked
Graphile jobs. A scoped recovery run was still active beside the original
all-language run, so it was cancelled through Workflow's native CLI while
preserving the original all-language run:

```bash
WORKFLOW_TARGET_WORLD='@workflow/world-postgres' \
WORKFLOW_POSTGRES_URL="$DATABASE_PUBLIC_URL" \
pnpm --filter @forge/admin exec workflow cancel \
  wrun_01KVHRYGJMW6QP4TBD70HS39GT \
  --backend @workflow/world-postgres
```

The focused code gap was in Admin's Mastra launch client. The previous
correlation bridge preserved the caller run id for HTTP 5xx/429 responses and
parse errors, but the `fetch` catch branch still returned a retryable
`network_error` without `mastraRunId`. That branch is the one hit by thrown
timeouts such as `TimeoutError`, so the backfill step could not poll Admin
storage for a late successful ingest. It would classify the target as failed
even though Admin had already generated a stable run id before the request.

The fix in `apps/admin/src/services/mastra-transcript-embedding-client.ts`
returns the generated `runId` on thrown `network_error` results and includes
the same run id in the scrubbed launch-threw diagnostic log. Regression
coverage in `apps/admin/src/services/mastra-transcript-embedding-client.test.ts`
now simulates a thrown `TimeoutError` and asserts that the result preserves
`mastraRunId`.

When this hotfix is deployed, restart or redeploy `@forge/admin/worker` after
the scoped run cancellation. The cancelled run's Workflow status changes
immediately, but an already locked Graphile job can remain held until the
running worker process unwinds. Restarting the worker kills the stale in-flight
JavaScript loop and lets the runtime re-enqueue only active runs.

### Deployment checkpoint: Admin worker must receive Admin-side hotfixes

The launch-timeout correlation hotfix changed both Admin web code and Admin
workflow/backfill code. Deploying `@forge/admin` alone is not enough in
production: the durable transcript backfill loop runs on the separate
`@forge/admin/worker` Railway service. After the web and Mastra services were
updated, `@forge/admin/worker` was still on the June 19 deployment from `main`,
so re-enqueued transcript runs could continue using the old launch behavior.

The operational fix was to deploy the same hotfix commit to the worker service:

```bash
railway up \
  --project 98952497-a4d9-4714-8fe8-0cdbff3147c9 \
  --environment production \
  --service '@forge/admin/worker' \
  --detach \
  --message 'hotfix transcript embedding launch timeout correlation f4b48379'
```

Deployment `46f2c673-f3a3-4af7-b117-1b314989679b` reached `SUCCESS` on
2026-06-20. Startup logs showed `No pending migrations to apply` followed by
`[world-postgres] Re-enqueued 3 active run(s) on startup`, which confirmed the
worker was live and had picked up active durable runs on the new code.

When an Admin-side hotfix touches workflow steps, launch clients, ingest
helpers, or any code reachable from a `"use workflow"` body, verify all three
runtime surfaces before retrying production work:

- `@forge/admin` for GraphQL trigger and internal Mastra ingest routes.
- `@forge/admin/worker` for the durable Workflow loop and per-target launch
  logic.
- `@forge/mastra` for provider chunking, embedding, and Admin callback behavior.

### Hotfix checkpoint: target-sharded workflow batches avoid the 300s step ceiling

A fresh all-language `MODEL_UPGRADE` run,
`wrun_01KVJ27XMP17800AZY5R3FHJ0V`, was started through the existing Admin
GraphQL trigger with no `coreIds` and no `languages` filters. That was the
right all-language trigger shape, but it exposed a different Workflow runtime
boundary: one giant `stepProcessTranscriptEmbeddingGroups` step attempted to
own 208k targets and 1,452 groups.

The worker logs showed the same durable step failing twice at roughly five
minutes:

```text
[Graphile Worker] Failed task 27779 (workflow_steps, 300561.18ms, attempt 1 of 3) with error 'fetch failed'
[Graphile Worker] Failed task 27779 (workflow_steps, 300457.84ms, attempt 2 of 3) with error 'fetch failed'
```

Workflow storage then showed the run on attempt 3 for
`step//./src/workflows/_steps/process-transcript-embedding-group//stepProcessTranscriptEmbeddingGroups`.
The run was cancelled before the last retry could burn more provider work.
This failure was not an AI Gateway outage and not the earlier `1_jf-0-0`
provider batch failure: Admin storage continued receiving transcript writes,
and the failure was concentrated at the Workflow/Graphile task boundary.

No reliable timeout knob was found in `@workflow/world-postgres` for this
boundary. The queue worker posts each step to the local Workflow HTTP route,
and the local execution failed around the same 300 second window. The fix is to
make each step small enough that it naturally returns before that boundary:

- Split each `(video, edition, language)` target into a one-target shard.
- Persist runtime knobs in `stepResolveTranscriptEmbeddingRuntimeConfig` before
  batching so workflow replay keeps the same partitioning even if Railway env
  changes during a long run.
- Pack shards into target-bounded batches using the default step target limit
  of 50.
- Call `stepProcessTranscriptEmbeddingGroups` sequentially per batch from the
  workflow body. Parallelism stays inside each small batch, not across dynamic
  workflow step fanout.
- Inside a durable batch step, launch targets in waves capped by
  `TRANSCRIPT_EMBEDDING_CONCURRENCY`. Stop launching new waves once the step
  has spent the default 220 second budget, return unprocessed groups, and let
  the workflow call the next durable step.
- Pass a 120 second Admin-side launch timeout to Mastra. A long Mastra run can
  continue and ingest later, but the Admin Workflow step returns before the
  Graphile five-minute boundary.
- Convert Mastra launch network errors that include a run id into pending
  ingest confirmations instead of sleeping inside the worker step.
- Check pending confirmations opportunistically between launch batches, then
  drain any remaining pending confirmations with short
  `stepConfirmTranscriptEmbeddingIngests` calls separated by workflow-level
  `sleep()`, so the wait is durable and does not hold one Graphile task open.
- Convert unresolved confirmations to `network_error` outcomes only after the
  20 minute confirmation window.

The tradeoff is deliberate. Manager fallback artifacts may be read once per
durable step per `cmsVideoId` during a full backfill rather than once per
whole run. The step-local loader caches source artifacts while a batch is
active, but later batches may reread the same Manager artifact. That costs
extra S3 reads, but it keeps every Workflow step bounded and avoids replaying a
giant step after a five-minute worker failure. A future first-class
ledger/generation table can optimize source reuse without putting the whole
corpus back inside one step.

Deploy both `@forge/admin` and `@forge/admin/worker` before retrying this
class of hotfix. The GraphQL surface starts the run, but the worker service is
the process executing the target-sharded steps.

### Monitor checkpoint: 2026-06-21 paused live babysitting

After the target-sharded hotfix was deployed, a fresh production all-language
run `wrun_01KVJ5MSF2V6EEMG7FDQQKFF84` was started through the existing Admin
GraphQL trigger with no `coreIds` and no `languages` filters. The start log
reported `totalTargets=208073`, `groupCount=1452`, `groupBatchCount=4162`,
`stepTargetLimit=50`, `stepMaxDurationMs=220000`, `launchTimeoutMs=120000`,
`concurrency=5`, and `languageFilter=null`.

Live monitoring through 2026-06-21 08:23 UTC showed the parent Workflow run
still `running`, with 516 completed durable steps and one running step. The
latest step had no error. Admin storage showed 4,992 transcript rows touched
since the run start, spanning 303 languages and 121 videos. The current
`1_jf-0-0` section had written 39 transcript rows in this run window. The
latest observed write was `1_jf-0-0` language `mxj` at
2026-06-21 08:02:16 UTC from `manager-transcript` using
`jesus-film-ai-gateway`.

Many completed steps did not increase the transcript-row counter. Do not call
those "skipped embeddings" without stronger evidence. In this monitor window,
that phrase only meant "Workflow step completed without a new
`video_transcript.updated_at >= run.started_at` row becoming the latest write."
It can represent target batches with no usable subtitle/transcript source,
already-satisfied rows, or other no-write outcomes; it is not by itself proof
that valid embeddings were dropped or failed.

At the operator's request, live babysitting was stopped after this checkpoint.
The rough ETA from 516 of 4,162 reported group batches was June 27-28 UTC, but
the estimate is sensitive to write-heavy versus no-write batches. Resume the
status check around June 28, 2026 UTC by querying the Workflow row for
`wrun_01KVJ5MSF2V6EEMG7FDQQKFF84`; do not start a new backfill unless the
operator explicitly asks.

### Terminal checkpoint: 2026-06-21 morning follow-up

At 2026-06-21 20:46 UTC, production storage showed
`wrun_01KVJ5MSF2V6EEMG7FDQQKFF84` as `failed`. The run started at
2026-06-20 09:26:33 UTC and failed at 2026-06-21 12:20:19 UTC. The Workflow
row had no JSON `error` or `output`, but Admin worker logs around the failure
window showed the runtime cause:

```text
[Workflow] Workflow run failed with 1 uncommitted operation(s): step
"step//./src/workflows/_steps/process-transcript-embedding-group//stepProcessTranscriptEmbeddingGroups".
Did you forget to `await` a step, hook, or sleep call?

WorkflowRuntimeError: Unconsumed event in event log:
eventType=step_started,
correlationId=step_01KVJ5MWKPA0TW759HW4VPBSAR,
eventId=wevt_01KVN1Z8DSY297DP8T4C7RMWF3.
```

Immediately before that, Graphile worker logs showed confirm-ingest tasks
hitting the roughly five-minute task boundary with `fetch failed`. The
Workflow ledger showed all recorded step rows as `completed`, but the event log
had more `step_started` events than consumable step completions:

- 567 completed step rows.
- 314 completed `stepProcessTranscriptEmbeddingGroups` rows.
- 250 completed `stepConfirmTranscriptEmbeddingIngests` rows.
- 570 `step_started` events, 568 `step_created` events, 567
  `step_completed` events, and one `run_failed` event.
- Three step ids had duplicate `step_started` events.

This means the target-sharded run still hit the useworkflow/Graphile event-log
corruption shape once confirm-ingest steps crossed the worker task boundary.
It was not a clean all-language completion.

Admin transcript storage nevertheless continued receiving late Mastra ingests
after the parent Workflow failed. Since this run started, Admin showed 5,167
transcript rows touched across 451 languages, 121 videos, and 177 video
editions. The latest observed transcript write was 2026-06-21 17:18:58 UTC,
and there were zero transcript writes in the following three hours as of the
20:46 UTC check.

Touched rows were mostly Manager transcript fallback writes:

- 5,139 `manager-transcript` / `model-upgrade` rows.
- 28 `subtitle` / `model-upgrade` rows.
- 214 touched rows for `1_jf-0-0` across 211 languages.

Global transcript health at that checkpoint was:

- 9,311 enriched-healthy transcript rows.
- 42,634 legacy or incomplete transcript rows.
- 51,945 total transcript rows.
- 5,463 transcript rows whose chunks all had demographics.
- 4,897 transcript rows whose chunks all had felt-needs.

Mastra workflow snapshots since the Admin run start showed 6,721
`transcript-embedding` snapshots: 5,249 succeeded and 1,472 failed. The failed
snapshots were all for `1_jf-0-0` with `provider_failed`: 1,383 marked
non-retryable and 89 marked retryable. This confirms the earlier long-Jesus
Film payload/provider-failure concentration persisted, even though some
`1_jf-0-0` languages later succeeded and ingested.

Do not call the production all-language backfill complete from this run. The
next operational move needs another bounded-runner fix or a different resume
surface before retrying the remaining all-language work. A plain rerun with the
same confirm-ingest step shape risks recreating the same event-log corruption.

### Hotfix checkpoint: 2026-06-22 bounded confirm and resume skip

The June 22 hotfix changed the transcript backfill runner in two places:

1. `stepConfirmTranscriptEmbeddingIngests` and
   `stepFailPendingTranscriptEmbeddingIngests` are now called with bounded
   pending-confirmation slices. The workflow caller slices before entering the
   durable step, so Workflow storage no longer persists the full 600 KB+
   pending list as one step input/output pair. Unresolved confirmations rotate
   to the tail so long Mastra runs cannot starve later pending runs.
2. `MODEL_UPGRADE` backfill processing now checks Admin transcript storage
   before launching Mastra. A target is skipped with
   `already_enriched_healthy` only when the existing row has the current
   model-upgrade provenance: `generation_mode = 'model-upgrade'`, the accepted
   transcript embedding model stamp, `embedding_provider =
'jesus-film-ai-gateway'`, expected dimensions, a non-null source kind, every
   chunk has an embedding, and every chunk has non-empty
   `embedding_input_text`. Legacy, incomplete, missing, stale `force`, stale
   provider/model, or v1 rows remain eligible.

Use the existing Admin GraphQL trigger for recovery. Do not start Mastra
directly. To prove the fix at the latest known failure point without replaying
already-upgraded rows, resume with the known failing core id and no language
filter:

```graphql
mutation ResumeTranscriptEmbeddingBackfill {
  triggerTranscriptEmbeddingBackfill(mode: MODEL_UPGRADE, coreIds: ["1_jf-0-0"])
}
```

The expected early signals are:

- The start log includes `confirmationBatchLimit`.
- Confirm-ingest step inputs stay bounded by that limit.
- Healthy enriched `1_jf-0-0` language rows log
  `reason=already_enriched_healthy` instead of launching provider work again.
- Legacy or incomplete `1_jf-0-0` language rows still launch through Mastra and
  ingest normally.

### Hotfix checkpoint: 2026-06-22 large groups must defer remaining targets

After the bounded-confirm/resume-skip hotfix deployed, the intended scoped
resume was started through the existing Admin GraphQL mutation:
`MODEL_UPGRADE`, `coreIds: ["1_jf-0-0"]`, and no language filter. The GraphQL
request timed out, but Workflow run `wrun_01KVPQTTTQJGSWKET22FB3V156` started
successfully at 2026-06-22 04:01 UTC.

Early process and confirm steps were healthy. Process steps completed around
the expected two-minute range, confirm steps stayed short, and the event log
had no duplicate `step_started` entries in the early window. The later failure
shape was different: `1_jf-0-0` is one very large `(video, edition)` group, so
the outer process-wave budget guard did not stop
`processTranscriptEmbeddingGroup` from launching many language targets
sequentially inside one durable step.

The run was cancelled through Workflow's native CLI and production containment
was verified before applying the next hotfix:

```bash
WORKFLOW_POSTGRES_URL="$DATABASE_PUBLIC_URL" \
pnpm --filter @forge/admin exec workflow cancel \
  wrun_01KVPQTTTQJGSWKET22FB3V156 \
  --backend @workflow/world-postgres --json
```

The cancelled run reached terminal `cancelled` status at
2026-06-22 09:00:19 UTC. Admin transcript storage showed 56 rows touched since
that scoped run started, with the latest observed write at
2026-06-22 09:20:05 UTC, and no transcript writes in the later containment
window.

The follow-up Admin hotfix applies the projected-runtime guard inside the group
target loop as well as between outer group waves. The production batcher also
preserves target-limited multi-target group chunks instead of rewriting every
language target into a singleton group, so the existing GraphQL trigger path
actually exercises the guarded loop. When the next language target cannot fit
inside the remaining step budget, the step returns the same group with
`targets` sliced to the unprocessed languages. The parent workflow then
processes that remainder group in a fresh durable step.

Do not retry the scoped `1_jf-0-0` resume until both `@forge/admin` and
`@forge/admin/worker` have the target-loop hotfix. After deploy, retry the same
scoped shape rather than restarting the broad all-language corpus:

```graphql
mutation ResumeTranscriptEmbeddingBackfill {
  triggerTranscriptEmbeddingBackfill(mode: MODEL_UPGRADE, coreIds: ["1_jf-0-0"])
}
```

The expected proof is that long `1_jf-0-0` process steps return under the
worker boundary, healthy enriched rows log `already_enriched_healthy`, and any
remaining language targets continue through sliced remainder groups instead of
one oversized durable step. The target-loop hotfix emits a scrubbed structured
log when it defers a suffix:

```text
event=transcript_index_target_deferred
coreId=<core id>
videoEditionId=<edition id>
processedTargets=<count already handled in this group>
remainingTargets=<count returned as the sliced remainder>
elapsedMs=<step elapsed before deferral>
stepMaxDurationMs=<configured step budget>
launchTimeoutMs=<configured Mastra launch timeout>
```

Use that event, plus short `stepProcessTranscriptEmbeddingGroups` durations,
to prove the sliced remainder path is actually active. The log must not include
transcript text, embedding input text, vectors, request bodies, raw provider
responses, or API keys.

- No confirm-ingest Graphile task runs near the 300 second boundary.

### Hotfix checkpoint: 2026-06-22 projected process-step budget

A scoped resume for `1_jf-0-0` after the bounded-confirm hotfix still
reproduced the event-log corruption shape. The poisoned run
`wrun_01KVPDSDX54JPV9FFVR43FQV4W` had a duplicate `step_started` for
`stepProcessTranscriptEmbeddingGroups`. The completed attempt ran for about
316 seconds, which crossed the same worker task-boundary window even though
the pending-confirm payloads were already bounded.

The follow-up fix is to budget process waves by projected runtime. After the
first launch wave, `stepProcessTranscriptEmbeddingGroups` now defers remaining
groups when the remaining step budget is less than or equal to
`launchTimeoutMs + safetyBufferMs`. Deferred groups return as
`unprocessedGroups`, so the parent workflow can continue them in a fresh
durable step without rewriting rows the strict `MODEL_UPGRADE` resume guard
already considers healthy.

Resume with the same recovery shape after deploy: use the existing Admin
GraphQL trigger, scoped to `coreIds: ["1_jf-0-0"]`, with no language filter.
Expected healthy signals are: at least one process step logs real
`already_enriched_healthy` skips, process-step durations remain below the
Graphile boundary, no duplicate `step_started` events appear for the resumed
run, and legacy or incomplete `1_jf-0-0` language rows continue through Mastra
and Admin ingest.

### Operational checkpoint: 2026-06-25 stale flow locks after deploy

The all-language production run later paused after a normal Railway deployment
replaced `@forge/admin/worker`. The last healthy step completed at
2026-06-25 22:27:50 UTC, immediately after a
`transcript_index_target_deferred` log for `1_jf6111-0-0` with remaining
targets. The old deployment then received `SIGTERM`; the new deployment
started, ran migrations, and logged `[world-postgres] Re-enqueued 2 active
run(s) on startup`.

The pause was not an AI Gateway outage and not a transcript target failure.
Workflow storage showed:

- The transcript run `wrun_01KVV2F0VYT6TH1AY22V7B3SB8` was still `running`.
- All 3,326 recorded transcript steps were `completed`.
- The last event stayed at `step_completed` for the latest
  `stepConfirmTranscriptEmbeddingIngests`.
- The active worker heartbeat was fresh but idle.
- Two Graphile `workflow_flows` jobs, ids `37850` and `37851`, were locked by
  old worker ids for the same run id. One was the normal post-step
  continuation and one was the startup re-enqueue continuation.

Graphile Worker 0.16 clears stale locks automatically only after four hours:

```sql
locked_at < now() - interval '4 hours'
```

For an active production backfill, waiting four hours is unnecessary when the
locked jobs are provably stale, scoped to one run, and the current worker is
alive. The targeted recovery mirrored Graphile's own stale-lock reset, but
narrowed the predicate to the two `workflow_flows` jobs for the known transcript
run:

```sql
WITH stale AS (
  SELECT j.id, j.job_queue_id
  FROM graphile_worker._private_jobs j
  JOIN graphile_worker._private_tasks t ON t.id = j.task_id
  WHERE j.id IN (37850, 37851)
    AND t.identifier = 'workflow_flows'
    AND j.locked_by IS NOT NULL
    AND j.locked_at < now() - interval '20 minutes'
    AND (
      convert_from(decode(j.payload->>'data', 'base64'), 'utf8')::jsonb
        ->> 'runId'
    ) = 'wrun_01KVV2F0VYT6TH1AY22V7B3SB8'
)
UPDATE graphile_worker._private_jobs j
SET locked_at = NULL,
    locked_by = NULL,
    run_at = greatest(j.run_at, now())
FROM stale
WHERE j.id = stale.id;
```

The private job rows had `job_queue_id = null`, so no queue rows needed to be
unlocked. After the unlock, the same Workflow run created
`stepProcessTranscriptEmbeddingGroups` at 2026-06-25 22:54:23 UTC, then
completed process and confirm-ingest steps and scheduled the next process step.
That proved the existing run resumed instead of restarting or re-enumerating
healthy rows.

Use this recovery only when all of these are true:

- The active worker heartbeat is fresh and `current_job` is empty or unrelated.
- The transcript Workflow run is still `running`, but its latest event is old.
- All latest transcript steps are `completed`; there is no failed step to
  investigate first.
- Locked Graphile jobs decode to the same expected `runId`.
- The lock age is long enough to be stale relative to the deployment cutover,
  not merely a currently executing step.
- The recovery updates only those decoded stale jobs and preserves `attempts`,
  payloads, and run state.

After unlocking, prove recovery from storage, not hope: `workflow_steps` should
gain a new process or confirm step on the same run id, failed-step count should
stay zero, and any remaining locked job should be a live `workflow_steps` job
whose lock age is seconds or a normal in-flight provider wait.

### Operational checkpoint: 2026-06-28 duplicate step locks after restart

The same all-language production run later stalled after a worker restart while
one `stepProcessTranscriptEmbeddingGroups` step was running. The run id was
still `wrun_01KVV2F0VYT6TH1AY22V7B3SB8`, and the latest database write stayed
at 2026-06-28 23:43:20 UTC. No transcript or chunk rows were updated in the
following checks, and the latest step remained `running` past the normal step
budget.

This was a different failure shape from the stale `workflow_flows` lock. The
worker heartbeat was fresh, but Graphile had duplicate locked `workflow_steps`
jobs for the same step id and idempotency key:

- job `56918`, attempts `3/3`, locked before restart
- job `56922`, attempts `1/3`, locked after restart

The Workflow event log for that step had one `step_created` and one
`step_started`, with no terminal event yet. Source reads were not the likely
root cause because subtitle reads, Manager artifact reads, and Mastra launches
all have explicit timeouts. The more likely root cause was the
useworkflow/Graphile task layer around restart boundaries: the provider's
in-memory idempotency and in-flight maps do not survive process replacement, so
a restart can leave duplicate locked task rows for the same Workflow step.

Do not use the stale-flow private unlock recipe for this shape. Retrying or
unlocking a still-running `workflow_steps` task can duplicate `step_started`
events and corrupt the run history. The safer operational path is:

1. Cancel the wedged run through Workflow's native cancel command.
2. Verify the run reaches terminal `cancelled` state and records
   `run_cancelled`.
3. Restart `@forge/admin/worker` so the old locked jobs cannot continue in the
   replaced process.
4. Trigger the existing Admin GraphQL backfill with `mode: MODEL_UPGRADE`, no
   `coreIds`, and no `languages`.
5. Verify the replacement run has `languageFilter=null`, `totalTargets=211037`,
   and `already_enriched_healthy` skip logs before treating it as resumed.

On 2026-06-28, the replacement all-language run was
`wrun_01KW8AMG5Y4FF6HWZ7ZHQ8X2J3`. It started at
2026-06-28 23:57:01 UTC. Early checks showed hundreds of completed steps, zero
failed steps, one normal in-flight step, and rapid
`transcript_index_skipped` logs with `reason="already_enriched_healthy"`.
That proves the replacement run was not re-embedding healthy rows from scratch;
it was using the existing `MODEL_UPGRADE` health guard to move forward over the
already completed corpus.

### Operational checkpoint: 2026-06-29 replacement run completion

The replacement all-language run completed cleanly on 2026-06-29 at
20:15:33 UTC. Treat this as the completion proof for the June 2026 enriched
transcript backfill, not the cancelled predecessor run.

Final Workflow storage audit:

- Run id: `wrun_01KW8AMG5Y4FF6HWZ7ZHQ8X2J3`.
- Status: terminal `completed`.
- Steps: 4,893 completed out of 4,893 total.
- Failed, pending, running, and stale steps: 0.
- Duplicate recent transcript groups: 0.
- Worker failure signals during the completion audit: 0.

Final Admin storage audit:

- Replacement-run writes: 22,069 transcript rows and 41,605 chunk rows.
- Writes since the original backfill window began: 153,522 transcript rows and
  188,981 chunk rows.
- Search-visible current transcript chunks: 280,107 rows matching the gateway
  `embeddings` provider/model/dimension contract.
- Legacy OpenAI transcript parents and chunks: 0.

Late source-data skips were coverage gaps, not Workflow failures. The observed
skip reasons were mostly `dub_without_timed_text` with a smaller number of
`subtitle_missing` targets. Those should feed source coverage and Manager
enrichment follow-up work, but they do not make the all-language embedding run
failed.

Scene embedding rows still existed after completion, but the runtime
`semantic-video` and recommendation paths were already transcript-backed. Scene
rows are therefore a storage/code-retention cleanup problem, not active search
relevance for feat-192.

## Cleanup and Versioning Strategy

Successful enriched transcript writes are upserts on the transcript identity
and chunk identity, so a successful target should not create duplicate
transcript rows. After the completed replacement run there were no legacy
OpenAI transcript parents or chunks left in the search-visible transcript
contract, so no destructive transcript cleanup was needed for search
correctness. The remaining cleanup problem is narrower: classify source gaps
and eventually remove or exclude obsolete scene/storage artifacts that are no
longer consumed by search.

Use this sequence after the run reaches a terminal state:

1. Produce a final run report from Admin storage: parent Workflow status,
   rows touched since the run start, enriched-healthy row count,
   legacy/incomplete row count, and last write timestamp.
2. Produce a Mastra-side target failure report: failed/running/success counts
   for `transcript-embedding` snapshots since the run start, grouped by
   `coreId`, reason, retryable flag, chunk count, and token count.
3. Classify remaining legacy/incomplete rows into retryable provider failures,
   source gaps/skips, and obsolete rows that should no longer participate in
   semantic search.
4. Do not run a manual delete as the first move. Prefer a reviewed cleanup
   migration or operator job that takes an explicit final report as input and
   deletes or disables only rows proven to be legacy/incomplete.
5. Until a first-class backfill generation exists, treat the run start timestamp
   plus v2 health fields (`generation_mode`, `source_kind`,
   `embedding_input_text`, chunk embedding completeness) as the operational
   version stamp.
6. For the durable fix, add explicit embedding schema/version metadata such as
   `embeddingSchemaVersion` and `backfillRunId` to transcript rows/chunks, or a
   separate backfill generation table. Cleanup can then target all rows whose
   version/run id is older than the accepted generation without relying on
   inference from timestamps and nullable fields.

Scoped retries can be useful after the final report identifies failed/missing
targets, but they are recovery work. They should not be used to redefine an
intended all-language run as complete.

## When to Apply

- A transcript or scene embedding backfill is large enough to exceed an HTTP
  request budget.
- A GraphQL trigger times out but Workflow storage shows the run still pending
  or running.
- A backfill must continue after an outage without rewriting already-upgraded
  rows.
- A useworkflow step wraps many provider launches or database writes inside one
  step body.
- A Graphile-backed Workflow step fails near 300 seconds even though per-target
  provider and database work can still succeed.

## Examples

### Detecting the active run

Use the Workflow ledger, not the timed-out GraphQL client, as source of truth:

```sql
select id, status, created_at, started_at, completed_at
from workflow.workflow_runs
where name ilike '%transcript%'
order by created_at desc;
```

### Cancelling the run

Use Workflow's native cancellation API when the run id is known:

```ts
import { getRun } from "workflow/api"

await getRun(runId).cancel()
```

Then verify storage shows `status = 'cancelled'`. If worker logs still emit
`transcript_index_complete`, the current step is still running and the worker
process needs to be restarted.

### Sizing resume work

Count rows that the `MODEL_UPGRADE` resume guard will skip versus rows that
still need processing before resuming:

```sql
with transcript_health as (
  select
    vt.id,
    vt.source_kind,
    vt.generation_mode,
    vt.model,
    vt.dimensions,
    vt.embedding_provider,
    vt.total_chunks,
    count(vtc.*) filter (
      where vtc.embedding is not null
    ) as chunks_with_embedding,
    count(vtc.*) filter (
      where vtc.embedding_input_text is not null
        and length(vtc.embedding_input_text) > 0
    ) as chunks_with_embedding_input_text
  from video_transcript vt
  left join video_transcript_chunk vtc on vtc.transcript_id = vt.id
  group by vt.id
)
select
  count(*) filter (
    where generation_mode = 'model-upgrade'
      and model in (
        'openai/text-embedding-3-small',
        'text-embedding-3-small',
        'embeddings'
      )
      and dimensions = 1536
      and embedding_provider = 'jesus-film-ai-gateway'
      and source_kind is not null
      and chunks_with_embedding_input_text = total_chunks
      and chunks_with_embedding = total_chunks
  ) as resume_skip_eligible,
  count(*) filter (
    where not (
      generation_mode = 'model-upgrade'
      and model in (
        'openai/text-embedding-3-small',
        'text-embedding-3-small',
        'embeddings'
      )
      and dimensions = 1536
      and embedding_provider = 'jesus-film-ai-gateway'
      and source_kind is not null
      and chunks_with_embedding_input_text = total_chunks
      and chunks_with_embedding = total_chunks
    )
  ) as needs_resume_processing
from transcript_health;
```

Earlier June 2026 recovery counts used a broader "enriched healthy" predicate
that included `force` rows. That is useful for storage health, but it is not
the resume-skip predicate. For resume sizing, use `resume_skip_eligible` above
so operators and agents do not overestimate how much work will be skipped.

## Related

- [Bound durable workflow step payloads before persistence](bound-durable-workflow-step-payloads-before-persistence.md)
- [Budget durable workflow steps by projected runtime](budget-durable-workflow-steps-by-projected-runtime.md)
- [useworkflow group fanout must run inside one durable step](../runtime-errors/useworkflow-nested-group-step-event-log-corruption.md)
- [Mastra transcript launch network error diagnostics](../runtime-errors/mastra-transcript-launch-network-error-diagnostics.md)
- [Admin Postgres workflow operations pattern](../best-practices/admin-postgres-workflow-operations-pattern-20260501.md)
- Linear follow-up: AI-67, transcript embedding backfill operator surface with resume, cancel, and progress controls.
