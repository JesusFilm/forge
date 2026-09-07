# Same-release scheduled preparation and final publication

Local evidence against full460 base `4109b02c31242f1b0ca8c4975b6fada0eb2f3d87`. This is unreviewed full460 implementation evidence, not a separately released dependency.

The actual Admin adapter called authenticated Manager HTTP preparation, which checked canonical eligibility before and after observing the existing signed loopback provider asset. The exact approved project/revision/approval/render/release binding stayed unchanged; preparation returned fresh readiness. An actual browser had reviewed and interactively approved the output first. The harness fsynced the returned envelope before calling the final catalog publication wrapper as SYSTEM. Publication returned ACCEPTED and consumed the fixture authorization once. After actual Manager UI unpublish, an exact retained-envelope retry returned the original accepted receipt, consumed zero times, and left the project UNPUBLISHED.

Calendar storage and consumption are explicit local fixtures, not feat-461 acceptance. Provider observation used a loopback signed Mux protocol fixture, not an actual Mux call or paid-provider acceptance. The harness imports owned runtime paths and cannot be run without its isolated fixture configuration. No credentials are retained here.

## Stable integration contract

- Portable `studioApprovedReleaseSchema` binds projectId, expectedRevision, approvalId, renderAttemptId, releaseId. Human authorization excludes readinessId.
- `studioScheduledPublicationPreparationSchema` adds the exact idempotency and schedule envelope. Admin `prepareScheduledStudioPublication(raw, signal?)` calls Manager POST `/api/admin-trigger/studio-publication` using the existing trigger credential. It cannot publish, approve or create a provider asset. Errors use `StudioPublicationPreparationError` with `submission: "not-submitted"`.
- Calendar persists the complete returned envelope before submission. Stored or potentially submitted envelopes skip preparation and go directly to `publishPreparedStudioProject(db, servicePrincipal, exactEnvelope, consume)`. The wrapper always injects the same final catalog verifier as manual publication.
- The hook runs after the project lock and checks current membership, prior authorization, slot version/cancellation and a fresh due/window time after its own lock. No interactive authority is synthesized.
- `StudioPublicationVerifier` returns `Promise<void | (() => void)>`. The real catalog verifier returns a synchronous freshness assertion, invoked after latch and receipt writes and immediately before returning from the transaction callback. Void fixture verifiers remain compatible; they do not establish real readiness.

## Lock-wait expiry regression

The failure-first two-connection test held a membership lock until readiness expired; the old path accepted. The corrected path reads current eligibility and readiness after waits. A second actual database test delays receipt insertion past proof expiry: the final synchronous predicate rejects and rolls back both publication and fixture hook writes. This bounds the final application decision; it does not claim a commit-instant guarantee. Full catalog/resolver suite: 10 passed. Admin and Manager typechecks passed; the later parse-error carrier placement still requires the final typecheck. Manager production build5 passed outside this evidence directory.
