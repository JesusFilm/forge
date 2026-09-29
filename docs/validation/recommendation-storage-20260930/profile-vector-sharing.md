# Profile vector snapshot validation (local only)

The profile projection selects a medoid from content evidence and stores the
`public.avg(video_transcript_chunk.embedding)` vector on each profile interest.
Profile membership, source lineage, weight, expiry and generation identity remain
on the interest/generation rows. The new snapshot table stores only a content
vector and its SHA-256 digest of PostgreSQL's canonical `vector::text` value.
The writer compares `public.vector_send` byte strings before referring to a
snapshot, so a digest collision fails the projection transaction.

## Native PostgreSQL fixture

Disposable database `forge_storage_profiles` on loopback PostgreSQL, 1536
float32 dimensions, logged tables, baseline and shared shapes with the same
interest attributes and logical indexes. Measurements include full table,
index and TOAST relations. WAL is a global LSN delta captured in a quiet local
window; it is not an isolated per-table counter or a production estimate.

| Interest rows | Distinct vectors | Shape                     | Heap + indexes + TOAST |   Insert WAL |  Warm four-interest read |
| ------------: | ---------------: | ------------------------- | ---------------------: | -----------: | -----------------------: |
|         6,000 |              300 | Inline baseline           |           51,593,216 B | 43,075,400 B | 0.425 ms, 15 shared hits |
|         6,000 |              300 | Thin interest + snapshots |            4,923,392 B |  6,044,360 B | 0.479 ms, 20 shared hits |
|           111 |               33 | Inline baseline           |            1,081,344 B |    806,096 B | 0.335 ms, 15 shared hits |
|           111 |               33 | Thin interest + snapshots |              516,096 B |    313,568 B | 0.374 ms, 13 shared hits |

The 111/33 fixture is a sensitivity check matching a guarded 16-minute
production aggregate sample, **not** an estimate of global production savings.
The sample contained 111 interests in the latest 100 published generations,
33 distinct `embedding::text` hashes and a 6,148-byte average vector datum.
It did not scan the full retained profile population. Native fixtures show a
90.5% relation-size saving at 20 uses/vector and 52.3% at 3.36 uses/vector;
both preserved every vector byte according to `public.vector_send` equality.
The extra snapshot join added 0.054 ms and 0.039 ms to these warm single-query
plans, respectively. Loaded end-to-end candidate latency still requires a
release gate.

## Compatibility and retention

Migration `0116` is additive and does not rewrite retained interests. New
readers use `COALESCE(interest.embedding, snapshot.embedding)` and therefore
read old inline and new shared rows. The default-off
`RECOMMENDATION_PROFILE_VECTOR_SHARING` gate keeps writers inline until all
serving replicas and rollback images can read both shapes. A shape constraint
requires exactly one representation, and the foreign key prevents removal of
a referenced snapshot. The snapshot table contains no profile or person key.
Normal profile erasure still cascades through interests and contributions;
orphan content snapshots are removed by bounded retention after 24 hours.
Publishers take a shared transaction lock on the dedicated snapshot key before
locking profile rows, so independent profiles can publish concurrently. Only
the orphan sweep attempts its exclusive form; if busy, normal retention
continues and the sweep is retried in a later batch. The sweep is capped by
the retention batch size. Migration DDL uses a 2-second lock timeout and
10-second statement timeout, with a partial non-null reference index. A native
fixture with 2,001 preexisting inline rows confirmed unchanged heap bytes
after migration and completion within the statement budget.

The native migration test verifies mixed byte-exact reads, invalid shape
rejection, immutable snapshot rows, foreign-key protection, orphan deletion
after erasure, two concurrent shared publishers, and the writer/sweeper lock
ordering. The proof runs from the CI selected profile projection native test
file. The profile projection fixture passes with the writer gate both on and
off; the default-off CI selected profile pair passed 16/16 tests after this
change. Activation still requires a larger
read-only retained-population reuse histogram, candidate result parity under
loaded conditions, and query/write latency against the current service
budget. Check the migration ordinal against the integration branch. Rollback
is immediate by setting the writer gate to `false`; retain the new reader and
table until every shared interest has expired or been erased. Do not drop the
snapshot table while references exist.
