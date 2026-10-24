---
title: Admin → Manager enrichment-trigger endpoint
date: 2026-05-06
last_updated: 2026-05-19
tags:
  - admin
  - manager
  - cross-app
  - auth
  - api-contract
related:
  - docs/solutions/platform/local-embed-pipeline-pattern-20260429.md
  - docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md
  - docs/solutions/best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md
  - docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md
  - docs/solutions/best-practices/external-client-retry-parity-in-runner-fanout-20260512.md
  - docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
---

# Admin → Manager enrichment-trigger endpoint (feat-119 PR2)

## Problem

PR1 (feat-119) classifies `NoSuchKey` errors from manager's S3 bucket
as `skipped { artifact_missing }` and projects a deduped
`missingArtifacts: ReadonlyArray<{ assetId, coreId, kind }>` field
onto the embed-backfill workflow report. That tells the operator
_which_ upstream artifacts manager hasn't produced yet — but admin
had no way to _ask_ manager to produce them. The operator's only
recourse was to log into the manager dashboard and trigger
per-video, which is slow and doesn't scale to the dozens-to-hundreds
of missing assets a fresh R0 backfill surfaces.

The pre-PR2 boundary between admin and manager was strictly
read-only-S3: admin reads `{assetId}/scene-analysis.json` and
`{assetId}/embeddings.json` from manager's bucket, regenerates
vectors, indexes them. PR2 adds the _first_ admin → manager
**outbound dispatch** in the repo: a deliberate, narrow seam where
admin asks manager to produce a specific artifact for a list of admin
videos. The shape mirrors the existing manager → admin direction
(`/api/admin-embeds/{scene,transcript}` → `triggerSceneEmbeddingBackfill`)
but inverts every direction-dependent piece (caller-side single key

- receiver-side CSV; bearer auth on the receiver instead of mintable
  WORKFLOW_TRIGGER on admin).

## Solution shape

Three surfaces:

1. **Admin GraphQL mutation** `triggerManagerEnrichment(assetIds:
[Int!]!, coreIds: [String!]!, kind: String!): JSON!` (returns one
   `{ assetId, coreId, managerJobId, status }` per requested item).
   Gated by `hasPermission: "write:manager-enrichment-trigger"` (new
   permission key, ADMIN-only at the editorial-tier ladder, also on
   the WORKFLOW_TRIGGER allowlist so the CLI's bearer mint can
   invoke it).
2. **Admin outbound HTTPS client**
   `apps/admin/src/services/manager-trigger.service.ts` — POSTs to
   `${MANAGER_API_BASE_URL}/api/admin-trigger/${kind}` with
   `Authorization: Bearer ${MANAGER_TRIGGER_API_KEY}`. Returns a
   discriminated `ManagerEnrichmentDispatchResult[]` envelope —
   `STARTED | ALREADY_IN_FLIGHT | NOT_FOUND | VALIDATION_FAILED |
DISPATCH_FAILED`. NEVER throws; on transport / auth / config
   failure synthesises a `DISPATCH_FAILED` entry per requested
   assetId. `AbortSignal.timeout(15_000)` ceiling.
3. **Manager REST endpoints** `POST
/api/admin-trigger/{scene-analysis,transcript}`. Body:
   `{ items: [{ assetId: number, coreId: string }, ...] }`. Auth:
   bearer in the `ADMIN_TRIGGER_API_KEYS` CSV allowlist. Per-item
   flow: admin lookup by `coreId` → validation/idempotency check
   → accepted jobs enter a bounded process-local dispatch queue via
   `after()` → return per-item outcome.

Plus an admin CLI (`pnpm --filter @forge/admin trigger-enrichment`)
that consumes PR1's `--report-out` JSON via `--from-report=<path>`
or accepts manual paired flags.

## Why coreId on the wire (deviation from plan D-A)

The plan assumed manager could look up videos by a legacy numeric
content ID. The stable cross-system identity is `coreId`, and PR1's
`missingArtifacts` projection already carries `{ assetId, coreId,
kind }`, so admin always has the coreId to send. The wire payload
mirrors that shape: `assetId` is the operator-facing identifier and
the storage-key prefix manager uses when writing artifacts; `coreId`
is the lookup key manager sends to admin's `videosByCoreIds` GraphQL
query.

Documented at the top of
`apps/manager/src/lib/admin-trigger-route.ts` so the next reader
doesn't reverse the decision in a refactor.

## Why an in-memory idempotency map (deviation from plan D7)

Plan D7 said "query EnrichmentJob for in-flight match". Manager-
side reconnaissance found three blockers:

