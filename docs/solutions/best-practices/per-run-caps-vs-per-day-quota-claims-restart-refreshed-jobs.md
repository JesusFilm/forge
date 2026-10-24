---
title: "A per-day quota claim implemented as a per-run cap is falsified by redeploy boot sweeps"
date: 2026-08-10
updated: 2026-08-11
category: best-practices
module: apps/mastra
problem_type: best_practice
component: background_job
severity: medium
applies_when:
  - A boot-hooked background job spends against an external per-day (or per-window) quota
  - A code comment or ticket claims a reservation/headroom denominated per DAY while the enforcing constant is per RUN
  - Sizing request budgets for jobs that re-run on every process start (each deploy restarts the process)
tags:
  - quota
  - rate-limit
  - budget
  - boot-sweep
  - redeploy
  - background-job
  - wall-clock-scheduling
related_components:
  - apps/mastra/src/mastra/langfuse-trace-retention.ts
---

# A per-day quota claim implemented as a per-run cap is falsified by redeploy boot sweeps

## Context

feat-336's Langfuse trace sweep spends requests from an ORG-wide quota of 50
trace-delete requests per DAY, of which >=10/day must stay reserved as
feat-337 erasure headroom (an erasure always wins over the sweep). The first
implementation set `MAX_DELETE_REQUESTS_PER_RUN = 40` under a comment
claiming the >=10/day reservation — a per-DAY claim enforced per RUN. The
job ran at every process start (boot sweep) plus a daily timer, and every
Railway deploy restarts the process with a fresh cap: two deploys in one
backlog day could legally attempt 80 requests and starve the reserved
headroom to zero. Three reviewers found it independently and a validator
confirmed it; the sweep's in-memory state cannot fix it, because the state
resets on exactly the event (a restart) that mints the fresh budget.

This is a sibling of the "a budget must be MEASURED, not COMPUTED" law
(`docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`):
there, a computed bound is tautological w.r.t. what it forgot; here, a
correctly computed bound is attached to the WRONG DENOMINATOR — the run,
when the quota's denominator is the day.

## Guidance

**The LAW (unchanged): a cap's denominator must match the quota's
denominator, or be honestly derived from it.** A per-day reservation
enforced by a per-run constant is only as good as your control over runs
per day.

**Precondition of ANY cap — the numerator first.** `this_job_allocation`
is the window quota minus the reserve AND minus every other spender of the
same window (manual operator actions, CLI sessions, opt-in smokes, sibling
environments, the named next consumer). Fixing the run-count DENOMINATOR —
by either resolution below — does nothing to the numerator: with
runs/window = 1 fully intact, an unenumerated second spender still starves
the reserve. Enumerate the spenders before choosing any cap.

**Step 0 — check for a scheduler you did not have to build.** If the
runtime/platform already offers a durable or declarative scheduler
(framework cron, platform cron, workflow scheduler), verify two properties
before hand-rolling anything: at-most-once per window (a manual-trigger
surface — a Studio "Run" button, an operator replay — is a second-spend
path that re-opens the denominator), and no backfill of missed fires (a
backfilling scheduler reintroduces multi-run windows). A scheduler that
passes both is the cheap answer. feat-336 checked and declined the
runtime's own workflow scheduler on exactly those grounds: its
Studio-invocable surface makes run count operator-dependent, and its
no-backfill semantics convert a missed fire into a silently skipped window
with no boot-time catch-up. The recipe below is what you build when step 0
fails.

There are two honest resolutions, in preference order.

**Primary — make the run count deterministic (absolute wall-clock
scheduling).** Whether removing the boot run is safe depends on the
SCHEDULING MODEL, and this distinction is load-bearing:

- **Relative scheduling** (`setInterval` from boot): the timer restarts from
  zero on every process start, so when restarts outpace the interval the
  periodic timer NEVER fires — the boot sweep is the only schedule the job
  actually gets, and removing it trades quota safety for no retention at
  all. Under relative scheduling, the boot run cannot be removed.
- **Absolute scheduling** (a wall-clock timer: compute delay to the next
  fixed UTC firing time, fire, re-arm): a restart re-aims at the SAME
  wall-clock target instead of postponing it, so restarts neither add runs
  nor delay the next one. The boot run can be removed, runs/window becomes
  1 by construction, and the per-run cap legitimately equals the per-window
  allocation — the denominator mismatch is DISSOLVED, not divided around.

