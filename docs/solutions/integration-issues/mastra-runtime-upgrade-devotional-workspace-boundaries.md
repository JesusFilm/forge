---
title: "Mastra runtime upgrades require revalidating Devotional Workspace boundaries"
date: "2026-07-31"
last_updated: "2026-08-01"
category: "integration-issues"
module: "apps/mastra"
problem_type: "integration_issue"
component: "development_workflow"
symptoms:
  - "The Devotional Workspace branch diverged from the coordinated Mastra runtime dependency update and required integration hardening after the merge."
  - "Direct AWS SDK and PostgreSQL dependencies no longer matched the provider versions selected by the upgraded Mastra adapters."
  - "Programmatic workflow launchers assembled durable input without parsing it through the workflow's runtime schema."
  - "Railway S3 filesystem and digest operations lacked one shared, finite timeout and retry contract."
  - "The initial cutover design also gave Shorts Worker permanent Devotional Workspace S3 credentials instead of a bounded media-execution capability."
root_cause: "incomplete_setup"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "pnpm-lock.yaml"
  - "Devotional Workspace"
  - "video-first devotional workflow"
  - "Railway S3"
tags:
  - "mastra"
  - "workspace"
  - "dependency-upgrade"
  - "workflow-schema"
  - "railway-s3"
  - "source-integrity"
  - "retry-budgets"
  - "studio-validation"
---

# Mastra Runtime Upgrades Require Revalidating Devotional Workspace Boundaries

## Problem

The Devotional Workspace data plane was implemented against an earlier Mastra
runtime while `main` independently upgraded the coordinated Mastra package
family. Merging the runtime update preserved compilation, but compilation was
not enough to prove that workflow launch contracts, direct storage-provider
dependencies, suspended-run integrity, and S3 failure behavior still composed
safely.

This was an integration defect in the feature branch, not a change to the
ownership model. Workspace files remain devotional content authority,
PostgreSQL remains workflow and attempt state, and Shorts Worker remains the
automated media-byte executor.

## Symptoms

- `@mastra/core` and `@mastra/pg` moved to their upgraded versions while the
  app still declared a broad `@aws-sdk/client-s3` range and an older direct
  `pg` version.
- `VideoFirstRun.startAsync` accepted `Record<string, unknown>`, so routes and
  tests could construct durable input independently of the workflow's Zod
  schema.
- Workspace file operations used the client owned by `S3Filesystem`, while
  digest verification created a separate `S3Client`. The two paths could
  therefore diverge in timeout, retry, connection, or credential behavior.
- Tests covered source verification generally, but did not prove the exact
  case where an authenticated editor changes a selected Workspace source while
  the workflow is suspended for approval.
- No transport-level test proved that a connected but non-responsive S3
  endpoint would fail inside the inventory and reconciliation budget.

The gaps were found during PR integration review. There was no confirmed
production incident.

## What Didn't Work

- Treating a green standalone dependency-update PR as proof for the composed
  feature branch. Install, typecheck, and build success do not exercise the
  feature's provider graph, durable input boundary, suspension behavior, or
  stalled network I/O.
- Leaving direct provider dependencies broad or older than the versions used
  by pinned Mastra adapters. The lockfile can remain installable while direct
  application imports and adapter internals resolve through avoidable duplicate
  provider families.
- Typing an external launcher as `Record<string, unknown>` while keeping the
  real input schema inside the workflow module. Structural typing does not
  perform runtime validation and lets launch sites drift silently.
- Creating a second S3 client for integrity reads. Operations against the same
  bucket then have different operational budgets and duplicate connection and
  retry machinery.
- Assuming a generic verification test covers a human-approval suspension.
  Source files remain editable while a run is suspended, so mutation between
  suspension and resume is a first-class state transition.
- Giving Shorts Worker the Devotional Workspace bucket credentials because it
  renders the bytes. Execution responsibility does not imply storage authority;
  this widened the credential blast radius and duplicated Workspace ownership.
- Minting a new temporary upload key when reattaching to an active Worker job.
  The Worker deduplicates by stable output identity and input hash, so the
  reattached caller must refresh capabilities for the same keys the active job
  is already writing.
- An earlier investigation found that the expected local `devo/corpus` files
  were gitignored and absent, and that Forge had no remote Workspace provider.
  Proxying large MP4 bytes through Mastra merely to write them into Workspace
  was rejected because it violated the media-execution boundary. These findings
  established the architecture later hardened here; they are not evidence that
  the integration repair was already implemented. (session history)

## Solution

### 1. Export and enforce one workflow input schema

Move the durable input contract into an import-safe module and use the same
schema at workflow definition and every programmatic launch boundary:

```ts
export const VideoFirstDevotionalWorkflowInputSchema = z
  .object({
    chapterIndex: z.number().int().positive().optional(),
    sequence: z.number().int().nonnegative().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    workspaceGeneration: z.number().int().positive(),
    attemptId: z.string().min(1),
    selectedSources: z.array(DevotionalSourceRefSchema).min(1).max(500),
  })
  .strict()
```

The route now parses immediately before starting the run:

```ts
const workflowInput = VideoFirstDevotionalWorkflowInputSchema.parse({
  chapterIndex: input.workflowInput.chapterIndex,
  sequence: input.workflowInput.sequence,
  date: input.workflowInput.date,
  attemptId: attempt.id,
  workspaceGeneration: attempt.catalogGeneration,
  selectedSources: attempt.selectedSources,
})

await run.startAsync({ inputData: workflowInput })
```

Workflow tests parse their launch fixtures through the same schema. A test can
no longer prove behavior with an input shape that production launchers would
reject.

### 2. Align direct provider dependencies with the adapter graph

Pin direct provider packages to the versions selected by the upgraded Mastra
adapters, then regenerate the lockfile rather than editing it manually:

```json
{
  "@aws-sdk/client-s3": "3.1100.0",
  "@mastra/pg": "1.18.1",
  "@mastra/s3": "0.6.0",
  "@smithy/node-http-handler": "4.9.13",
  "@smithy/util-retry": "4.3.1",
  "pg": "8.22.0"
}
```

Version alignment was necessary but not sufficient; the launcher, integrity,
and transport contracts still required executable fixes and tests.

### 3. Share one bounded S3 client

Create `S3Filesystem`, take its client, apply an application-owned transport
budget, and reuse that client for digest reads:

```ts
const client = filesystem.client

client.config.requestHandler = new NodeHttpHandler({
  connectionTimeout: 5_000,
  requestTimeout: 10_000,
  socketTimeout: 10_000,
  throwOnRequestTimeout: true,
})
client.config.maxAttempts = async () => 2
client.config.retryStrategy = async () =>
  new StandardRetryStrategy({ maxAttempts: 2 })

return {
  filesystem,
  digestReader: createS3DigestReader(storage, client),
}
```

The finite defaults fit below the reconciliation budget. The test seam accepts
shorter limits so failure behavior can be proven without changing production
configuration.

### 4. Test the focused failure paths

Focused regressions pin the behavior at each layer:

- A TCP server accepts an S3 connection and never responds. With 100 ms limits
  and `maxAttempts: 1`, `filesystem.init()` must reject and the server must see
  exactly one connection.
- A workflow test suspends a devotional run for approval, injects a selected
  source verification failure on resume, and asserts failed status, reservation
  release, and no publish call.
- A separate authored-data test changes the bytes after selection and proves
  the digest mismatch is rejected as `source-changed`.

The second test preserves the fail-closed rule while avoiding a leaked clip
reservation when no external publication request was attempted.

### 5. Validate the composed surface

The completed integration validation covered:

- the full Mastra test suite: 156 files passed, 1 skipped; 1,554 tests passed,
  3 skipped;
- Mastra typecheck, lint, formatting, and `mastra build --studio`;
- a local `mastra dev` smoke with memory storage, including HTTP 200 responses
  from `/studio/workspaces` and `/api/workspaces`;
- API registration of `devotional-workspace` / `Devotional Workspace` with a
  filesystem and BM25 search;
- fresh GitHub checks for PR #1796, including CodeQL, formatting, commit lint,
  patched-dependency guard, affected checks, and schema drift.
- the signed-capability correction suites: 1,569 Mastra tests, 171 Shorts
  Worker tests, 66 composition tests, and 3 dedicated Workspace-contract tests;
  plus typecheck and lint for all four packages and production builds for
  Mastra Studio and Shorts Worker.

### 6. Keep Workspace credentials in Mastra

The Devotional Workspace owner now writes input artifacts and manifests,
creates short-lived signed GET/PUT capabilities, and finalizes Worker uploads.
Shorts Worker receives only the exact capabilities needed for one attempt:

```ts
const uploadId = inputHash
const workspaceTransfer = devotionalWorkspaceTransferSchema.parse({
  schemaVersion: "1",
  attempt,
  manifest: await store.createReadGrant(manifestRef),
  inputs: inputReadGrants,
  outputs: await createAttemptUploadGrants(uploadId),
})
```

The pure-Zod artifact, manifest, and capability schemas live in the neutral
`@forge/devotional-workspace` package. Mastra and Worker share that versioned
data-plane contract without making either app depend on the other or placing
Workspace ownership inside the rendering-composition package.