1. Existing durable enrichment job state is not keyed by the integer
   `assetId` used by this trigger surface. Bridging would require
   an extra lookup pass _just for dedup_, and it would still miss
   scene-analysis runs that never created a durable job row.
2. The existing `/api/scene-analysis` route does NOT create an
   EnrichmentJob, so the table doesn't reflect "is a scene-
   analysis pipeline running for this video right now?" anyway.
   Querying it would miss the most recent in-flight signal.
3. The realistic threat model is **operator double-click within
   seconds**, not multi-instance concurrency. Each Next.js instance
   keeps its own map; on a multi-instance deploy a double-fire
   produces two pipeline runs that both write the same S3 key —
   wasteful but not corrupting (S3 PUT is overwrite).

Original PR2 decision: a process-local `Map<string /* `${kind}:${assetId}` */,
{ managerJobId, expiresAt }>` with a 5-minute TTL inside
`apps/manager/src/lib/admin-trigger-route.ts`. Pruned lazily on each
request. Slot released as soon as the per-id dispatch resolved
(success or failure) so a follow-up trigger after pipeline
completion did not have to wait out the TTL.

**2026-05-19 hardening:** production transcript triggers showed that
the original immediate dispatch shape could stampede Mux. Admin
accepted 288 transcript items as `STARTED`, but manager only produced
a subset of transcript/embedding artifacts before Railway logs showed
repeated Mux `429 Too many requests` errors. PR #981 changed the
receiver from "one `after()` dispatch per accepted item" to a bounded
process-local queue shared by transcript and scene-analysis triggers:

- accepted jobs log `admin-trigger.dispatch.accepted`, then enter
  `dispatchQueue`
- at most `DEFAULT_DISPATCH_CONCURRENCY` jobs run per manager process
- total active + queued work is capped by
  `DEFAULT_MAX_PENDING_DISPATCHES`
- queue-full returns a retryable `503` before accepting new work
- queued/running in-flight entries use `expiresAt: null`, so the old
  5-minute TTL cannot prune a long Mux transcript job and admit a
  duplicate
- the request's scheduled `after()` work awaits the queued jobs it
  accepted through settlement instead of enqueueing detached promises

Capacity checks happen **after** lookup, validation, and idempotency
classification. A full queue must not turn `VALIDATION_FAILED`,
`NOT_FOUND`, or `ALREADY_IN_FLIGHT` rows into a whole-request 503;
only genuinely new dispatchable jobs spend queue capacity.

This remains process-local. `started` means "accepted by this manager
process", not durable acceptance. Until durable manager-owned job
state exists (roadmap `feat-127`), the only reliable completion signal
for operators is artifact presence in manager S3.

If concurrency-correctness becomes load-bearing in production,
swap to a DB-backed mechanism via a follow-up ticket. The shape
behind `processAdminTriggerRequest` doesn't change.

## Why a new transcript-only pipeline (deviation from plan §Unit 7)

Plan §Unit 7 left "extract from `videoEnrichment.ts` vs new parallel
file" as deferred-to-implementation. PR2's hard decoupling
constraint forbids modifying `videoEnrichment.ts`, so the new
`apps/manager/src/workflows/transcriptOnlyPipeline.ts` _composes_
the existing `transcribe(...)` and `generateEmbeddings(...)`
services without touching the enrich path. The contract is "produce
the right `{assetId}/embeddings.json` artifact"; everything else
(EnrichmentJob lifecycle, retry context, auth headers) belongs to
the enrich path and is out of scope for the trigger endpoint.

The composition itself is two lines:

```ts
const transcription = await transcribe(assetId, muxAssetId, language)
const embeddings = await generateEmbeddings(assetId, {
  text: transcription.text,
  segments: transcription.segments,
  language: transcription.language,
})
```

