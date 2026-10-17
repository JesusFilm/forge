# Studio source duration correction

Scope: prevent HLS descriptor admission from claiming catalog-only tail footage;
repair the failed project's current draft without rewriting revision 19 or its attempt.

1. Extract the broker's rendition selection and complete VOD segment parsing into
   runtime-neutral contracts; keep the broker's 128 selected segment limit.
2. At descriptor capture, fetch bounded master and chosen preview/export playlists,
   measure complete durations, floor the minimum with catalog duration, and reject
   requested ranges outside it. Preserve the original catalog digest for eligibility.
   New descriptor references ensure later project edits use the measured duration.
   Original-byte captures continue to use their existing MP4 path.
3. Regression-test the actual fractional-tail mismatch and shorter export/preview,
   invalid/live playlists, and source capture persistence/rejection.
4. Review standards and spec, release via PR/main, confirm deployment.
5. Re-read the production draft, capture a verified descriptor, replace matching
   source references, and trim the film endpoint/duration by one frame if required.
   Apply normal revision command as a service with an idempotency key. Validate all
   source ranges and preserve failed-attempt evidence. After both services deploy,
   verify one full render through the existing worker pool; no narration or other
   provider generation is needed.

Known boundary: historical immutable descriptors retain their original catalog
bounds. Repair uses new measured handles; old revisions remain historical evidence.
No network requests are added inside authoring transactions or frontend loading.

## Follow-up discovered during verification: feat-714

Live segment sizes show 273.10 MiB across 158 segment uses for the 17 clips,
although only 30 unique segment URLs are needed. The same render would hit the
aggregate download limit after the tail repair. Reuse canonical downloaded bytes
within one preparation, bounded by the existing 256 MiB total. Keep per-read
bounds, cancellation, origin validation and per-clip codec proofs. Test with a
small byte budget; verify the corrected project's unique transfer size before release.

The same reuse must continue in `studio-render-input.ts`, whose separate 128 MiB
limit otherwise counts repeated export reads/files. Cache reads by complete
immutable asset reference; package verified identical bytes once and point all
playlists/media at that file. Preserve proof/eligibility checks and per-read limits.

## Released correction

PR #2766 merged as `90442e9f07f15efe5c662d6c9077cb04227c8b63`; both Admin
and Manager production deployments are healthy. The normal source/authoring
services accepted the revision-20 repair as revision 21 with all 17 sources in
bounds, preserving the 8856-frame timeline and immutable history. See feat-713
and feat-714 for deployment IDs, source snapshot, repair receipt key and validation.

## Follow-up: preparation deadline (feat-715)

The full revision-21 check failed at 91 seconds before preparation committed.
A bounded diagnostic using the deployed broker reproduced abort at 90008 ms,
after 214 successful asset-upload grant calls; the 215th call was cancelled.
Repeated segments still requested grants and PUT their bytes despite idempotent
Admin registration. Cache only successfully validated references by the complete
validated registration payload for one broker instance, including digest, length,
filename, MIME type, role, dependencies and provenance. Check cancellation before
cache hits and never cache failures. Keep per-clip probe/decode/signature work and
the existing 90-second deadline unchanged. Propagate that deadline to source
materialization as well. Re-test registration isolation, distinct provenance,
dependencies, failed PUTs and cancellation, then release through PR/main and rerun
the full revision.

Registration reuse allowed source preparation to commit at 72.347 seconds,
but the full input path still exhausted the shared deadline. Extend feat-715
with preparation-local reuse of completed codec verification by actual ordered
byte digests, durations and expected height. Keep per-clip ranges and proofs.
Use content-derived playlist/manifest names to avoid distinct immutable versions
for identical bytes/metadata. Exercise the actual subprocess seam in tests and
measure source preparation plus packaging together in the production retry.
