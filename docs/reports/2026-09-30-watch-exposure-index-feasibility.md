# Watch exposure window index feasibility, September 30, 2026

## Decision

Defer replacing `watch_surface_exposure_window_item_idx`. A six-column
`(window_id, surface, block, presentation, placement, position)` index preserves
the tested exact and window read paths and is materially smaller, but an
ordinary PostgreSQL build did not finish inside a one-second write-blocking
budget on a fixture larger than twice production. A successful build took
2.06 seconds, longer than the current 1.5-second exposure write statement
budget. No Prisma model, migration, application query or production database
was changed by this unit.

## Production and fixture boundary

The root owner's September 30 read-only production catalog receipt counted
715,800 live rows (709,668 estimated), 184,819,712 bytes of main heap, and
148,512,768 bytes for the valid eight-column index. The index backs no
constraint and had 489,149 recorded scans and 513,411 tuples read. It is a
meaningful access path, not an unused index. The served partial unique index,
event identity, primary key, aggregate, cohort and expiry indexes are outside
this proposal. A 116-second `pg_stat_user_tables` interval observed about
5.74 inserts and 0.50 updates per second, only a short operational sample.

The isolated `forge_storage_exposure` PostgreSQL 18 fixture used the current
Prisma migrations and 500,000 random UUID windows with three event kinds each:
**1,500,000 rows**, 2.10 times the live row count. The main heap occupied
472,621,056 bytes, 2.56 times production's main heap. Every event kept its
separate ID, event UUID, window UUID, public path, kind, timestamps and expiry.
The 96-character path component deliberately makes the wide key expensive;
the fixture is not a distributionally exact production clone. A separate
18-event window covered six positions and three kinds. The root owner's
recent production sample found at most three rows per six-column key, so the
three sibling events per fixture key exercise the observed maximum filtering.

## Read path and physical result

The six-column candidate used 60,563,456 bytes against 447,209,472 bytes for
the eight-column index on the same fixture: **386,646,016 bytes (86.5%)** less
allocated index space. This is a local candidate saving, not projected
production filesystem recovery. Creating the candidate alongside the old
index with ordinary `CREATE INDEX` took 2,059 ms and advanced WAL by
55,012,656 bytes. Keeping both indexes during a two-step rollout would also
temporarily raise write amplification and disk use.

With the wide index transactionally hidden from the planner, an exact lookup
for all six leading fields plus policy, path and kind used the narrow index,
then filtered one sibling row. The single `EXPLAIN ANALYZE` execution took
0.039 ms. A window-plus-kind lookup used the narrow index and filtered two
sibling rows in 0.027 ms. The 18-event window scanned by the narrow index,
filtered twelve other kinds and returned six rendered rows in 0.061 ms.
The Admin cohort report selects by `occurred_at` through its separate cohort
index or a sequential scan according to time-window selectivity; the window
key replacement does not supply that path. The existing 60,000-fact native
report test already covers its grouping and denominator semantics. These
individual timings prove plan shape and correct rows, not production latency
or a statistically stable speedup.

## Bounded ordinary migration attempt

The served-manifest path has a three-second SQL statement timeout and a
four-second transaction wrapper; the storage owner set a stricter 1.5-second
acceptable write-wait headroom for this rollout. Because
ordinary `CREATE INDEX` blocks inserts and updates, the tested migration
candidate limited lock acquisition to 250 ms and the build statement to
1,000 ms. It failed with SQLSTATE `57014` at 1,001 ms, rolled back, and left
the old index and all rows intact. A simultaneous reader completed in 8.65 ms.
Twelve intentionally concurrent writes (more than twice the short observed
insert rate) all succeeded, but waited **455–951 ms** behind the bounded
attempt. The successful 2.06-second ordinary build was measured without
concurrent writers; writers caught at its start would exceed a 1.5-second
budget. A failed bounded migration has no storage benefit, and simply raising
its budget would risk live write timeouts. Production hardware, traffic and
lock queues can be worse than this disposable fixture.

The original eight-column index was retained, and the temporary narrow index
was removed after the fixture proof. No row was deleted or rewritten. Do not
add `CREATE INDEX CONCURRENTLY` to a Prisma transactional migration, and do
not ship a provisional `0119` ordinary replacement from this evidence. Revisit
only with a separately reviewed online DDL release path or a measured window
whose write impact is explicitly acceptable, including fleet health, rollback
and actual production relation/WAL measurements. Keep feat-574 in progress
for the other storage units.
