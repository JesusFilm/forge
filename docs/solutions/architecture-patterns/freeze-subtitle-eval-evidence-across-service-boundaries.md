---
title: "Freeze subtitle AI-evaluation evidence as one cross-service commit protocol"
date: 2026-08-20
category: architecture-patterns
module: "apps/mastra + apps/manager + apps/admin"
problem_type: architecture_pattern
component: testing_framework
severity: high
applies_when:
  - "A model-evaluation cell crosses worker, coordinator, API, database, and object-storage trust boundaries"
  - "A retry must distinguish an exact replay from new or conflicting evidence"
  - "Provider-call evidence and a terminal report can be written concurrently"
related_components:
  - background_job
  - service_object
  - database
  - tooling
tags:
  - subtitle-quality-lab
  - evaluation-evidence
  - append-only
  - replay-safety
  - provider-calls
  - terminal-report
  - concurrency
---

# Freeze subtitle AI-evaluation evidence as one cross-service commit protocol

## Context

Forge's subtitle evaluation crosses three services with different authority. Mastra executes provider-backed translation and scoring, Manager coordinates leases and stores content-addressed artifacts, and Admin owns the durable evaluation ledger and terminal report. A cell can also be retried after an ambiguous response while provider-call insertion races with run finalization. Freezing only a final status would therefore leave several ways to produce a plausible but false history: an omitted provider call, a replaced artifact, a replay with a different assessment, a late provider insert after a report, or a report assembled from nondeterministically ordered rows.

The solution is to treat evidence freezing as one protocol spanning all of those boundaries. The protocol has a bounded evidence envelope, an exact three-artifact commit bundle, content-addressed identities, exact replay comparison, a canonical server-derived terminal report, and database locks and triggers that make terminalization a real cutover point. Missing evidence is represented explicitly or rejected; it is never inferred from a success status.

## Guidance

### Bound and require provider-call evidence at every trust boundary

Use the same hard ceiling wherever provider calls cross a process or persistence boundary. Mastra caps a cell at 64 provider calls and applies that cap to both success and failure envelopes (`apps/mastra/src/evals/subtitle-translation/types.ts:9`, `apps/mastra/src/evals/subtitle-translation/types.ts:591`, `apps/mastra/src/evals/subtitle-translation/types.ts:605`). The Manager client independently re-parses the provider-call shape and applies the same 64-call ceiling to successful and failed results (`apps/manager/src/services/mastra-subtitle-eval.ts:6`, `apps/manager/src/services/mastra-subtitle-eval.ts:230`, `apps/manager/src/services/mastra-subtitle-eval.ts:309`). Manager also bounds the entire response body before parsing it, so a valid-looking content type cannot bypass the byte ceiling through streaming (`apps/manager/src/services/mastra-subtitle-eval.ts:391`, `apps/manager/src/services/mastra-subtitle-eval.ts:408`).

Admin parses the vector again, limits the vector using the Admin-owned source ceiling, and requires contiguous one-based call sequences (`apps/admin/src/services/subtitle-eval.service.ts:345`). The field is required for both completion and failure; an explicit empty array means "no provider call was observed," while omission is invalid (`apps/admin/src/services/subtitle-eval.service.ts:1570`). Manager preserves the observed vector on success, provider-declared failure, and its own exception path (`apps/manager/src/workflows/subtitleEval.ts:161`, `apps/manager/src/workflows/subtitleEval.ts:247`).

Provider identifiers must remain nullable because not every provider exposes them. The Mastra evidence schema models request and response IDs as nullable (`apps/mastra/src/evals/subtitle-translation/types.ts:305`). The OpenRouter adapter records a response ID only when it comes from `X-Generation-Id` or the response body, and leaves the unavailable request ID null instead of manufacturing a correlation value (`apps/mastra/src/services/subtitle-enrichment/openrouter.ts:247`, `apps/mastra/src/services/subtitle-enrichment/openrouter.ts:293`, `apps/mastra/src/services/subtitle-enrichment/openrouter.ts:341`). Local sequence numbers and request digests provide stable internal identity without pretending to be provider-issued IDs.

### Commit one exact content-addressed cell bundle

A completed cell must contain exactly one artifact of each kind:

- `CANDIDATE_VTT` with media type `text/vtt`
- `REVIEW_EVIDENCE` with media type `application/json`
- `CELL_REPORT` with media type `application/json`

