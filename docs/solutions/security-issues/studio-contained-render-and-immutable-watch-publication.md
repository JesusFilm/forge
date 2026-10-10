---
module: Studio rendering and Watch publication
problem_type: security_issue
tags:
  [studio, rendering, containment, leases, publication, mux, watch, revocation]
date: 2026-09-08
---

# Contained rendering and immutable Watch publication

This implementation separates render execution, retained output, signed provider readiness, hidden catalog staging, and publication. Local validation is extensive; actual provider and deployed-image acceptance remain open. Feat-460 stays in progress until those gates pass. See `docs/validation/studio-460/HANDOFF.md` and `apps/studio-render/IMAGE.md`.

## Execution and recovery

Manager enqueues canonical attempts and polls them; a private credential-free service executes one job at a time. The broker retains provider/storage/database credentials. Its public admission key is the executor's only key. Native guards enforce cumulative wall time independently of the Node event loop, bounded combined output, CPU affinity and complete namespace teardown. PID1 retires on uncertain supervisor cleanup; cancellation cannot downgrade fatal teardown.

The versioned production profile is 900 seconds for staging/render/verification/delivery, 10 seconds upload, one second native cleanup and two seconds PID1 retirement. Manager uses a 920-second private request and 1200-second durable lease, with 90 seconds preparation and 60 seconds retention (45 seconds output registration, 15 seconds terminal recording). Limits remain two CPUs, 2 GiB RAM, zero swap, 128 aggregate tasks, 96 child tasks, and 128 MiB input/output. The 60-second profile is a separate short proof, not a product duration limit.

The native startup record is sealed evidence combined with current kernel checks, not cryptographic launcher identity. The exact reviewed image/entrypoint is trusted configuration. Production admission still requires effective cgroup limits, including 128 tasks. The locally tested UID/NPROC candidate is not enabled as a fallback. Read-only Railway cgroups and user namespaces alone do not establish per-job containment.

A read-only mount of finite cgroup files is not proof of process membership. Local rootless runc placed the image process in an unbounded sibling while the first harness mounted its bounded launcher scope; both original runtime qualifications were withdrawn. Admission now requires cgroup2 membership for the actual Node PID in the reader's PID namespace and rejects nested cgroup-file overlays. Operators must also verify actual init/descendant membership and bounded ancestors externally. Build-driver limits likewise do not establish Dockerfile executor limits. See `docs/validation/studio-460/cgroup-admission/README.md` for the failure-first cases and corrected local placement.

The execution image's fresh job proc mount still fails under the preserved outer OCI masks. The current inner recipe does not independently replay all those masks; earlier unmasked native proof is not equivalent. A trusted bootstrap sequencing capability remains unproven on the intended platform. Railway pre-deploy commands run separately and are not that execution-namespace hook. No proc exposure change or replacement architecture has been implemented.

Admin locks the project before reading mutable attempt state and then the job. Finish checks fresh server time after waits: expired/losing results are retained without becoming current. Exact issued-lease producer registration attaches known partial assets before terminal recording, preserving recovery after lost responses. Browser metadata cannot manufacture those edges. A retained result does not imply successful finalization. Three lease generations bound automatic retries.

## Provider state and publication

Mux creation is a separate durable intent: pending, dispatching, ambiguous, processing, ready or failed. A lost create response never triggers another paid create automatically. Preserve unresolved intent and use verified exact asset attachment when its identity is known. Already-created assets can be observed after edit/unpublish, while new spending and staging remain ineligible. New-create pagination excludes obsolete revisions; processing uses bounded cursor progress and per-candidate failure isolation.

The output verifier independently checks retained hash, complete decode, codec, frame count, dimensions, duration and audio format. Signed Mux readiness binds the exact release/output/playback identity. Descriptors are not retained source bytes. Current source restrictions and approval membership are rechecked at publication, and no external call holds a database transaction.

Manual and scheduled publication use the same final catalog verifier and command. Scheduled preparation resolves fresh readiness for the exact prior human project/revision/approval/render/release binding. It cannot replace content or create approval. Calendar stores the full envelope before submission; uncertain retries reuse it and skip preparation. The project lock precedes the calendar slot lock. The real verifier supplies a final synchronous expiry predicate after waits/writes; this is not a nanosecond commit-time guarantee.

Publication atomically changes the permanent latch and canonical catalog visibility, including `no_index`. The narrow SQL exception admits only flags consistent with the canonical publication/revocation state. Immutable content, provenance, URLs and media remain frozen. Unpublish restores exclusion and permanently forbids correction, replacement or republish. Exact retry after unpublish returns its original receipt without consuming a slot again or restoring visibility.

## Public delivery and revocation

Watch admission rebuilds the canonical route manifest under the existing Core/experience serialization lock. Durable publication/revocation records drive invalidation outside the transaction, with phase-specific acknowledgements only after complete receipts. Partial tag or configured edge purge failures remain pending. A delayed publication refresh reads current state and cannot restore an unpublished route. PostgreSQL advisory-lock statements use `$executeRaw`; their `void` result cannot be decoded with Prisma `$queryRaw`.

The playback gateway checks canonical release access on every request, keeps signed Mux tokens server-side, rewrites HLS variants/renditions/segments/maps/keys and auxiliary resources to exact-release opaque URLs, and applies one bounded request lifetime across authorization, signing, fetch and recheck. All responses are private/no-store. Previously issued resource URLs are denied after unpublish, including stale Watch DOM requests. Already delivered bytes cannot be recalled.

Studio images bypass persistent Next optimization throughout Watch. Equivalent normalized route paths are refused at the optimizer, and optimizer redirects are disabled. Bounded live public Core image samples and built redirect tests preserve the documented compatibility evidence; samples are not exhaustive. Invalidation of historical Studio optimizer copies is conditional on such copies actually existing in the target environment, never a blanket unrelated production purge.
