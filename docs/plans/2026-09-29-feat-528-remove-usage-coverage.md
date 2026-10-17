---
title: "Show recorded consumer usage without coverage machinery"
type: fix
status: complete
date: 2026-09-29
---

The product owner requires simple request/success counts per consumer and date
range, regardless of interruptions. The original coverage contract hid known
counts and required independent deployment inventory. Remove it throughout the
store, report contract, HTTP/CLI, browser, serving composition and operator commands.
Keep exact transactional increments, completion deduplication and least-privilege
reporting. Correct active plans/runbooks/roadmap/solution docs; mark historical
receipts as superseded without rewriting past operations.

Use an additive nullable legacy collector reference for rolling compatibility;
no destructive cleanup or direct production writes. Acceptance: the original
seven-day range returns and displays 5/5 without inventory, no coverage fields,
unchanged date inputs, honest read errors, and preserved counting/lifecycle rules.
Run meaningful DB/HTTP/browser regressions and all required package checks.

Verification and rollout limits are recorded in
[the local correction evidence](../roadmap/rag/evidence/feat-528/recorded-usage-verification.md).