Admin enforces an array length of three, unique kinds, required kinds, and exact media types (`apps/admin/src/services/subtitle-eval.service.ts:291`). Manager writes those three objects and submits the exact projection to Admin (`apps/manager/src/workflows/subtitleEval.ts:181`, `apps/manager/src/workflows/subtitleEval.ts:227`). Before writing, Manager verifies Mastra's byte counts and canonical review-evidence projection rather than trusting the remote envelope (`apps/manager/src/workflows/subtitleEval.ts:441`). It also verifies the full identity attestation—cell, case, corpus locks, exact target language, source/reference hashes and subtitle identities, model, prompt/workflow policy, code revision, and timeout—against the claimed run (`apps/manager/src/workflows/subtitleEval.ts:415`).

The cell report is the commit document for the other two artifacts and the machine assessment. Manager canonicalizes the report, writes it with that canonical digest as its expected SHA-256, and sends the same digest as `resultDigest` (`apps/manager/src/workflows/subtitleEval.ts:203`, `apps/manager/src/workflows/subtitleEval.ts:219`). Admin rejects finalization unless the `CELL_REPORT.sha256` equals `resultDigest` (`apps/admin/src/services/subtitle-eval.service.ts:408`). This binds terminal cell identity to the report bytes rather than to a caller-selected label.

### Treat a retry as an equality assertion, never as a second write

An ambiguous response is safe to retry only when the retry proves it is the same logical commit. For an already completed cell, Admin checks the result digest, compares a deterministically kind-sorted artifact identity vector, compares the machine assessment digest, and compares the exact provider-call vector (`apps/admin/src/services/subtitle-eval.service.ts:1476`). Any difference is a conflict.

Most importantly, completed replay calls the read-only `assertProviderCallReplay`; it never calls the insertion helper (`apps/admin/src/services/subtitle-eval.service.ts:1506`). The assertion compares canonical digests of the existing and supplied vectors, including the empty-vector case (`apps/admin/src/services/subtitle-eval.service.ts:4022`). This means a replay cannot "repair" a completed cell by appending evidence that was absent during the original commit. Fresh fenced completion or failure may persist calls, but an existing vector must match exactly before persistence returns idempotently (`apps/admin/src/services/subtitle-eval.service.ts:3979`).

### Derive and canonicalize the terminal report inside Admin

Manager supplies expectations, not the report body. It waits until every cell is completed or failed, derives the expected terminal status and source/reference digest vector, and asks Admin to finalize (`apps/manager/src/workflows/subtitleEval.ts:367`). Admin locks the run, reloads its corpus snapshots, artifacts, assessments, provider calls, and cell states, and constructs the report from those durable rows (`apps/admin/src/services/subtitle-eval.service.ts:1635`).

Every order-sensitive collection is sorted before hashing or storage: reproducibility limits, source/reference identities, provider calls within cells, provider cells, assessed cells, artifact inventory, report-artifact identities, partial failures, and language/collection aggregate group and metric keys (`apps/admin/src/services/subtitle-eval.service.ts:1665`, `apps/admin/src/services/subtitle-eval.service.ts:1690`, `apps/admin/src/services/subtitle-eval.service.ts:1713`, `apps/admin/src/services/subtitle-eval.service.ts:1753`, `apps/admin/src/services/subtitle-eval.service.ts:1773`, `apps/admin/src/services/subtitle-eval.service.ts:1807`, `apps/admin/src/services/subtitle-eval.service.ts:4354`). Admin hashes this canonical report and refuses caller expectations that do not match its server-derived status or corpus evidence (`apps/admin/src/services/subtitle-eval.service.ts:1822`). A replay of run finalization likewise succeeds only when the already stored report matches the requested status, corpus identity, source/reference digest, and reproducibility limits (`apps/admin/src/services/subtitle-eval.service.ts:1673`).

### Serialize provider inserts against terminal report creation using the same run lock

Application-level transaction ordering alone is insufficient because a concurrent or future writer could insert provider evidence directly. Run finalization takes a `FOR UPDATE` lock on the parent `subtitle_eval_run` row before reading evidence and creating the terminal report (`apps/admin/src/services/subtitle-eval.service.ts:1638`). The database's provider-call `BEFORE INSERT` trigger resolves the call's parent run and takes `FOR UPDATE` on that same row before checking for an existing terminal report (`apps/admin/prisma/migrations/0052_subtitle_quality_lab/migration.sql:509`).

That shared lock creates a serial order. If a provider insert locks first, finalization waits and then includes it. If finalization locks first, the insert waits, observes the new terminal report, and fails. The trigger also rejects calls with no parent run, so an orphan cannot become unexplained evidence (`apps/admin/prisma/migrations/0052_subtitle_quality_lab/migration.sql:519`).

