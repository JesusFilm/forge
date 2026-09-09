---
title: Remove redundant recommendation evidence counters
type: refactor
status: active
date: 2026-09-09
---

The owner requested removing the optional Redis evidence collector if it adds no
value to recommendations or durable analytics. Its only reader is the extra Admin
transport panel. PostgreSQL owns playback facts, receipts, outcomes and profile
decisions; the existing Railway/Datadog logs already carry transport observations.

## Scope and decisions

- Simplify Web and Admin observers to runtime-allowlisted, exception-isolated
  logging. Preserve the event format and every transport observation call site.
- Remove the counter writer, connection lifecycle, optional collector URL, Admin
  counter reader/panel, Redis-only tests and collector-unavailable monitor/widget.
- Keep other Redis uses, all playback transport fixes, PostgreSQL evidence,
  authorization, reconciliation heartbeats and fail-closed ranking policy intact.
- Update feat-464's visibility requirement: operational outcomes are inspected in
  Datadog; durable evidence and the current-pointer audit remain in authorized
  Admin. The production canary and integrity gates remain outstanding.

## Validation

- Run Web/Admin observer privacy and logger-failure tests, route/recorder and
  reconciliation regressions, and Admin dashboard authorization/render tests.
- Run full Web/Admin unit suites, lint, typechecks and repository format checks.
- Verify the Admin page has no collector read or additional client bundle and
  inspect its rendered dashboard. Retain timing evidence for the changed page.
- Review the final diff and document the architectural learning before shipping.
- After the normal PR-to-main deployment, check normalized transport observations,
  crawler rejections and reconciliation cadence; verify collector-failure messages
  stop on the new revision. Missing traffic is unknown, never a passing gate.

Roadmap: `docs/roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md`
