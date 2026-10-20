---
title: Explicit subscription allowance reserve
status: completed
---

The owner authorized using all remaining included subscription allowance on
October 15. The existing 25% reserve has paused generation at 5,533 comparisons.

Add an optional local `minimumRemainingPercent: 0 | 25` setting, defaulting to 25.
Pass it through the account reader, catalog admission and per-call adapter so
the same threshold applies before every reservation. The read-only subscription
check accepts the same explicit setting. At zero remaining, unavailable meters,
credit-only billing or identity mismatch, continue to refuse new work. Preserve
full profiles, Astra, frozen inputs, usage receipts and graceful draining.

Verify default behavior, zero-reserve admission below 25%, exhaustion in either
applicable window, queued calls after depletion, invalid settings and CLI wiring.
Run scoped tests, typecheck, lint and formatting, then review and ship through
PR-to-main. Resume with a fresh attempt and audited existing checkpoints after
setting the local config to zero. Public activation remains separate.
