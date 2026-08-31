---
id: "feat-378"
title: "Consent-aware recommendation profile"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 7
depends_on:
  - "feat-368"
  - "feat-369"
  - "feat-376"
blocks:
  - "feat-379"
  - "feat-380"
  - "feat-386"
  - "feat-392"
  - "feat-448"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "profiles"
  - "privacy"
---

## Problem

Anonymous viewers need useful session context immediately, while durable cross-visit personalization must remain consensual, resettable, and erasable.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U10 contract.
2. `apps/web/src/lib/`
3. `apps/web/src/components/`
4. `apps/admin/src/services/recommendations/`
5. `apps/admin/prisma/schema.prisma`

## Grep These

- `cookie|session|consent`
- `profile|personalization`
- `erase|delete|tombstone|privacyGeneration`

## What To Build

- Create a recommendation session identity by default and issue a secure pseudonymous durable identity only after the applicable personalization choice or consent.
- Implement explicit reset, withdrawal, deletion, expiration, authenticated export, and idempotent profile merge without copying evidence.
- On withdrawal or deletion, atomically tombstone the privacy generation, revoke identity, invalidate assignments/caches, and fence stale workers before asynchronous erasure.
- Add discoverable Watch controls and Admin privacy-health evidence for every lifecycle transition.

## Admin Evidence Gate

- Show consent/profile transitions, active and tombstoned generations, expiry, erasure propagation, failures, and stale-worker rejection.
- Prove session-only viewers receive contextual recommendations without an unapproved durable profile.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Use Secure, HttpOnly, SameSite pseudonymous identity; do not put profile identity in URLs or client-readable telemetry.
- Consent, personalization purpose, and authentication are separate concepts.
- No profile-derived generator can ship until the deletion drill passes.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test decline, grant, withdrawal, reset, expiration, fixation/substitution/stolen-cookie attempts, CSRF, concurrent merge, cross-account merge, stale workers, restore ordering, and non-relinkable audit facts.
- Test low-bandwidth, keyboard, and screen-reader behavior of viewer controls.
- Reconcile the full lifecycle and erasure deadline in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
