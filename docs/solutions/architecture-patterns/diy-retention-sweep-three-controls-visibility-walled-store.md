---
title: "DIY retention over an eventually-consistent, visibility-walled store needs three independent controls"
date: 2026-08-10
updated: 2026-08-11
category: architecture-patterns
module: apps/mastra
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - Building a self-run deletion/retention sweep over an external store's HTTP API (no vendor retention feature)
  - The deleted unit is derived from a server-side query filter the client did not verify
  - Deletion is asynchronous with no completion event, or the store hides data past an age/visibility wall
  - Designing the feat-337 per-user erasure capability (the named next consumer of this pattern)
tags:
  - retention
  - data-deletion
  - langfuse
  - background-job
  - fail-loud
  - verify-by-requery
  - visibility-wall
related_components:
  - apps/mastra/src/mastra/langfuse-trace-retention.ts
  - apps/mastra/src/mastra/ai-chat-retention.ts
---

# DIY retention over an eventually-consistent, visibility-walled store needs three independent controls

## Context

feat-336 built `apps/mastra/src/mastra/langfuse-trace-retention.ts`: a daily
sweep that deletes seeker traces older than the flat 25-day window
(`AI_CHAT_RETENTION_DAYS`, shared with the Postgres purge) from the
`forge-mastra` Langfuse project. The store has three properties that make a
naive list-then-delete loop dangerous, and each showed up as a validated
review finding before merge:

1. **The delete set comes from a server-side filter** (`toStartTime` on
   `GET /api/public/v2/observations`). If the server ever ignores or renames
   that parameter, the listing silently becomes "everything".
2. **Deletion is asynchronous** (~15 min, no completion event; the vendor's
   documented verification is "query it again").
3. **A visibility wall**: the Hobby tier hides data older than 30 days from
   BOTH the UI and the API — still stored, but un-listable and therefore
   un-deletable without a paid tier change. Data the sweep falls behind on
   becomes silently unreachable, and the sweep's own logs look identical to
   a clean project (`listed=0`).

The first implementation trusted the filter, wiped its verification memory
every run, and had no age signal — five independent reviewers (correctness,
security, adversarial, reliability, plus a cross-checking validator)
converged on those gaps. The known failure mode of every DIY retention job is
the same: **silent under-deletion** — green logs while personal data outlives
the promise.

## Guidance

The transferable invariant: **one early, mechanism-specific fail-loud guard
per KNOWN silent-failure class, plus at least one restart-proof OUTCOME
metric that does not depend on predicting the cause.** The count is derived
per store, not copied — this store's known classes are filter drift, lost
deletion receipts, and the visibility wall, and the pagination-cursor guard
under "Supporting posture" is a fourth mechanism-class guard in the same
family. Derivation update (2026-08-11): the lost-receipts class is now
covered by the OUTCOME metric (control 3) at a stated latency rather than
by a dedicated receipt-tracking mechanism — control 2 below records why its
in-memory form was removed and what the durable form must look like if ever
built. A class may move between controls when its dedicated mechanism is
demonstrably inert; it may never be silently dropped from the derivation.
Two conditions bind that rule: absorption is legitimate only when the
absorbed class provably produces the receiving control's SYMPTOM before
the point of no return (write that derivation down, not just a latency
number), and only when the inertness premise is stated together with an
observable revival trigger someone actually watches — otherwise the
deletion outlives its premise and the rule becomes a licence to delete any
guard whose signal is currently quiet.

**1. Client-side re-check of the server-side filter (never trust the query
for a delete set).** Parse each returned row's own timestamp and skip —
loudly, with a counter — any row the filter should not have returned:

```ts
// langfuse-trace-retention.ts — inside the page projection
const startTimeMs =
  typeof startTime === "string" ? Date.parse(startTime) : Number.NaN
if (Number.isNaN(startTimeMs) || startTimeMs >= cutoffMs) {
  filterSkipped += 1 // -> `event=list_filter_suspect skipped=<n>` warn
  continue
}
```