The Worker has no `DEVOTIONAL_WORKSPACE_S3_*` or Workspace-prefix credentials.
In production it accepts a capability only when every URL uses HTTPS, has the
configured exact storage origin, targets its declared attempt-scoped key, and
expires inside the bounded transfer window. Redirects are disabled.

### 7. Verify before promoting or serving output

The Worker streams each completed MP4 to its signed temporary PUT while hashing
the bytes. Mastra then verifies the claimed size and SHA-256 from Workspace,
moves the object to its content-addressed canonical key, and writes the output
manifest. The manifest persists the verified object ETag. Later checks use that
ETag, and Range playback binds both the signed GET and upstream request to it
with `If-Match`, preventing a different object version from being served after
verification.

A retry first reads the canonical output manifest and reuses it only when it
contains exactly the expected portrait and wide MP4s, both belong to the same
attempt, and both still pass Workspace integrity checks. Active-job reattachment
uses the stable input hash as its temporary upload identity so refreshed signed
URLs target the same keys. Transient polling failures are retried without
cancelling a healthy render; terminal failure, confirmed cancellation, and
timeout paths clean temporary uploads.

## Why This Works

- One strict schema is both the runtime and TypeScript contract. Definition and
  invocation can no longer drift independently.
- Provider pins remove ambiguity between the packages imported directly by the
  app and those used by Mastra adapters.
- Filesystem operations and digest verification share endpoint, credentials,
  connections, timeouts, and retry policy because they share the same client.
- The blackhole test exercises successful TCP connection followed by silence,
  the failure mode most likely to evade mocked error responses.
- Digest checks at approval resume and pre-publish preserve one coherent source
  generation even though Studio editors can change Workspace files at any time.
- Temporary signed capabilities preserve the ownership boundary: Mastra remains
  the only service with durable Workspace authority while Shorts Worker can
  still execute large media transfers directly against storage.
- Content-addressed final keys plus SHA-256 verification establish byte
  identity; persisted ETags and `If-Match` bind later Range delivery to the
  exact storage version that passed verification.
- Stable upload identities and verified canonical output manifests make retries
  attachable without issuing permanent credentials or rerendering completed
  attempts.
- Layered validation distinguishes package correctness, Studio composition,
  and CI evidence from credentialed production release gates.

## Prevention

- Keep durable workflow schemas in standalone import-safe modules. Parse every
  route, script, test fixture, and internal launcher immediately before
  `startAsync`.
- Do not use `Record<string, unknown>` at a workflow invocation boundary when a
  concrete runtime schema exists.
- On storage or database adapter upgrades, inspect direct provider packages,
  align their versions deliberately, regenerate the lockfile, and check the
  resolved dependency graph.
- Reuse an adapter's client for application-owned reads against the same backend
  when those operations require the same credentials and failure budget.
- Give every external client used during reconciliation explicit connection,
  request, socket, and retry limits. Test a connected-blackhole endpoint, not
  only mocked status responses.
- For every suspendable workflow, mutate authoritative inputs between suspend
  and resume. Assert both cleanup and the downstream side effect that must not
  occur.
- Treat signed URLs as transient capabilities. Never persist or log their query
  strings, require an exact configured storage origin, validate the declared
  object key, reject redirects, and cap their lifetime.
- Keep temporary upload keys stable across active-job reattachment, and prove a
  completed retry verifies canonical outputs without calling the Worker again.
- Verify large output bytes once before canonical promotion, persist a storage
  version validator, and bind subsequent conditional or Range reads to it.
- Retry transient status-poll transport failures without cancelling the remote
  job. Reserve cancellation and upload cleanup for explicit aborts, timeouts,
  invalid terminal responses, and terminal job states.
- Treat green CI as proof only for the surfaces it exercised. Keep live Railway
  storage/database, restart recovery, migrations, backup/restore, and canary
  checks as explicit release evidence.

## Related Issues

- [PR #1796](https://github.com/JesusFilm/forge/pull/1796) contains the
  Devotional Workspace data plane and the Mastra upgrade integration repair.
- [Mastra eval workflow local-dev contracts](./mastra-eval-workflow-local-dev-contracts.md)
  shares the rule that a green build is not a real runtime or Studio proof, but
  covers a different workflow and failure boundary.
- [Optional Railway S3 with local tmp fallback](../platform/optional-railway-s3-local-fallback.md)
  documents the adjacent local-versus-Railway storage convention.
- [Dependabot pnpm transitive remediation](../security-issues/dependabot-pnpm-transitive-remediation-20260416.md)
  provides adjacent lockfile and dependency-graph discipline for security
  updates.
- [Devotional Workspace cutover runbook](../../runbooks/devotional-workspace-cutover.md)
  owns the unrun production migration, backup/restore, Railway S3/PostgreSQL,
  restart-recovery, and canary gates.
