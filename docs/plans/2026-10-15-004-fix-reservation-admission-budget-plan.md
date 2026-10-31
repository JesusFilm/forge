---
title: "fix: Align reservation latency with the admission freshness budget"
type: fix
status: active
date: 2026-10-15
---

# Reservation latency within fresh admission

The paced four-call resume saved three results and 21 comparisons. A fourth
reservation committed after 19,177 ms while receipt transactions also ran. Admin
permits a 30-second transaction, but the local adapter stops waiting at 15 seconds.
It therefore left a pending reservation without spawning a provider process.
The three observed processes all completed; the attempt drained and closed.

## Scope

- Allow up to 45 seconds for a reservation, covering Admin's 30-second transaction
  and connection/response overhead. Keep the total identity/allowance freshness
  bound at 60 seconds by requiring both observations to be at most 15 seconds old
  immediately before reservation. No provider retry or model change.
- Reproduce a valid 20-second reservation failing before the fix, and prove it
  dispatches once afterward. Reject observations older than the remaining budget,
  and keep the late-response/no-spawn regression test beyond 45 seconds.
- Add only the sealed third no-dispatch incident to the existing explicit audit
  scope and migration check. Preserve the original pending row/null usage and
  all immutability checks. Test both members and the same-page continuation.
- Release live leases when a protocol-4 attempt closes only if every physical
  call in that attempt has terminal usage and a saved receipt. Keep leases for
  unresolved calls. The generation lock fences closure; replay of an older close
  must not alter a newer attempt's leases. Prove consecutive reviewed recoveries
  without fixture-only expiry writes.
- Ship through normal PR/main, acknowledge the proven no-dispatch reservation
  through Admin, recover the seven independently interrupted calls, and resume.

The observed cause is a deadline mismatch, not a provider failure. No new process
was spawned after the delayed reservation started. The previous serialization
fix prevented reservation-to-reservation contention; it did not remove valid
waiting behind concurrent receipt transactions sharing the generation lock.
