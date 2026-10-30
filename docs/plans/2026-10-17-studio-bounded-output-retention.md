# Bounded Studio output retention

The full production render and independent codec proof succeed, but Cloudflare
rejects the 143MB base64 retention request with HTTP 413. Keep video quality and
the fixed 128MiB output cap. Send up to eight 16MiB parts instead, registering
them as private `archive` assets with exact producer provenance through existing
normal broker transfers. Admin reads those private immutable parts from storage,
checks their ordered provenance and complete output digest/proof, and registers
the final render, codec proof and manifest through the existing asset service.
The final Manager request remains metadata only. All transfers share the original
60s retention window, reserving 15s for terminal recording; retries never renew it.

Manager binds every part and finalization to its issued transport capability.
Part metadata includes whole output bytes/digest, zero-based index and count.
The worker-only Admin finalizer derives project/document/profile from the
canonical snapshot and checks each part's exact attempt/lease/input/profile and
index/count/output provenance before reading it. No client-controlled arbitrary
object key, generic storage capability or in-memory multi-request staging state.

Read-only canonical receipt recovery runs before local retention-window checks.
It may recover an existing exact execution and sign its committed record; it
cannot record a new execution, resume containers or extend a deadline. Retired
worker reconciliation must preserve the original output and journals until an
exact canonical receipt and any publication upload outcome are confirmed.

Verify the real captured full output against a bounded-edge harness, all binding
and corruption failures, cancellation/response-loss/deadline paths, full scoped
checks, fresh standards/spec review, then normal PR/main application deployment
and immutable worker release. The existing full output is canonically recovered
through normal Admin services while its original issued lease remains valid;
that operator recovery is explicit evidence, not automatic transport acceptance.

Deployment qualification reuses the captured, independently decoded 106,963,325
byte output. After normal application deployment and immutable worker selection,
transfer it through both actual production Cloudflare paths as private parts
bound to its existing issued assignment. Finalize a separate retained artifact,
verify its complete digest through normal Admin reads, and leave the already
committed canonical successful execution unchanged. This checks the changed
transport without repeating the unchanged 52-minute renderer or renewing an
execution lease. Keep the original worker journal and its expired local window
unchanged; this is explicit post-completion transport qualification.

Persist one absolute storage-transfer deadline alongside the original boot-bound
monotonic retention deadline. Every part, retry and broker grant carries that
same value. Admin caps grant expiry to it and derives the final assembly timeout
from matching immutable part provenance, so an edge that loses a disconnect
cannot prolong remote work past the original transfer allowance.
