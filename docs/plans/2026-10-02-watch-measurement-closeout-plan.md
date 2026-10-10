---
title: Watch measurement closeout
type: chore
status: completed
date: 2026-10-02
---

# Watch measurement closeout

## Scope

Reconcile `docs/roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md`
and `docs/roadmap/content-discovery/feat-564-cached-watch-public-navigation-authority.md`
against current main, the deployed September 29 receipts, and the October 2
delivery policy. Preserve existing ISR, exact browser anchor resolution, signed
source authority, privacy, and Watch analytics.

## Decision and work

1. Verify renderer parity, signed issuance, and Admin evidence in code and
   existing receipts. Exercise the focused tests on current main.
2. Classify unknown denominators separately from incorrect counts and server
   failures. An ambiguous relative authored link produces no signed served fact;
   it must remain unknown unless an origin-owned, cache-safe public path is
   available. Determine whether exhaustive coverage is still required to
   operate recommendations or measure the exercised Watch surfaces.
3. Close both tickets with path-specific, evidence-backed dispositions. Preserve
   the delivered instrumentation and Admin inspection. Record any unmeasured
   benefit or unresolved reliability evidence without claiming a new production
   observation. Make a runtime change only for a reproduced correctness or
   reliability defect.
4. Run roadmap lint, Markdown formatting, and relevant focused checks. Review
   the diff, then open a scoped PR for the parent to integrate.

## Boundaries

No request-specific headers or cookies on `force-static` routes, browser-authored
served slates, production fault injection, direct deployment, or changes to the
global recommendation policy and parent closeout report.
