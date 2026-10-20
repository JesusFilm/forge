# Studio bounded frame streaming (feat-722)

The full source path now succeeds, but the SDK's memory heuristic disables
parallel frame encoding in the fixed 2GiB worker. Actual JPEG accumulation is
145,998,045 bytes for only 1215 of 8856 frames, in addition to remuxed sources
and browser memory. Reproduce the installed SDK decision under a 2GiB fixture.

Opt in before SDK import through a trusted worker-only flag paired with the
single-thread codec policy. Keep the upstream heuristic unchanged for other
consumers. Stream each screenshot to the existing pre-stitcher and await its
write callback before admitting another frame; this prevents an unbounded Node
write queue when encoding is slower than screenshots. Test real installed CJS
and ESM decision parity and the actual frame callback with delayed/error writes.

Regenerate the existing pnpm patch identity, run affected worker/consumer checks,
and review standards/spec separately. Merge normally, publish an immutable main
worker candidate and select/activate through the trusted operator workflow after
draining. Measure full revision-21 execution and retained codec proof. Do not
claim the current 1200s profile is adequate until a full project succeeds.

Observed native throughput is approximately 3.1fps (1602 frames in 512.6s), far
below the unrelated synthetic benchmark. Version the cumulative time contract
as v3: 3600000ms job, 3620000ms request, 3900000ms lease; preserve exact v1 and
v2 descriptors for history, settlement and explicit release rollback. New work
uses only v3. Keep preparation180000ms and all physical resource caps. Extend
snapshot-bound retention in migration0156. Native/VM/operator maximums change
in the same release; no consumed assignment receives a fresh deadline.

The previous fresh verification is cancelled through normal expected-revision
render cancellation once the staging/throughput evidence is captured. Confirm
physical retirement before selecting another release. This is not a successful
full render or a codec result. Final acceptance still requires all 8856 frames.

The observed ownership timeout is addressed in feat-721 by routing authenticated
render-worker RPCs through a separate two-connection PrismaPg workload pool with
a five-second acquisition bound. Preserve the existing canonical operations and
all authority checks. Reuse its singleton across module graphs and verify both
route selection and a real canonical render read while all ten main connections
are held. Do not cache ownership or continue execution on an unconfirmed read.