Finally, database triggers reject updates or deletes of terminal reports, artifacts, assessments, and provider calls (`apps/admin/prisma/migrations/0052_subtitle_quality_lab/migration.sql:492`). Separate guards keep the run request identity and cell binding identity immutable while allowing coordination state such as leases and statuses to change (`apps/admin/prisma/migrations/0052_subtitle_quality_lab/migration.sql:596`, `apps/admin/prisma/migrations/0052_subtitle_quality_lab/migration.sql:628`). The database remains the last line of defense even if a service path is later changed incorrectly.

### Fail closed when evidence cannot be proven

Do not translate missing or malformed evidence into guessed success metadata. Mastra's success and failure envelopes both require a bounded provider-call array; provider errors carry the tracker snapshot, while code with no attached evidence returns an explicit empty vector (`apps/mastra/src/evals/subtitle-translation/runner.ts:162`, `apps/mastra/src/evals/subtitle-translation/cloud-runner.ts:517`). Manager converts an invalid or oversized Mastra response into a typed failure rather than extracting partial fields (`apps/manager/src/services/mastra-subtitle-eval.ts:391`). Admin rejects missing artifact kinds, wrong media types, digest mismatches, replay mismatches, stale leases, and terminal expectation mismatches rather than writing a weakened record.

The invariant is: terminal means the complete evidence Admin accepted at that instant, not the best evidence a caller was able to reconstruct later.

## Why This Matters

Evaluation reports guide prompt and workflow decisions, so provenance errors are product errors. A score without its exact candidate, review projection, provider vector, and runtime identity can make two runs look comparable when they are not. A late provider call can change cost and model attribution after a human has already reviewed the report. A permissive retry can silently rewrite the past after a response-loss incident.

This protocol makes a terminal report a trustworthy commit point. It also distributes validation deliberately: Mastra constrains what it emits, Manager verifies remote identity and owns object writes, Admin revalidates and derives durable truth, and PostgreSQL prevents mutation and closes concurrency races. No single service's correctness is assumed to be sufficient.

## When to Apply

- A model or provider workflow spans worker, coordinator, API, database, and object storage.
- Provider telemetry affects quality, cost, reproducibility, or audit decisions.
- Completion requests may be retried after transport loss.
- Multiple cells finalize independently before one aggregate report is published.
- Evidence can arrive concurrently with terminalization.
- Historical results will be compared across prompts, models, providers, languages, collections, or code revisions.
- Missing provider metadata is legitimate, but invented metadata is not.

The same pattern applies to agent benchmarks, media-generation audits, batch inference, migration verification, and any workflow where a terminal record must freeze several independently produced evidence streams.

## Examples

### Response loss after a successful cell commit

Manager sends the candidate VTT, review evidence, cell report, assessment, and provider-call vector. Admin commits them, but the response is lost. Manager retries the same request. Admin sorts and compares the artifact identities, checks the assessment digest, and asserts the exact provider vector. It returns a replay without inserting anything. If even one object key, digest, call ID, usage field, or call sequence differs, the retry conflicts.

### Provider call races with run finalization

One transaction begins inserting the last provider call while another begins terminal report creation. Both must lock the same parent run row. Whichever obtains the lock first defines the order: the report either includes the committed call, or the insert occurs after terminalization and is rejected. There is no timing window in which the report commits and a call silently appears behind it.

### Provider omits request identity

OpenRouter exposes a generation ID but no request ID. The evidence records the response ID, request digest, local call sequence, requested model, and a null request ID. It does not synthesize a provider-looking request ID from a UUID. If the whole provider result is malformed, Manager returns a typed execution failure with an explicit empty evidence vector rather than accepting partial unvalidated telemetry.

### Incomplete artifact submission

A caller submits a candidate and review JSON but omits the cell report, or labels JSON as `text/plain`. Admin rejects the request before terminalizing the cell. The caller cannot later use a replay to add the missing object because completed-cell replay is equality-only, not an append path.

## Related

- [Bind eval manifest identity through execution and evidence publication](./bind-eval-manifest-identity-to-execution-and-evidence.md)
- [Mastra offline search eval orchestration boundary pattern](./mastra-offline-search-eval-orchestration-boundary-pattern.md)
- [Preserve provider metadata across workflow adapters](../integration-issues/preserve-provider-metadata-across-workflow-adapters.md)
- [Check-and-claim must be a single atomic UPDATE](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md)