`transcribe()` writes `{assetId}/transcript.json` + `subtitles.vtt`.
`generateEmbeddings()` writes `{assetId}/embeddings.json` (with
per-chunk vectors — admin's R2 backfill reads them verbatim).

## 2026-05-19 resilience: subtitle URL is optional, mux + language are required

Production full-catalog reruns showed three distinct failure classes:

- scene-analysis triggers returned `VALIDATION_FAILED` when
  `subtitleUrl` was missing, even when the row had a primary-language
  mux asset that could produce subtitles
- transcript jobs could start but then time out waiting for
  Mux-generated subtitle tracks
- admin scene embedding backfill targets failed on transient
  OpenRouter responses or Prisma transaction/connection errors

The corrected contract is:

> `subtitleUrl` is a fast path. `muxAssetId` plus
> `primaryLanguageBcp47` are the required dispatch substrate.

Manager still rejects rows missing mux or primary language because it
cannot fetch playback/stills or make a language-specific transcription
request without them. But a missing subtitle URL no longer blocks
dispatch. The shared route now sends `subtitleUrl: video.subtitleUrl
?? ""` and validates only the required fields:

```ts
if (video.muxAssetId == null || video.primaryLanguageBcp47 == null) {
  // validation_failed; message names primary language / mux variant
}
```

Both admin-trigger routes pass the optional subtitle and language into
their pipelines:

- `apps/manager/src/app/api/admin-trigger/transcript/route.ts`
- `apps/manager/src/app/api/admin-trigger/scene-analysis/route.ts`

The transcript-only pipeline uses an admin-selected subtitle URL when
one exists, otherwise falls back to Mux:

```ts
const transcription = input.subtitleUrl
  ? await transcribeSubtitleUrl(input.assetId, input.subtitleUrl, language)
  : await transcribe(input.assetId, input.muxAssetId, language)
```

The scene-analysis pipeline follows the same shape. It fetches
existing subtitle text when admin provides a URL, otherwise calls the
same Mux transcription path to obtain transcript text before chapter
and scene generation.

### Guard the subtitle fast path exactly like scene-analysis

The direct subtitle URL path must not be a looser server-side fetch
surface than the original scene-analysis subtitle fetch. Use the
shared `fetchSubtitleVttContent()` helper from
`apps/manager/src/services/subtitles.ts` so every subtitle consumer
gets the same protections:

- HTTPS only
- trusted `*.jesusfilm.org` hostnames only
- bounded fetch timeout
- `content-length` and post-read body-size caps

`transcribeSubtitleUrl()` should parse and write artifacts from the
guarded VTT content, not call `fetch()` directly.

### Mux subtitle selection must be language-strict

When a concrete language is requested, a ready subtitle track in a
different language is worse than no ready track. The scorer used to
prefer any generated VOD subtitle strongly enough that a ready `en`
track could beat a requested `ru` track still in `preparing`. That
silently produces wrong-language transcript and scene artifacts.

The picker now normalizes language roots and filters concrete-language
requests to matching tracks (plus Mux `auto`). If the requested
language is still preparing, manager waits and eventually throws a
typed `MuxSubtitleReadinessTimeoutError` instead of accepting a wrong
language.

Regression tests should include both:

- ready wrong-language track + preparing requested-language track
- requested-language track becoming ready on a later poll

### Retry only the transient embedding seams

Admin scene embedding has two narrow retry points:

1. the provider batch call before any DB write
2. the Prisma transaction that writes idempotent scene/locale rows

`EmbeddingsBatchError("request_failed")` now carries an optional HTTP
status. Retry only:

- transport failures with no status
- timeouts
- malformed provider responses treated as transient validation failures
- HTTP `429` and `5xx`

Do **not** retry `400`, `401`, `403`, length mismatch, dimension
mismatch, empty descriptions, duplicate scene indexes, or invalid
artifacts. Those are contract/data failures that should fail one
target loudly.

Prisma transaction retry is similarly narrow: retry `P1017` and
`P2028` around the transaction only. That is safe because the write
body is idempotent: parent rows use conflict-safe insert, locale rows
use upsert semantics, and pruning is scoped to the current
`(editionId, locale)`.

This pattern keeps full-catalog runs moving without hiding real
catalog or artifact defects.

## Inverted cross-app auth (asymmetric on purpose)

| Direction                  | Caller env                                 | Receiver env                             |
| -------------------------- | ------------------------------------------ | ---------------------------------------- |
| manager → admin (existing) | `ADMIN_EMBED_TRIGGER_API_KEY` (single key) | `WORKFLOW_API_KEYS` (CSV allowlist)      |
| admin → manager (PR2)      | `MANAGER_TRIGGER_API_KEY` (single key)     | `ADMIN_TRIGGER_API_KEYS` (CSV allowlist) |

The asymmetry is deliberate: **the receiver always holds the CSV**
so rotation is "stage the new key alongside the old, deploy the
caller, drop the old, deploy the receiver" — zero-downtime in both
directions. Both receivers do timing-safe compare across same-length
entries (full allowlist iteration without short-circuit so timing
doesn't reveal which slot matched). Both clients return a typed
discriminated envelope (`config_missing | network_error |
parse_error | graphql_error | auth_failed | remote_4xx |
remote_5xx`) so callers branch cleanly on transport vs upstream
reasons.

## Railway deploy-ordering invariant

This is the load-bearing operational rule for first-deploy and key
rotation:

> **Deploy the receiver-side env var FIRST.** Then the caller-side.

Concretely:

1. Set `ADMIN_TRIGGER_API_KEYS` on the `forge-manager` Railway
   service.
2. `mcp__railway__updateServiceTool` stages the patch — flush with
   `mcp__railway__accept-deploy(envId)`. (Per
   `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.)
3. Verify with curl: `curl -H "Authorization: Bearer wrong" -X POST
${MANAGER_URL}/api/admin-trigger/scene-analysis` → expect 401.
   Without the env, the response is 503 (`config_missing`); with
   the env loaded but a wrong bearer it's 401. The shift from 503
   → 401 is the proof the keyring loaded.
4. Set `MANAGER_TRIGGER_API_KEY` (one of manager's CSV entries) +
   `MANAGER_API_BASE_URL` on the `forge-admin` Railway service.
5. `accept-deploy(envId)` on admin.
6. Verify via admin GraphQL with a valid bearer → expect a 200 with
   per-id outcomes (likely NOT_FOUND for an unknown assetId, but
   that's the contract proof).

Reverse order produces a dead minute: admin's first call 401s
because manager doesn't yet recognise the new key.

## Operator workflow

Two steps, deliberately separated so the operator decides whether
to backfill:

```bash
# 1. Run the embed backfill (PR1) — writes a report including
#    `missingArtifacts` to the path you nominate.
pnpm --filter @forge/admin run-embeds \
  --pipeline=both \
  --core-id=2_0-Crushing \
  --report-out=.tmp/embeds.json

# 2. Operator inspects .tmp/embeds.json — decides "yes, backfill
#    the transcript artifacts manager doesn't have yet".
pnpm --filter @forge/admin trigger-enrichment \
  --from-report=.tmp/embeds.json \
  --kind=transcript
```

The CLI prints one JSON line per outcome plus a summary line. Exits
non-zero if any outcome is `NOT_FOUND | VALIDATION_FAILED |
DISPATCH_FAILED` so CI / scripts can branch.

## Producer-consumer pattern (PR1 + PR2)

PR1's `--report-out=<path>` (producer) + PR2's `--from-report=<path>`
(consumer) form a stable producer-consumer convention:

- **File format is the contract** between two stacked PRs that may
  ship weeks apart and run in different environments.
- **Producer** projects a typed list (`missingArtifacts: [{
assetId, coreId, kind }]`) deduped by stable identity.
- **Consumer** reads the list, filters by the discriminator
  (`--kind`), dedupes again at boundary, exits non-zero on any
  failure outcome.

This shape generalises beyond feat-119; the producer-consumer half
is a documented pattern for "stack a follow-up CLI on a previous
report's output" elsewhere in the monorepo. The dedup-on-both-sides
discipline is the load-bearing piece — neither half can rely on the
other for stability.

## Tests must throw real typed shapes

PR1's compounded META rule
(`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`)
applies here too. The outbound client's network-error branch tests
must throw the _real_ `Object.assign(new Error("aborted"), { name:
"AbortError" })` shape, NOT a generic `new Error("aborted")` — the
helper checks `error.name === "TimeoutError" | "AbortError"` and a
generic Error skips that branch entirely. The test file
`apps/admin/src/services/manager-trigger.service.test.ts` carries
this discipline; reviewers should reject any new test that loses it.

## Files

- `apps/admin/src/auth/permissions.ts` — adds
  `write:manager-enrichment-trigger`; both editorial matrix +
  WORKFLOW_TRIGGER allowlist.
- `apps/admin/src/config/env.ts` — `MANAGER_API_BASE_URL` +
  `MANAGER_TRIGGER_API_KEY`.
- `apps/admin/src/services/manager-trigger.service.ts` — outbound
  HTTPS client.
- `apps/admin/src/graphql/mutations/manager-enrichment.ts` —
  `triggerManagerEnrichment` mutation (registered in `schema.ts`).
- `apps/admin/src/scripts/trigger-enrichment.ts` — operator CLI.
- `apps/manager/src/config/env.ts` — `ADMIN_TRIGGER_API_KEYS`.
- `apps/manager/src/lib/admin-trigger-auth.ts` — receiver-side
  bearer validator.
- `apps/manager/src/lib/admin-trigger-route.ts` — shared route
  helper (admin metadata lookup, idempotency map, dispatch).
- `apps/manager/src/workflows/transcriptOnlyPipeline.ts` — new
  composition pipeline.
- `apps/manager/src/app/api/admin-trigger/{scene-analysis,transcript}/route.ts` — POST handlers.
