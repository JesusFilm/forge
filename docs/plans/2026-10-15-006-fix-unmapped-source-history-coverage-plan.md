---
title: "Preserve unavailable analytics for unmapped source routes"
type: fix
status: active
date: 2026-10-15
---

Production generation saved 3,884 comparisons and 73 finalized sources before
`readGaNavigationSnapshot` rejected `cmp76knit00ayny01kp9u44i8`. Its frozen slug
contains an uppercase segment, which the existing route mapper leaves unmapped.
A read-only replay reproduced `analytics_mapping_unverified` at the source-only
unique-route precondition. All 55 model calls in the stopped attempt have receipts.

Remove that premature source-only precondition. Continue reading the verified
capture and apply the existing per-row unique mapping checks. Unmapped and
ambiguous observations must remain unassigned, with null signals and honest
coverage counts. Keep the mapper, frozen identities, existing snapshot digests,
candidate lists, profiles and model unchanged. Do not manufacture analytics or
activate public traffic. This follows the existing coverage policy and the
requirement that absent historical exposure must not exclude suitable content.

Verify a sealed artifact with mapped, uppercase and ambiguous source routes;
assert no attributed source signals for the latter two, preserved candidate
signals, excluded navigation, recorded coverage, zero live GA calls and rejection
of a changed frozen route catalog. Replay production snapshots read-only against
the fix, including all remaining sources, and compare existing mapped results.
Run focused history/import/manual-runner tests, typecheck, lint and format; review
sequentially, merge through PR-to-main, then resume with a fresh attempt only
after confirming no live producer, unresolved new receipts or source leases.
