---
title: "fix: Pace subscription recommendation requests"
type: fix
status: completed
date: 2026-10-15
---

# Pace subscription recommendation requests

## Summary

Resume the owner's existing full-catalog build with bounded request starts as
well as bounded concurrency. The twelve-call run saved thirteen batches before
three CLI processes reported rate limits. Their missing usage remains unknown.
The four-call setting can continue unaffected sources during this repair.

## Requirements and decisions

- R1: Allow an operator-selected minimum interval between model process starts.
  Keep the default zero for existing callers; validate a bounded integer.
- R2: Wait before reserving a model call and read identity and allowance after
  waiting. Preserve the 25% allowance floor, pause-on-error, and receipt drain.
- R3: Keep full profiles, Astra, frozen inputs, existing results, and all seven
  unknown call records. Never retry a dispatched call automatically.
- R4: Ship through normal PR review and main. Resume the reviewed local producer
  and observe saved comparisons before claiming reliable throughput.

The exact provider request or token rate threshold remains unknown. Pacing is an
operator control, not proof that any particular rate is supported. This change
adds no automatic regeneration, public activation, or API billing fallback.
Recovery of the ten held videos remains required closeout work after pacing.

## U1. Pace admission before fresh identity and reservation

**Requirements:** R1–R3. **Dependencies:** none.

**Files:**

- `apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.ts`
- `apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.test.ts`

**Approach:** Extend the existing serialized reservation boundary to include the
start interval and fresh admission. Release that boundary as soon as the child
starts, allowing model execution to overlap. Skip responses do not consume a
model-start interval. A sibling failure prevents waiting calls from reserving.

**Execution note:** Test first at the existing public adapter seam with real
fixture processes, deterministic timers for admission, and no paid model calls.

**Test scenarios:** Concurrent requests cannot start in a burst; in-flight calls
overlap; delayed admission reads current allowance; a sibling failure stops
waiting reservations; skipped reservations do not consume the interval; invalid
intervals fail before dispatch; existing unpaced concurrency remains valid.

**Verification:** Focused adapter tests, Mastra typecheck, and lint pass.

## U2. Expose pacing to the manual operator command

**Requirements:** R1, R4. **Dependencies:** U1.

**Files:**

- `apps/mastra/src/scripts/run-manual-subscription-catalog.ts`
- `apps/mastra/src/scripts/run-manual-subscription-catalog.test.ts`
- `docs/operations/precomputed-catalog-build.md`
- `docs/roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md`

**Approach:** Add the optional bounded interval to the strict local configuration
and forward it to the adapter. Document measured throughput and the distinction
between concurrency and request pacing without claiming a provider limit.

**Test scenarios:** Existing configurations remain valid; valid pacing passes
through configuration; negative, fractional, and excessive intervals are rejected.

**Verification:** CLI tests, formatting, review, CI, and merged-source checks pass.

## Risks and verification

The admission queue must release on every skip or failure. Time spent waiting
must not age identity evidence or consume the provider timeout. Tests must verify
actual behavior through the adapter, including overlapping processes and safe
failure. Existing native Admin receipts and database schema remain authoritative.

## References

- `docs/plans/2026-10-08-precomputed-recommendation-subscription-build.md`
- `docs/roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md`
- Existing `reservationTail` serialization and fresh admission in the adapter.
- Production metadata audit: 2,909 saved comparisons, seven unknown calls, and
  ten held sources as of October 15, 2026 NZ time.
