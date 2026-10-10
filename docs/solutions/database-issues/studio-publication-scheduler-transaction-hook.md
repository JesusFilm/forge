---
module: Studio authoring
problem_type: integration_issue
tags: [studio, publication, scheduler, transactions, authorization]
date: 2026-09-08
---

# Internal manual and scheduled publication transaction

The calendar must consume prior human authorization in the same transaction as
publication. It must not create interactive authority, approve content, or make
provider calls. This dependency slice supplies the internal command and callback
contract. It does not enable a public publication endpoint or implement calendar
storage, catalog visibility, rendering, Mux readiness, or Watch revocation.

## Stable exports

`@forge/studio-contracts/publication` exports `studioPublishSchema`, `StudioPublish`,
`studioSchedulePublicationBindingSchema`, `StudioSchedulePublicationBinding`,
`studioPublicationFailureSchema`, and `StudioPublicationFailure`.

`apps/admin/src/services/studio-authoring/publication.ts` exports:

```ts
publishStudioProject(
  db: PrismaClient,
  user: Principal | null,
  raw: unknown,
  verify: StudioPublicationVerifier,
  scheduled?: StudioScheduledPublication,
): Promise<StudioCommandResult>
```

`scheduled-publication.ts` exports `StudioSchedulePublicationHook` and
`StudioScheduledPublication = { input, consume }`. The hook receives
`(tx: Prisma.TransactionClient, binding: StudioPublish & { schedule: ... }, now: Date)`
and returns `Promise<void>`. `now` comes from the server after acquiring the
project lock. It is an entry snapshot, not proof of current time after slot
locking; the hook must check fresh server time after acquiring its slot lock.
The command rechecks the window after hook/verifier waits and after receipt
persistence, immediately before returning the transaction callback. Expiry
rolls back all writes. This does not guarantee the database commit instant.
The verifier receives the same transaction and the project,
revision, document, render attempt, publication time and current restrictions.
The verifier is mandatory for both delivery modes. The preexisting internal
manual seam retains its legacy input compatibility; the final catalog adapter
must parse the complete `studioPublishSchema` for manual publication too.

The accepted result is `{ projectId, revision, outcome: "ACCEPTED" }`. Rejections
use `StudioCommandError` from `errors.ts`, with a concrete `code` including
`NOT_DUE`, `CANCELLED`, `STALE_BINDING`, `APPROVAL_REQUIRED`, `UNREADY`,
`ALREADY_CONSUMED`, `AUTHORIZATION_REVOKED`, or `DELIVERY_EXPIRED`.
The failure union is not throwable; use `new StudioCommandError(code)`.
`StudioPublicationRejected` marks command failures after receipt lookup and
before commit. Receipt hash conflicts and ambiguous database commit failures
must not be classified as confirmed non-commit.

## Authority and atomicity

Only trusted server code may supply the callback capability. Scheduled calls
require the existing `SYSTEM` or `MANAGER_BACKEND` service principal plus the
callback; interactive or delegated human attribution cannot schedule-publish.
A schedule in raw input without that capability fails closed. The complete
scheduled envelope is runtime-validated and must exactly match the server's
capability envelope. No new RPC, GraphQL or browser authority is added.

The command locks the project first and resolves its exact accepted receipt
before mutable checks or hook invocation. It validates current revision,
render-bound approval and current document/pack sources, checks the immutable UTC
delivery window, consumes the hook, then calls the required final verifier and
writes the permanent publication latch and receipt. Failure in the verifier
rolls consumption back. Retries reuse the exact accepted envelope, including
readiness ID, and return the original result after unpublish without consuming
again. New publication after first publication remains forbidden.

Calendar461 owns the slot schema and implementation: lock slot after project;
validate durable prior interactive authorization for exact schedule ID/version,
due/window/project/revision/approval/render/release; check current non-revoked
operator membership; serialize cancellation/reschedule on those same locks;
reject invalid or consumed deliveries. Creating a schedule must not lock an
editable draft. Delivery after the authorized window fails instead of moving due
time. Unready-at-due remains unpublished.

Prior human authorization does **not** freeze readiness ID. Full460 owns a
trusted execution-time resolver of fresh signed readiness and eligibility for
the same immutable release. The scheduler cannot author proofs or replace the
release. Once a publication envelope may have been submitted, retries must
retain it to resolve its receipt before preparing different evidence.

## Remaining full460 gates

The mandatory final catalog verifier must atomically revalidate current reviewer
membership, admitted codec/render evidence, latest signed Mux readiness, exact
release binding and public visibility. Actual contained rendering, durable
provider reconciliation, Watch playback and subsequent-request revocation,
performance and deployment acceptance remain required. An injected test verifier
or passing callback type is not evidence for those gates.

See `docs/validation/studio-460/publication-hook/README.md` for isolated-base proof.
