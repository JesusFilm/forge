# Profile vector sharing activation

`RECOMMENDATION_PROFILE_VECTOR_SHARING=true` makes new profile interests refer to
an immutable, full-precision content vector by digest. It does not rewrite old
inline interests or change profile weights, membership, lineage, generation,
expiry, or erasure. The content-only snapshot carries no profile identifier.
Both shapes remain readable through the mixed reader added with migration
`0116`.

This default change is an ordinary PR-to-main release step. Before deploying
it, verify that `0116` is applied and every serving replica and rollback image
contains the mixed profile reader. Run both CI-selected native suites with the
writer gate explicitly `false` and `true`. The profile-projection suite proves
the actual writer gate and byte-exact vector storage. The candidate suite
manually installs shared interests in a disposable fixture, then uses the real
profile reader and delivery persistence with a test-controlled retrieval
dependency to prove shared nomination through a packed served request, legacy
and packed snapshot, Admin detail and shadow reader parity, request expiry,
profile erasure and orphan cleanup. Keep `RECOMMENDATION_SERVED_ITEM_FORMAT`
independently gated; this change does not activate packed served writes.

An explicit `false` in Railway overrides this code default. For the release,
check active service variables and record the **effective** sharing value and
deployed revision on each HTTP and worker process, including any explicit
override. Do not claim activation from `.env.example` or the source default
alone. Confirm new published interest shape with aggregate counts after the
release; a missing runtime readout or unexpected inline writes blocks an
activation claim.

For production observation, use aggregate-only counts of inline/shared
interests, distinct snapshot digests and referenced/orphan snapshot rows by
day, plus bounded content-medoid byte comparisons. Do not export profile IDs,
token digests, vectors, or per-profile rows. Compare candidate nomination and
delivery latency with the existing 1.5-second retrieval deadline and watch
retention's `profileVectorSweepSkipped` signal. The bounded reuse samples and
local storage measurements in
[`docs/validation/recommendation-storage-20260930/profile-vector-sharing.md`](../validation/recommendation-storage-20260930/profile-vector-sharing.md)
are sensitivity evidence, not a production savings forecast.

To stop new shared writes, set `RECOMMENDATION_PROFILE_VECTOR_SHARING=false`
and redeploy through the normal flow. Existing shared interests continue to
read through their referenced snapshots until expiry or erasure. The rollback
image must retain migration `0116`, the snapshot table, and mixed readers;
do not roll back to an image that only reads inline vectors. Normal bounded
retention deletes orphan snapshots after 24 hours. Do not drop the snapshot
table while any interest still references it.
