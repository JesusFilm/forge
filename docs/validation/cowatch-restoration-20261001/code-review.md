# Co-watch restoration review

Review scope: the isolated `codex/cowatch-restore-release` worktree, original base
`8890beaf1bb61932d4fbd4195a12cee59c0134d8`, and the restoration plan. A reused leaf
reviewer independently examined correctness, adversarial interleavings, API/auth
boundaries, database migrations, retention, scheduler reliability and UI races.
The orchestrator reviewed source-integrity compatibility, theme selection, grant
binding and capacity admission. This is a code-review record, not production proof.

| Finding                                                                           | Resolution and discriminating coverage                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: an old worker could activate after its attempt was reclaimed/refused          | Exact lease/status compare-and-set, shared refresh lock at publication and activation, transient contention keeps the original identity. Paused-worker takeover test. |
| P1: workflow failure could stop refresh until process restart                     | Independent periodic scheduler recovery and runtime status/heartbeat recovery tests.                                                                                  |
| P2: an absent grant on inspection could abandon a still-uncommitted authorization | Preserve exact UUID, budget and reviewed pointer; require matching receipt, and matching revocation for stop. Delayed-visibility and same-body retry UI tests.        |
| P2: late authorization postponed an already-due publication by another 12 hours   | Grant time is an admission floor, while the cadence remains anchored to the latest attempt/publication. Native 23-hour-old graph test.                                |
| P2: default inspection selected the oldest stopped grant                          | Live grant first, otherwise latest approval. Multiple stopped-grant native test.                                                                                      |

The reviewer found no residual actionable issue in these paths after the fixes,
including the terminal-only audit purge after 2,555 days. The source query receives
a separate frozen-reference native equivalence check and bounded production read.

Operational limits remain explicit: `pg_database_size` and graph relation ceilings
do not continuously measure free filesystem space, resident WAL or transient work.
A production refresh grant requires fresh physical admission and a retained-overlap
reserve; implementation/test success cannot supply that evidence.

## Retained-overlap stress finding

The initial optimized source query passed current-production equivalence and
latency checks, but its per-raw-row retained receipt materialization failed an
owned synthetic steady-overlap test. With 40,605 raw rows and 6,841 qualified
sources, three generations produced 155,100 ownership matches and completed in
2.05 seconds. Sixty retained generations produced 3,102,000 matches and reached
the five-second statement limit. The 256 MB fixture temp cap was not the refusal.
This was a release-blocking performance finding for feat-573. The final source
query aggregates invalid ownership and preferred identity separately by session
and episode before joining raw rows. The same owned stress test now completes
in 2.05 seconds at three generations and 2.33 seconds at 60. All 40,605 rows,
22 fields and ordering exactly match the original three-generation result. The
independent reviewer found no remaining semantic issue, including exact-episode
identity priority and invalid ownership from a different session. See
`retained-overlap-proof.json` for the fixture, resources and explicit limits.
