# Retention admission after transaction acquisition

Scope: feat-554's open cleanup reliability and operational-margin work.

The October 28 ordinary cycle committed deletions but had six genuine P2028
failures at different transaction boundaries. One `select_experiments` phase
had 1,444 ms remaining before transaction acquisition, spent 1,624 ms acquiring
the transaction, then attempted its advisory-lock query. Current admission
checks run before acquisition and after that query, leaving this gap.

Recheck the existing nonterminal minimum admission budget immediately after
acquisition, before any query. Reuse the existing safe yield finalization:
durable committed counts, unknown backlog, bounded continuation and no success
watermark. Preserve terminal behavior, real errors and all timeout values.

Verify the inclusive 750 ms boundary, exhausted time, an already committed
prefix and genuine acquisition rejection. Give the new boundary an explicit
allowlisted diagnostic stage; verify parser round trips and terminal failure
reporting. Run the focused unit suites and native retention regressions, normal
hooks, independent review and required CI before a normal PR-to-main release.

This correction does not identify the underlying acquisition delay or explain
the other five failures. Do not claim a single slow SQL statement, GC cause,
production resolution or extra clean-cycle credit from local tests. The
accepted October 23 and October 27 cycles remain accepted; feat-554 stays open
for operational margin and the next ordinary observation. Keep the existing
daily observer active and the expired temporary outage monitor paused.