feat-336's resolution (2026-08-11, superseding the divided cap below): a
fixed 08:00 UTC wall-clock timer (the hour chosen from the observed deploy
trough — zero merges to main in that UTC hour across a 200-merge/20-day
sample), boot only arms the timer, `MAX_DELETE_REQUESTS_PER_RUN = 40` = the
full per-day allocation. Guards that keep the premise honest: a
boot-arms-never-sweeps test (zero fetches at start — reintroducing boot
spend falsifies the arithmetic), an arming log line
(`event=sweep_scheduled next_fire=<iso>`) so a timer that never fires is
diagnosable from log absence, a last-fired-UTC-day latch in the re-arm
(setTimeout waits on the MONOTONIC clock while the re-arm reads the WALL
clock, so a backward NTP step during the ~24h wait would otherwise aim the
re-arm at the SAME UTC day and double that day's spend — review-found,
2026-08-11), and the arithmetic pin naming its premise:

```ts
// langfuse-trace-retention.test.ts — runs/day = 1 by construction
expect(MAX_DELETE_REQUESTS_PER_RUN * 1).toBeLessThanOrEqual(40)
```

The primary form's residual accounting rests on PRECONDITIONS — verify
each per service, never inherit a sibling's posture: (1) deploys promote
via a healthcheck-gated overlap (old container alive through the firing
moment) and the new process arms at start — a stop-then-start deploy
converts every straddling deploy into a skipped window; (2) the process is
long-lived and kept alive by something other than this timer (the timer is
unref'd); (3) single replica; (4) the firing cadence is sparse enough that
a deploy trough exists to aim at — a per-hour quota has no trough and
scales its overlap exposure with frequency. Failing any of these re-opens
the skipped-run or multi-run risk and pushes the choice back toward step
0's scheduler or the fallback. With the preconditions held, the accepted
residuals (feat-336, dogfood scale, recorded in the ticket): a genuine
outage straddling the firing moment skips that day; a deploy overlap can
double-fire, which at steady-state workload costs ~2 requests (spend is
workload-driven, the cap is a ceiling) and only threatens the quota when
it coincides with a multi-thousand-trace backlog.

**Fallback — divide the cap by worst-case runs (for jobs that cannot fix
their schedule).** When the boot run must stay (relative scheduling, or the
boot run is itself the product), size the per-run cap by the worst realistic
number of runs per window, against this JOB's share of the window:

```
per_run_cap = floor(this_job_allocation / worst_case_runs_per_window)
```

Two denominators-of-the-denominator to get honest first:

- **`this_job_allocation` is the window quota minus the reserve AND minus
  every OTHER consumer of the same window.** An org-wide quota is shared:
  a manual operator delete, a CLI session, another service or environment
  in the same org all spend from the same 50/day. Enumerate the other
  spenders before choosing the numerator — dividing the whole window by
  your own runs still starves the reserve the moment a second spender
  exists.
- **`worst_case_runs_per_window` must count crash/OOM restarts, not just
  deploys plus the timer.** The boot sweep fires on EVERY process start; a
  Railway crash loop is not bounded by "~4". Multi-replica deployments
  multiply the same way.

feat-336's interim resolution (2026-08-10, superseded the next day by the
wall-clock form above) was this divided cap: ~4 sweeps/day ESTIMATED —
and the estimate was already contradicted by the arc's own data: the same
change measured ~10 merges/day (the 200-merge/20-day deploy sample two
paragraphs up), which under this formula requires `floor(40/10) = 4`, not 10. Do not copy the example's number; it is the canonical instance of the
unmeasured-`worst_case_runs_per_window` trap the bullet above names.
Allocation 40/day, `MAX_DELETE_REQUESTS_PER_RUN = 10`, pinned as
`expect(MAX_DELETE_REQUESTS_PER_RUN * 4).toBeLessThanOrEqual(40)`.

