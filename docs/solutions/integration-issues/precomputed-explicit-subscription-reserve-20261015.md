---
module: Precomputed recommendations
date: 2026-10-15
problem_type: integration_issue
component: local_operator
tags: [recommendations, codex, subscription, allowance]
---

The owner authorized spending the remaining included subscription allowance
after the generation paused at its 25% reserve. That reserve existed independently
in the account reader, catalog startup and per-call adapter. Changing only one
layer would leave the run paused or make its preflight misleading.

An explicit local `minimumRemainingPercent: 0 | 25` option now flows through all
three boundaries, with 25 as the unchanged default. The read-only preflight also
accepts `--minimum-remaining-percent 0`. Zero remaining in either applicable
window, unknown allowance, credit-only billing and identity failures still stop
new reservations. Queued calls read current allowance after waiting.

Tests exercise admission at 25% and 1%, refusal at zero in both window types,
depletion while queued, unchanged defaults, credit-only refusal and the real
preflight command against a fake read-only RPC server. This policy changes no
generation identity, content, model, receipt or public activation state. Resume
with a fresh attempt rather than repeating a dispatched launch intent.