An inert server filter now degrades to a no-op sweep with a loud log line,
never a store-wide delete. Pair it with a smoke that runs BOTH legs against
the same listing: a backdated sentinel asserted PRESENT (the positive leg —
without it, the negative leg passes vacuously on any empty or broken
listing: wrong project, bad credentials, dead pagination) and a fresh
in-window sentinel asserted ABSENT (the negative leg — a presence-only smoke
stays green with the filter broken). The pairing is the repo's
anti-vacuous-companion discipline applied to a smoke.

**2. The lost-receipts class (async deletion has no completion event) —
covered by control 3 at a stated latency; the dedicated receipt-tracking
mechanism is DEFERRED to durable state.** A silently failed delete looks
identical to a successful one at submit time. The structural mitigation is
self-healing: a trace whose deletion failed simply re-lists on a later run
and is re-deleted — no remembered state required. DETECTION of sustained
non-convergence rides control 3's age metric, ~3 days after traces overstay
the retention window (28-day warn vs 25-day window here) — and only on
runs that HAPPENED and whose listing was NOT truncated: on a truncated run
the metric is a prefix-only lower bound (see control 3's blind spot) and
the latency is unbounded, and a skipped run adds its interval. The stated
2-day reaction margin holds under those conditions, and it is a property
of OPERATOR ATTENTION, not of the system: every signal in this pattern
terminates in an unalerted log line, so when the reservation or the wall
protects a compliance obligation, route the warn events to a real alert
channel — otherwise report the margin honestly as "post-hoc diagnosable",
not reaction time. The opt-in real-credential smoke is the on-demand
DIRECT convergence OBSERVATION — it re-queries the window post-delete and
REPORTS `sentinel_converged=0|1` for the human running it, deliberately
never asserting convergence (async ~15 min is the vendor's SLA): evidence
for an operator, never a gate.

History (2026-08-11): an in-memory verify-by-requery mechanism — remember
submitted ids, re-encounter on a later run =
`event=delete_not_converging` — was built first and REMOVED. In-memory
carry-forward only fires when the process survives two consecutive runs,
and at the repo's ~10 deploys/day cadence it was de facto inert while its
replace-vs-union carry-forward rules were the module's subtlest logic:
permanent review surface guarding a signal that fires for nobody. If a
same-day non-convergence signal is ever genuinely needed (erasure SLAs, or
a slowed deploy cadence making receipt-tracking live again), build the
DURABLE form — pending ids persisted alongside the deferred per-UTC-day
spend-claim ledger — never the in-memory one. Two sub-rules earned by
review findings bind ANY requery implementation, durable included:

- REPLACE the remembered set only after a COMPLETE listing. After a
  truncated or failed listing, UNION instead (bounded) — otherwise ids the
  partial window never re-listed silently read as converged.
- Emit the non-convergence warning on every non-skipped outcome, including
  failed runs — a warning hoisted below an early `return` on the failure
  branch is a warning that never fires exactly when things are broken.

**3. A restart-proof OUTCOME metric with a threshold set below the point of
no return.** The metric measures the outcome (data that should be gone is
still visible), not any mechanism, so it catches _any_ sustained failure
cause — including causes nobody predicted — and it is restart-proof
(control 1 is a stateless per-row check and is also restart-proof). Since
control 2's in-memory mechanism was removed, this metric is the ONLY
runtime convergence verification, which is why its latency and margin are
stated numbers, not vibes. The retention-sweep instantiation: report the
oldest listed row's age on every SUCCESSFUL run (`oldest_age_days=<n>` on
the `sweep_complete` line — failed and rate-limited runs do not carry it)
and warn (`event=retention_wall_risk`) at a margin before the wall (28 of
30 days here — do NOT tighten it to buy detection latency: a single
failed/429 run on a healthy day puts the oldest age near 27 and would
false-positive); the warn fires on every non-skipped outcome, failed runs
included, so the alerting path never depends on the completion line. TWO
stated blind spots. First, truncation: the metric is computed over LISTED
rows, and a store with no ordering parameter makes a truncated listing a
PREFIX-ONLY sample — the true oldest row can be older than reported. Pair
the metric with a loud truncation cue (feat-336 warns
`event=list_truncated oldest_age_basis=listed_prefix_only` on every
truncated run) so a partially-measured run never reads as a fully-measured
one; where the working listing can truncate persistently, the stronger
instantiation is a DEDICATED bounded probe at the threshold (one request
with a tight older-than-warn-age filter, its returned row re-checked
client-side per control 1) — O(1), immune to truncation and missing
ordering; feat-336 keeps the by-product max plus the cue at dogfood scale,
with the probe as the named strengthening if truncated runs become the
norm. Second, SELF-SILENCING over a visibility-walled store: rows that
cross the wall leave the listing entirely, so the warn is a bounded PULSE,
not a persistent alarm — as a stalled backlog ages past the wall the
oldest LISTED age falls back under the threshold, the warning stops, and
total failure converges on the `listed=0` signature the Context section
calls indistinguishable from a clean project. An operator who misses the
pulse gets silence, not escalation; absence of the warn is NEVER recovery
evidence. Over such a store, pair the metric with a signal the wall cannot
erase — a latched/externally-persisted wall-risk state, or a
`listed=0`-despite-known-inflow cross-check — before banking the stated
reaction margin. A request-keyed consumer instantiates the metric
differently — see the feat-337 caveat under "When to Apply".

Supporting posture, same module: every abnormal path is a first-class enum
outcome (429 + Retry-After included); a full page returned without a
pagination cursor warns (`list_pagination_suspect` — a fourth
mechanism-class guard: a drifted cursor field otherwise caps every sweep at
page one, forever, silently); the gate is credential presence, never the
export kill-switch
(`docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`);
every log line these controls emit carries enums and counts ONLY — never
trace ids, user ids, conversation content, or exception text — so
"attributable" always means attributable to a failure class, never to a
record or a subject; and the job holds a full-project-access (delete-capable)
credential, so its egress is pinned (`redirect: "error"` + the production
host allowlist — the client-convention doc in Related owns that posture).

## Why This Matters

The traces here are raw seeker conversations — special-category personal
data. A retention job that silently under-deletes converts a privacy promise
into a latent incident, and the visibility wall makes the failure
_irreversible on the current tier_ once data ages past it (the escape hatch
is a temporary paid-tier upgrade). The three controls convert every known
silent-failure class into a loud, attributable log line while the data is
still reachable.

## When to Apply

- Any self-run deletion sweep over an external store's API — feat-337
  per-user erasure is the named next consumer.
- Any job whose delete/act set is produced by a server-side filter it did
  not independently verify.
- Any store with asynchronous deletion or an age/visibility wall.
- **feat-337 caveat (request-keyed consumers):** control 3's age-over-the-
  window metric is window-shaped and cannot express per-subject
  completeness — a subject's traces INSIDE the window are invisible to it.
  A request-keyed erasure consumer must substitute its own outcome measure:
  oldest UNFULFILLED erasure request age warned at a margin before the
  statutory deadline, plus a durable, operator-surfaced record of any
  erasure whose requery loop exhausted without convergence (a one-shot CLI
  has no later run to re-encounter the ids). And the wall bounds erasure
  COMPLETENESS itself, not just its metric: a subject's records past the
  visibility wall are un-listable and therefore un-erasable by this
  mechanism at all, so "subject data exists beyond the wall" must be a
  first-class, operator-surfaced outcome — carry the tier-upgrade escape
  hatch in the erasure runbook with a lead time inside the statutory
  deadline, not as a footnote about the retention job.

## Examples

`apps/mastra/src/mastra/langfuse-trace-retention.ts` (feat-336) implements
controls 1 and 3 plus the supporting posture; the lost-receipts class rides
control 3 (control 2's body records the 2026-08-11 removal of its dedicated
in-memory mechanism and the durable revival path).
`langfuse-trace-retention.test.ts` pins each with a discriminating fixture
(filter-skip, wall-risk warn, boot-arms-never-sweeps), and
`langfuse-trace-retention.smoke.test.ts` carries the negative-control
sentinel plus the API-level deletion-convergence requery leg (an
observation reported to the human runner, not an asserting gate — see
control 2).

## Related

- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
- `docs/solutions/best-practices/per-run-caps-vs-per-day-quota-claims-restart-refreshed-jobs.md`
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md` (owns the credentialed-egress client posture)
- `docs/solutions/platform/admin-search-trace-retention-pattern.md` (sibling precedent: day-margin sizing for a daily purge)
- `docs/roadmap/ai-chat/feat-337-per-user-erasure-capability.md` (next consumer)
