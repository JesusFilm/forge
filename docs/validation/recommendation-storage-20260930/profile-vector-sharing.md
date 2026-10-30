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

A later read-only, day-stratified production aggregate sampled up to 50 latest
published generations per day over 29 days: 1,450 generations and 445
unexpired inline interests across 25 days. It found 127 distinct canonical
vector hashes; 396 interests used 78 vectors that appeared more than once,
with a maximum reuse count of 19 and a 6,148-byte average vector datum. The
8,001-row interest cap was not reached. This broader sample supports reuse
across days, but its bounded selection is not a retained-population census or
a precise global savings estimate.

## Candidate parity and local loaded latency

The deterministic native candidate fixture now stores two inline interests
with the gate off and two snapshot-backed interests with
`RECOMMENDATION_PROFILE_VECTOR_SHARING=true`. In each run, both vectors match
the content medoids byte-for-byte. The same retrieval and nomination
assertions run in both modes: four nominations in the fixed
`a, b, b, a` target order, source ranks `1, 2, 3, 4`, interest ordinals
`0, 1, 0, 1`, and hybrid target order `a, b`. Both modes passed 3/3 native
tests. This verifies the candidate read path actually joined snapshot vectors
when sharing was enabled.

The two modes were measured sequentially on the owned loopback PostgreSQL
instance. Each loaded sample was six simultaneous calls against the same
three-video, two-interest deterministic fixture. The existing retrieval
budget is 1,500 ms per call; every observed call completed within it.

| Path                      | Shape  | First/cold |  Warm | Loaded p50 | Loaded p95 |
| ------------------------- | ------ | ---------: | ----: | ---------: | ---------: |
| Live profile retrieval    | Inline |      80 ms | 16 ms |      65 ms |      76 ms |
| Live profile retrieval    | Shared |      82 ms | 19 ms |      70 ms |      90 ms |
| Profile-source nomination | Inline |      14 ms |     — |      16 ms |      32 ms |
| Profile-source nomination | Shared |      17 ms |     — |      22 ms |      25 ms |

These small local samples prove the fixture path stays inside the service
budget and preserves the expected candidates. They do not establish loaded
production capacity; the release gate still requires candidate parity and
latency on a representative retained population.

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

## Production-scale migration lock check

Two additional disposable local schemas each held 160,000 preexisting inline
interests with 1536-dimensional float32 vectors. Each interest table had a
62,423,040-byte main heap, 65,912,832 bytes of indexes, and 1,325,580,288
bytes of TOAST data (1,453,957,120 bytes total). The row count and main heap
exceed the September 30 production aggregate of 73,537 rows and 21,118,976
main-heap bytes; the partial index build scans the main heap, not the full
TOAST relation. This fixture retains the realistically toasted vector datum
and existing inline rows. No production DDL was run.

The actual `0116` migration SQL completed in 56.38 ms in the stronger second
run, including its transaction and partial index build, while separate
clients repeatedly read a real four-interest generation and wrote interests.
Polling `pg_locks` approximately every millisecond observed the migration's
`AccessExclusiveLock` for 43.57 ms. That observation is a sampled lower bound;
the whole transaction duration is an upper bound on the lock hold time. Reads
and writes had no errors:

| Concurrent operation | Baseline p50 | During DDL p50 | During DDL p95 | During DDL max |
| -------------------- | -----------: | -------------: | -------------: | -------------: |
| Four-interest read   |     1.263 ms |       1.126 ms |       1.603 ms |       42.75 ms |
| Interest write       |     2.050 ms |       2.012 ms |       2.794 ms |       44.58 ms |

One read and one write waited more than 10 ms during DDL. The first independent
160,000-row run also completed in 64.18 ms, with 48.86 ms of sampled exclusive
lock observation and no reader/writer errors. Both were far below the existing
2-second lock and 10-second statement limits, so this check did not justify
changing them. These are local single-host measurements, not a production
latency guarantee; migration scheduling should still use the normal release
gate and monitor lock waiters.

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
