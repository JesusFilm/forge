# Spec review — replay/deadline correction

Fixed base: `a319a068fc2d79684c1ad1824387c2b8a45ca0dc`; reviewed working diff and new budget/guard tests. Read-only source review; no tests or providers run.

1. **[P1] Generation cutoff can suppress successful completion during the reserved persistence window.** `apps/mastra/src/services/studio-authoring/run-budget.ts:131` enters `settle()` without clearing `generationTimer`. If generation succeeds at 174 seconds and terminal persistence takes two seconds, the 175-second generation timer aborts the budget while persistence legitimately continues within the original 180-second allowance. `apps/mastra/src/services/studio-authoring/runtime.ts:407` subsequently calls `emit(done)`, but `emit` suppresses events on the aborted budget signal. Manager consequently receives no successful terminal event and treats the stream as failed although native persistence recorded completed. The approved spec requires a generation cutoff at 175 seconds **and** a five-second terminal reserve within the original clock. Clear the generation cutoff when entering settlement, retaining the original-clock persistence deadline, and test successful settlement spanning 175 seconds.

No additional actionable scope findings: stalled tool-call detection preserves normal typed-error repair, the versioned guard distinguishes same-run byte replay from another authorized run, and the new guard refuses incompatible old ledgers. Actual retained SSE regression and framework are preserved.

## Follow-up resolution

The P1 above is resolved. `settle()` now clears the generation timer while computing its persistence timeout from the original remaining run allowance. The new 174-second generation plus two-second settlement regression verifies successful recording without abort and four seconds remaining. Existing blocked-tool cutoff and first-caller-abort coverage remain intact. The additional agent regression retains an earlier validated proposal and rejects the later stalled turn after exactly two model calls. Reviewed `.tmp/studio458-settling-cutoff-green.log`: ten tests passed. No additional findings in the final narrow delta; no tests/providers run by this reviewer.

## Final targeted additions

No findings. The Manager transport test verifies the 190000ms outer deadline and preservation of the earlier caller reason. The seven V2 guard cases cover concurrent ownership, restart replay rejection, distinct authorized runs, unknown-charge ambiguity, refusal without rewriting an incompatible ledger, and unrelated-slot violations. The comparison README keeps the closed paid batch separate from this unpaid correction, distinguishes $0.39004885 known charges from the $0.56144 ambiguous reservation, and leaves actual total unknown. It qualifies historical timeout attribution, incomplete comparison coverage, and lack of creative/visual acceptance. Read-only inspection; no tests rerun.
