---
title: "Transcript embedding backfills need cancellable resume batches"
date: "2026-06-19"
last_updated: "2026-06-20"
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
  - cancellation
  - resume
  - railway
  - timeout
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

## Cleanup and Versioning Strategy

Successful enriched transcript writes are upserts on the transcript identity
and chunk identity, so a successful target should not create duplicate
transcript rows. The cleanup problem after the all-language run is therefore
not "delete duplicates"; it is "remove or exclude legacy/incomplete rows that
remain search-visible after the v2 backfill."

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

Count enriched versus legacy transcript rows before resuming:

```sql
with transcript_health as (
  select
    vt.id,
    vt.source_kind,
    vt.generation_mode,
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
    where generation_mode in ('force', 'model-upgrade')
      and source_kind is not null
      and chunks_with_embedding_input_text = total_chunks
      and chunks_with_embedding = total_chunks
  ) as enriched_healthy,
  count(*) filter (
    where not (
      generation_mode in ('force', 'model-upgrade')
      and source_kind is not null
      and chunks_with_embedding_input_text = total_chunks
      and chunks_with_embedding = total_chunks
    )
  ) as legacy_or_incomplete
from transcript_health;
```

In the June 2026 recovery, this showed 2,228 enriched healthy transcript rows
and 49,111 legacy-but-vector-healthy rows. The correct continuation was to
resume the legacy set, not restart the full 208,073-target catalog.

## Related

- [useworkflow group fanout must run inside one durable step](../runtime-errors/useworkflow-nested-group-step-event-log-corruption.md)
- [Mastra transcript launch network error diagnostics](../runtime-errors/mastra-transcript-launch-network-error-diagnostics.md)
- [Admin Postgres workflow operations pattern](../best-practices/admin-postgres-workflow-operations-pattern-20260501.md)
- Linear follow-up: AI-67, transcript embedding backfill operator surface with resume, cancel, and progress controls.