Alternatives considered when the divided cap was chosen, re-evaluated when
it was superseded: in-memory per-UTC-day spend tracking dies on the same
restart that grants the fresh budget; persisting spend (an atomic
claim-before-spend row in Postgres) is the hard guarantee but adds a
storage dependency a retention job should not need at dogfood scale — it
remains the named deferred mitigation for the double-fire residual;
suppressing the boot run was originally rejected on the relative-scheduling
premise ("the boot sweep is the only schedule the job actually gets"),
which is exactly the premise absolute scheduling removes — that rejection
was scheduling-model-specific, not general, and mistaking it for general is
what kept the divided cap looking like the only option.

## Limits

The primary form makes runs/window deterministic against restarts, but not
against everything: a deploy-overlap double-fire (two containers coexisting
across the firing moment) still evades it, nothing detects an over-spend
when that coincides with a heavy backlog, and a paused/never-firing timer's
failure mode is ABSENCE of a log line (the arming line makes it
diagnosable after the fact, not alerted). The last-fired-day latch is
itself in-memory, so its guarantee holds only while the process that fired
is still the process that re-arms — a backward clock step FOLLOWED by a
restart re-opens the same-day double-fire (the fresh process has no latch
and re-derives the fire time from the stepped-back clock); closing that
durably is the same persisted-claim control named below. The divided-cap
fallback REDUCES starvation risk without removing it:
`worst_case_runs_per_window` is an unmeasured estimate a pinned
computation cannot enforce — it catches a RAISED CAP, never a raised run
count. So, for either form:

- Pair the cap with an observable — the arming line plus per-run spend
  counts — so actual runs/window is reconstructible from logs after the
  fact.
- Two INDEPENDENT triggers promote persistent atomic claim-before-spend
  tracking to the honest control when the reservation protects a
  compliance obligation: (1) the deployment cannot bound its run count
  even under absolute scheduling (multi-replica, observed collisions), OR
  (2) a second spender lands on the same window — bounded run count does
  NOT retire this trigger, because the numerator precondition above is
  untouched by scheduling. The control is a single conditional statement
  (`INSERT ... ON CONFLICT DO UPDATE SET spent = spent + n WHERE
spent + n <= cap RETURNING`), claimed BEFORE requests fire; a
  read-then-write counter reintroduces the race it exists to solve.

## Why This Matters

The reserved headroom exists so a GDPR erasure request is never blocked by
housekeeping. A cap that silently over-spends the shared quota on deploy
days fails exactly when erasure needs it — and nothing logs the violation,
because every individual run stayed within ITS cap. Denominators are part of
a budget's contract: a reviewer who reads "reserve 10/day" next to a per-run
constant should treat the mismatch as a defect, not a comment nit — and
should then ask which scheduling model the job runs under, because that
decides whether the fix is a divided cap or a dissolved denominator.

## When to Apply

- Any boot-hooked job (retention sweeps, backfills, cache warmers) spending
  a per-day/per-hour external quota — each deploy, crash restart, and OOM
  kill is an extra run under relative scheduling.
- Reviewing comments/tickets that state reservations per WINDOW: check the
  enforcing constant's actual denominator, the job's scheduling model
  (relative vs absolute), and whether the window's other consumers were
  enumerated.
- Multi-replica deployments multiply runs per window under EITHER
  scheduling model (every replica fires at the wall-clock target); the
  single-replica assumption must be stated if relied on.

## Examples

Before (falsified by two deploys in one day — per-day claim, per-run cap,
boot sweep):

```ts
/** ... >=10/day stay reserved as erasure headroom ... */
export const MAX_DELETE_REQUESTS_PER_RUN = 40 // + boot sweep on every start
```

After (primary form: absolute scheduling makes the claim honest):

```ts
/** Per-RUN cap == the per-DAY allocation, because runs/day = 1 by
 *  construction (wall-clock timer at a fixed UTC hour; boot only ARMS). */
export const MAX_DELETE_REQUESTS_PER_RUN = 40
```

Fallback form (jobs that cannot fix their schedule):

```ts
/** Per-RUN cap sized for ~4 sweeps/day so a 40/day retention allocation
 *  holds and >=10/day erasure headroom survives redeploy boot sweeps. */
export const MAX_DELETE_REQUESTS_PER_RUN = 10
```

## Related

- `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md` (the measured-not-computed budget law this extends)
- `docs/solutions/architecture-patterns/diy-retention-sweep-three-controls-visibility-walled-store.md` (the job this was found in)
