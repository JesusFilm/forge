---
module: Studio
problem_type: integration_issue
tags: [studio, mastra, cancellation, replay, deadlines, paid-generation]
---

# Native tool progress and one run deadline

A streamed response may finish as `tool_calls` while its truncated arguments yield zero parsed calls and zero results. Mastra 1.55.0 treats that finish as nonterminal and can resend unchanged input even with SDK `maxRetries:0`. Guard native iteration progress separately: stop that stalled turn with an explicit failure and retained proposals, but allow valid tool execution returning typed field/coverage errors to proceed to a repair turn. Keep exact per-run outbound replay fencing in any separately authorized paid evaluation adapter before reservation/network.

Generation needs one absolute clock across model steps and tool waits. `StudioRunBudget` reserves the final 5 s of 180 s for terminal recording by aborting the generation phase at 175 s, independently of step dispatch. Steps use at most 90 s or the remaining generation allowance. Settlement retires the generation timer but keeps the original absolute deadline. Otherwise successful generation at 174 s followed by 2 s of persistence can falsely fail when the generation cutoff fires during recording.

Keep first caller cancellation distinct from step, whole-run and persistence timeout telemetry. A bounded response race alone does not stop a late database write: production terminal recording also bounds pool acquisition, uses transaction-local statement/lock limits, and destroys the owned connection on timeout. Never retry an ambiguous terminal write with an opposite status.

Exact closed provider evidence, accounting uncertainty and editorial limitations are in `docs/validation/studio-458/model-comparison-1/README.md`. Red/green tests and independent reviews are in `docs/validation/studio-458/replay-deadline-fix/README.md`. No subsequent paid execution is authorized by this correction.
