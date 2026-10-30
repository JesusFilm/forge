# Resume known rejected recommendation pages

Scope: feat-590, producer-only recovery of an unapplied model response with a terminal usage receipt. Public activation remains separate.

## Evidence

Generation `production-astra-catalog-20261013-v6` stopped at 4,927/55,700 comparisons, 89 finalized sources. Attempt `85b638ff-93ec-4304-ae4b-ad944a68a2f6` closed after 148 successful calls and one `rejected` / `edge_invalid` call: `f0df096c-fefd-4026-af74-2c6cd7100ca0`. Its input/output usage is 33,701/602 tokens, with a receipt digest and finish time; no pending calls were created by this attempt. The older seven unknown receipts remain unchanged.

`manual-subscription-catalog.ts:sourceProgress` rejects every historical `rejected_unapplied` member. `runEdgeBatch` saves a terminal rejection then throws, stopping unrelated work. Admin already supports a fresh call at the unadvanced page; its database constraint requires usage and a receipt for every non-pending call. Applied ranks alone advance the checkpoint.

## Change

Permit terminal `rejected` members with a finish time and no applied revision to coexist with subsequent valid pages. Allow at most two rejected calls at one source/page across restarts (one retry). A live retry requires a fresh status read proving the exact dispatched call is terminal rejected and unapplied for every affected source; a new UUID goes through all normal admission checks. Preserve existing unknown, failed, stale, recovery, frozen-catalog and usage-floor guards. Do not retry explicit reviewed-recovery IDs. Do not weaken output validation, shorten profiles, change the model or rewrite receipts.

## Verification

Reproduce a rejection followed by a valid result, a process restart after rejection, repeated rejection exhausting the durable bound, failed/unknown/stale receipt refusal, and successful-page resume despite an older rejection. Assert distinct call IDs, immutable original receipt, no repeated applied ranks, refreshed admission, and existing concurrency/drain behavior. Run focused executor/manual/client tests, typecheck, ESLint and formatting; review sequentially per AGENTS.md. Ship through PR-to-main, then audit production and prepare a fresh exclusive launch intent.

## Limits

The rejected answer itself was not retained, so the exact invalid field is unknown. This fixes recovery from a normal validation rejection without claiming to diagnose its content. Further rejection at the same page stops for investigation. The subscription currently has 30% weekly remaining against the owner-approved 25% floor.
