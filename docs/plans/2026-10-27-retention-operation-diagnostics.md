# Retention decision operation diagnostics

## Evidence and scope

The October 27 r2932-w01 failure is real and remains FAILED. Its 100 committed
roots join the first pass's 100, making 1,750 known manual roots and five failed
partial attempts; the historical 301 remain separate. Manual work earns no
ordinary daily-cycle credit. Current read-only SELECT took 7.43 ms; the guarded
UPDATE predicate as SELECT took 46.031 ms. The UPDATE plan is indexed. Six local
actual-helper/UPDATE trials took 18–28 ms. None identifies the original stall.

## Design

Create one decision-operation observation only when the phase executes. Record
allowlisted SELECT/UPDATE boundaries, elapsed times and bounded page counts.
Collect start/end heap used and heap limit from that executing Node process,
process CPU delta, event-loop utilization and observed loop delay over the same
operation. Mark all runtime observations as process-wide; GC remains unknown.
An empty histogram is unavailable, not proof of zero pause. No PID or business
identifier is needed. Explicit code-owned entry-point context distinguishes the
manual CLI, scheduler job, other worker job and unspecified direct calls.

Dispose the histogram on success and failure, including telemetry failures.
Observation methods cannot throw into the cleanup path. Keep the phase's existing
operation timing and all transaction/admission/ledger semantics. Retain the
operation result through a later failure in the same invocation; emit only under
the existing failure log limiter. Version the extended envelope and accept old
version-one records with the same strict privacy and 8 KiB parser bound.

## Verification and limits

Test both failure boundaries with original error identity and rollback counters,
correct entry-point propagation, no-row/success disposal, actual local delayed
execution and monotonic measurements, telemetry exceptions, strict parser limits
and hostile fields. Run existing native current-reference/expiry tests unchanged.
No threshold, timeout, selector, production instrumentation toggle or cleanup is
part of this patch. This closes an attribution gap; production cause and CPU
improvement remain unproved until separately authorized observation after review.
