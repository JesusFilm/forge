---
title: "Audit production usage inventory and collector recovery"
type: docs
status: complete
date: 2026-09-29
---

Diagnose the portal's unavailable usage totals through the existing read-only
report adapter. Record the already-authorized deployment inventory setup and
documented recovery of independently confirmed stopped collectors. Prove the
five stored retrieval successes become a complete closed-minute report, then
prove a fresh completed minute on the live deployment. Preserve unknown history
and record exact metadata writes, independent deployment evidence and receipts.

This PR is a retrospective audit, not an executable migration or production
authorization. It changes no serving code, variables or credentials. Feat-529
remains in progress; remaining lifecycle/isolation/migration proofs and ongoing
deployment inventory maintenance are not claimed complete.

Validation: reproduce the unavailable report, compare unchanged request/success
totals after inventory/reconciliation, verify a fresh closed-minute report and
the unavailable seven-day history, inspect safe receipts and relative links,
then run changed-file formatting and hidden-roadmap checks. No new application
regression test is needed for a configuration-only recovery; the production
read-only report probe is the acceptance signal.

Later product direction removed coverage/inventory as a design mistake. This
retrospective record preserves past writes, not an ongoing setup/upkeep requirement.
