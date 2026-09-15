# Studio calendar execution scope

Fixed implementation base: `2d4d9bb8` (root `1d606e2d` equivalent), including
reviewed 458 through root `98db308f`. Full feat-461 is released for implementation;
final publication/Watch acceptance awaits the remaining reviewed feat-460.

## Ownership and behavior

Admin owns calendar settings, immutable planning provenance, date slots and
versioned prior interactive publication authorization. Projects remain standalone
unless explicitly linked. Calendar settings use validated IANA timezone, explicit
wall time and delivery window; ambiguous times require a choice and nonexistent
times fail. Show local today through day 13 and following days 14 through 27.

Default one slot per day. Bounded once/twice-daily automation fills missing
titles/themes only, using assigned week/slot or default Content Packs and isolated
native instruction provenance. No production commands or tools in planner.
Suggestions do not imply eligible sources or production readiness. Preserve manual
overrides and edited/approved projects; production is explicit single/batch through
reviewed 458 and never bypasses review or starts narration automatically.

Calendar owns the concrete publication hook: project-before-slot locks, fresh time
after slot lock, exact version/due/window/project/revision/approval/render/release,
current membership, revocation, cancellation and atomic consumption. Scheduling
does not freeze editable content. Prior human authorization excludes readiness ID;
460 resolves fresh proof for the same release. Retain potentially submitted exact
envelopes for retries, including accepted retries after unpublish. No substitute
content, fake publication success or invented source registry.

## Agreed test boundaries and implementation order

1. Calendar public commands backed by task-owned Postgres: duplicate planning,
   stale revisions, manual overrides, source selection, durable authorization,
   cancellation/reschedule, lock races and rollback through the reviewed common
   publication command. Use focused failure-first cases, then broader suites.
2. Portable date/time and planner-result contracts: DST gap/fold and strict
   titles/themes-only envelopes. Native planner execution uses real isolated
   instruction storage and deterministic external model fixtures, without spend.
3. Authenticated Manager calendar and explicit production transport: state/action
   behavior and actual built-browser workflows. Capture controlled baseline before
   frontend edits and compare matching conditions; preserve inherited inconclusive
   timing as a limitation, not a passing baseline.
4. Integrate final reviewed 460 resolver/publication transport for due execution,
   real Watch/unpublish acceptance. Until available, record unavailable delivery
   and exact integration dependency; do not mark full ticket complete.

Coordinate migrations before writing them: 460 reserves 0083–0087. Use own
Postgres/services/disposable keys and no sibling fixture launchers or credentials.
No provider spend, production/infrastructure changes, push, merge or deployment.
Run scoped suites/types/builds and appropriate full suites; independent fixed-base
Standards/Spec review, hooks-enabled commits and durable learning handoff follow.

## Final publication integration release

Root released c6a9ec43 (final460), incorporated exactly once as8dc2d564 on
reviewed2d4d9bb8. Calendar WIP was backed up byte-for-byte and restored with
explicit unions for Prisma, dispatch and portable exports. Final local scope now
includes a separate publication timer, durable delivery leases/outcomes, canonical
preflight and fresh same-release preparation, exact stored-envelope submission,
schedule UI and actual local scheduled Watch/revocation/retry verification.
Migration0092 is calendar-owned dispatch bookkeeping, separate from immutable
human authorization. It does not add an asset/source/agent registry. The new UI
loading comparison will cover calendar only; earlier create-page performance
remains unresolved and will not be remeasured or relabeled.
