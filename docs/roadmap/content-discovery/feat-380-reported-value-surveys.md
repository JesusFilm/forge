---
id: "feat-380"
title: "Reported-value surveys"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 5
depends_on:
  - "feat-369"
  - "feat-372"
  - "feat-376"
  - "feat-378"
  - "feat-379"
blocks:
  - "feat-392"
  - "feat-395"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "surveys"
  - "privacy"
---

## Problem

Behavioral proxies need respectful calibration against reported value without interrupting viewing or overgeneralizing from responders.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U13 contract.
2. `apps/web/src/components/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/workflows/`
5. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `survey|feedback|dismiss`
- `sampling|frequency cap|propensity`
- `reported value`

## What To Build

- Add versioned survey assignment and structured localized response records linked to eligible episodes.
- Implement bounded sampling, frequency caps, dismiss and never-ask controls, and an accessible non-modal Watch prompt.
- Report assignment propensity, non-response, latency, cohort balance, and proxy calibration separately.
- Record a survey-signal readiness decision; no survey response becomes a live rank feature from this ticket.

## Admin Evidence Gate

- Show assignments, responses, non-response, dismissal, never-ask, latency, propensity, cohort balance, and proxy-calibration comparisons.
- Show negative responses and short mission-valued watches without filtering them as abuse or forcing one quality label.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Do not collect unrestricted sensitive free text by default.
- Survey participation is optional and never blocks playback.
- Small cohorts are suppressed; responder evidence is not generalized without propensity and uncertainty reporting.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test dismissal, no response, never-ask, frequency caps, short mission-valued watch, negative response, locale fallback, withdrawal, machine exclusion, keyboard use, and screen-reader use.
- Test privacy, retention, cohort suppression, sampling, and propensity calculations.
- Reconcile assignment-to-response and proxy calibration in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
