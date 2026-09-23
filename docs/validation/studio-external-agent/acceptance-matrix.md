# Qualification acceptance matrix

Code/test evidence and real-client evidence are separate gates. This matrix does
not mark a roadmap feature complete merely because its implementation exists.
Detailed observations and redacted identities are in [client-workflow.md](client-workflow.md)
and [client-proof.json](client-proof.json).

| Feature                         | Implemented and verified                                                                                                                                                                                                                                     | Remaining qualification / release boundary                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 542 — connect and discover      | Scoped OAuth/resource checks, discovery/resolution/history; actual Codex editing, same-session resume, expired synthetic bearer rejection and renewal.                                                                                                       | Real Claude; authenticated UI history observation; reachable-test OAuth consent/renewal rather than synthetic issuer credentials.                                                                                       |
| 543 — draft rendering           | Canonical leases and immutable preparation/retention; actual Codex creation, current and historical output identities, four successful real contained portrait renders.                                                                                      | Authenticated UI/approval observations; rebuilt renderer image and hosted release qualification remain separate.                                                                                                        |
| 544 — narration allowance       | Real Postgres atomic allowance/concurrency/receipt tests; actual Next after lifecycle; actual Codex initial and correction admissions plus new all-reusable admission at zero remaining allowance, with unchanged audio identity and no third provider call. | Provider dispatch was fake and speech was a tone. No paid billing or natural-voice quality qualification. Extra-pass UI has fixture/integration evidence, not authenticated operator execution.                         |
| 545 — sampled output inspection | Six bounded rendered fixtures plus actual Codex viewing eight JPEG samples per portrait handoff; immutable cache, timeout and coverage checks. Three handoffs took 52.260/34.026/37.116s after output readiness.                                             | Fourth explicit reuse probe took 60.992s using client-rollout timing while a bounded build ran concurrently. No production SLO, full-video watching or audio-listening claim.                                           |
| 546 — exact human review        | Exact historical output, stale/dirty guards and approval checks; matched fixture browser function/load measurements in ../studio-546/README.md; synthetic attributed human title preserved by actual Codex.                                                  | Authenticated operator review/direct correction/exact-render approval remains blocked after automatic approval review rejected synthetic sign-in. Fixture UI is not that proof.                                         |
| 547 — portable skill            | Shipped ZIP extracted outside checkout; actual MCP schema/operation-engine tests, production build and review; actual Codex broad brief, rendered handoff, feedback correction and audio reuse using final package bytes.                                    | Actual Claude installation/behavior is unobserved; no claim that both clients were tested.                                                                                                                              |
| 548 — both-client qualification | Guarded full-flow environment; four actual Codex handoffs, explicit modality limits, canonical attribution/budget/output evidence, independent reviews and release checklist.                                                                                | Real Claude, reachable-test OAuth, authenticated human approval and release image gates remain open. Actual read-only Codex HTTP download failed; MCP refresh/images worked and separate transport expiry probe passed. |

The approved fake-provider boundary allows deterministic provider evidence. It
does not authorize a paid call. The local fake narrator emits a tone; source
footage is a synthetic test pattern; existing music is a tone asset. Report pass
counts separately from dollar estimates. A `maxCostMicros:0` internal field or
fake character-cost header is not a zero-dollar spending promise.

The initial full-flow startup scanned the older guarded regression database
before the isolation requirement was noticed. It was stopped immediately. A
read-only check showed render job/lease/execution timestamps remained older than
that startup, with no successful enqueue/claim/dispatch. The harness now accepts
only its dedicated `forge_studio_548_qualification` database. No old records were
reset or deleted.
