> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Native replay and deadline correction

Fixed review base: `a319a068fc2d79684c1ad1824387c2b8a45ca0dc`. This unpaid correction is separate from the immutable closed paid comparison in `../model-comparison-1/`. It does not authorize any provider run, prompt change, media operation or application of proposals.

## Production behavior

`streamStudioAgent` disables processor retries and rejects a `tool-calls` iteration with zero parsed calls and zero results. Installed Mastra otherwise repeats unchanged messages on that malformed/truncated finish. Valid executed tool calls with typed validation errors still permit a subsequent correction turn. The bounded `StudioToolProgressError` terminates runtime as failed, retains earlier emitted proposals and never sends done. The retained ch19 SSE regression reaches the same failure through the installed OpenAI adapter/framework with exactly two local boundary invocations; no external network runs. A separate test preserves an earlier validated proposal after later malformed failure.

`@forge/studio-contracts/agent` exports `STUDIO_AGENT_LIMITS`: run 180,000 ms, step 90,000 ms, persistence 5,000 ms, Manager 190,000 ms. `StudioRunBudget` owns one monotonic absolute run clock. Its generation timer expires at 175,000 ms even if a tool/API call blocks between iterations. Each step receives at most 90,000 ms or remaining time minus 5,000 ms. Earlier caller cancellation wins and retains its first source in telemetry.

Settlement retires the generation timer and retains the same absolute 180,000 ms end. This matters for generation completing at 174 s followed by a 2 s successful terminal write: the old cutoff must not suppress done during recording. The independent Spec review found that edge; its red/green regression and resolved review are retained. A blocked tool at 175 s leaves exactly 5 s for recording; recording cannot restart the absolute clock. Caller cancellation at 174,999 ms remains the first reason even when persistence expires.

The runtime races generation and terminal work against their signals, so ignored cancellation cannot hang the response. `Config.finish` now receives `StudioSettlement {signal, timeoutMs}`. Production `finishStudioExecution` uses a transaction, local statement/lock timeouts and connection destruction on deadline, with no retry or fallback terminal write. The real isolated-PG lock regression proves an expired completion does not write later after the lock is released. Production pool acquisition is bounded at 5 s. Deadline telemetry reports started/observed times, elapsed/remaining allowance, event/source and first abort source without source text or credentials. Manager's shared native transport accommodates the overall run and recording; earlier caller cancellation is preserved.

All native run/test paths enter the same streaming budget; hosted chat, explicit batch and MCP use shared Manager transport. No frontend rendering, hydration, media initialization or UI code changed, so existing matched loading evidence remains applicable; these changes affect server cancellation limits.

## New evaluation guard only

`dispatch_guard_v2.py` extends the byte-preserved original reviewed guard, requires `dispatchGuardVersion: studio-request-replay-v2` and refuses an old/different manifest before mutating its ledger. A unique(slot,digest) index fences exact outbound repeats within one admitted run before another reservation. Slot identity still pins arm/case/attempt; identical bytes in distinct explicitly admitted runs remain separate. Concurrent duplicate losers cannot terminalize or stop their winner; unrelated identity/routing violations remain fatal. Ambiguous results keep unknown cost and consumed ownership across restart.

This guard is not connected to the original LIVE adapter, ledger or any new paid runtime. Future execution requires a new reviewed versioned manifest, adapter, ledger and explicit authorization. Original closed helpers and accounting remain unchanged.

## Verification and reviews

- Full Mastra: 3025 passed, 27 skipped, 255 passing files; skipped integration/smoke tests remain explicit. Isolated Studio PG 55458 was enabled.
- Manager focused: 8 passed, including 190,000 ms outer timeout and first caller reason.
- Budget/agent focused: 10 passed (seven fake-clock budget cases and three agent cases).
- New guard:seven local SQLite tests pass; no provider network.
- Both affected app typechecks, neutral contracts typecheck/14 tests and focused ESLint pass. Mastra and Manager builds pass. The first Manager build compiled and typechecked but lacked required MUX/OpenRouter environment fields at page collection; its failure is retained. The corrected build used inert build-only values, with no provider requests. Build logs are retained alongside this file.
- Independent Standards: no findings. Independent Spec: generation-timer-during-settlement P1 found, fixed and verified; no remaining findings. Review files preserve the original finding and resolution.

The feature remains in progress. Actual ElevenLabs and improved live creative acceptance are outstanding; closed paid batches remain closed.
