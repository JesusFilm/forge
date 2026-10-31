# Finite co-watch populations — September 29, 2026

The previous production preflight refused the 180-day population at 50,001 raw
episodes. The separately reviewed finite-window operator now supports a fixed
event population without changing integrity, support or work limits. This is
implementation evidence; no new production population has been queried or
published by this change.

## Population and operator contract

The new `episode-event-window-v1` scope requires explicit `--window-start`,
`--window-end` and `--evaluation-as-of` timestamps. Without `--execute`, the CLI
runs a read-only preflight. `--execute` requests an atomic shadow publication.
Both paths emit aggregate counts and the complete scope, without viewer,
session, episode or outcome identifiers.

Membership uses `COALESCE(episode.claimed_at, episode.created_at)`, inclusive at
the start and exclusive at the end. Select the latest classifier revision at
the separate cutoff before applying eligibility. Current expiry, supersession,
integrity and privacy checks still apply: historical selection never revives
currently invalid evidence. Ordered scope must end by the cutoff, the cutoff
must be closed, and the interval cannot exceed 180 days. The proposed initial
production population is seven complete UTC event days; that is an operator
proposal, not a new API limit or permission to search for a passing population.

Generation identity binds the algorithm, scope and all eligible canonical
source identities, including singleton denominator contributors. Decay uses the
frozen evaluation cutoff. Publication records the actual publication time;
an identical rebuild returns the original time instead of refreshing it.
Legacy generations and old writers retain the explicit
`legacy-outcome-write-window-v1` contract after additive migration 0106.

The inspector displays scope and raw/pair counts. Its exact-generation loader
never substitutes the newest graph when the requested ID is missing. Complete
operator-to-evaluation graph pinning and sustained controlled-trial privacy
lineage belong to the subsequent live integration; this loader seam alone is
not that authority.

## Resource contract

- At most 50,000 raw canonical source rows; reading 50,001 is a refusal and a
  lower bound, not a complete population count.
- At most 256 eligible rows per session and 250,000 attempted pairs, preserving
  the existing 48-hour directional gap. Overflow publishes no partial graph.
- Repeatable-read snapshot, five-second statement timeout, one-second lock
  timeout and 30-second application transaction deadline.
- A fixed transaction advisory lock admits one publisher across all scopes.
  Another publisher is refused before source selection. Read-only preflights
  can overlap; the operator must budget them separately and serialize the
  proposed production work.
- The receipt separates raw sources, eligible sources, attempted pairs,
  contributions, edges and total publication rows. The theoretical maximum is
  550,001 rows: one generation, 50,000 sources and up to 250,000 contributions
  plus 250,000 edges. A row cap is not a scanned-revision, heap, index, WAL or
  temporary-storage byte cap.

## Local evidence and limits

Implementation revision: `7a874ff8380279ed56474278c008343d12dd9c89`.
Worker and independent parent runs each passed 34 tests, including eight native
PostgreSQL cases. Parent added a loopback/disposable-database guard before the
new bulk fixtures run. The first parent attempt used incorrect local dummy
credentials and failed before queries; the corrected fixture run passed.
Full Admin typecheck, scoped lint, repository formatting and the parent
production build with Workflow compilation and registration checks also passed.

The owned PostgreSQL 18 container was limited to two CPUs and 2 GiB. A dense
fixture with 128 sources produced 8,128 attempted pairs, contributions and edges
(16,385 publication rows). Across the recorded runs, publication took 4.1–15.4
seconds. A run allocating fresh index pages grew the four relations and indexes
by about 20.8 MB and produced about 25.4 MB of WAL. The parent rerun reused index
pages, grew allocations by about 9.7 MB and produced about 22.6 MB WAL. Reuse is
not evidence that future publications require fewer bytes.

The parent process reported about 48 MB heap before and 123 MB after publication;
its cumulative maximum RSS was about 505 MiB. These are not graph-only peak
heap bounds. PostgreSQL `temp_bytes` was cumulative across fixture runs, not
per-publication peak temporary storage. The maximum-size population has not
been shown safe by these measurements.

The raw-overflow query observed 50,001 canonical rows and refused in about
2.8 seconds on the parent fixture. Separate cases refused 257 rows in one
session and the 250,001st pair attempt. A forced edge-table write lock proved
rollback of earlier generation/source inserts, concurrent-publisher refusal,
successful overlapping read-only preflight, and safe retry after rollback.
Native revision, singleton, suppression, rebuild, cutoff and legacy-writer
cases also passed. The Admin page has scope-rendering and permission tests.

## Remaining production gate

Before execution, retain exact deployed revision/migration, immutable event and
request windows, proposed concurrency, retry identity and stop conditions. Give
the storage owner the read-only query envelope first, then its exact population
and measured/defensible byte estimates before any publication. Require fresh
database headroom, retention, lock/job and health assessment; do not credit a
future purge or extrapolate a maximum-scale guarantee from this fixture.

Production graph coverage, anchors, overlap, latency, sparse/stale fallback,
terminal evaluation and authenticated Admin reconciliation remain unobserved.
Feat-387 remains in progress. Controlled usefulness and live promotion remain
separate gates.
