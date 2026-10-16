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
   source ranges and preserve failed-attempt evidence. Do not dispatch paid render
   work solely to validate this repair.

Known boundary: historical immutable descriptors retain their original catalog
bounds. Repair uses new measured handles; old revisions remain historical evidence.
No network requests are added inside authoring transactions or frontend loading.
