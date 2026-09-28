---
title: "RAG consumer portal before operational dogfood"
type: feat
status: in-progress
date: 2026-09-28
---

# Scope

Build feat-530 management on the feat-527 HTTP backend. Delivery order is
feat-527 → feat-530 management → feat-528 usage/reporting → feat-529 operational
dogfood. Register RAGBot through the portal UI in feat-529; API-only setup is not
onboarding evidence. Backend HTTP/DB tests still verify authorization and races.

## Implementation

- Serve lightweight HTML, CSS and deferred browser JavaScript from the existing
  Hono `/portal`; no additional frontend runtime or cross-app imports.
- Preserve `/portal/identity` as protected JSON proof. The HTML shell provides
  GitHub sign-in and a safe unavailable state, without embedding identity/secrets.
- Reuse authenticated consumer routes for every mutation. Add a protected
  allowlist directory for member selection; mutation still checks live eligibility.
- Create: name validation, immutable initial owner, direct Create submission, no
  automatic retries. Render issued key in a disposable dialog only. Clear on
  dismiss, sign-out, pagehide and persisted-page restoration; no storage/telemetry.
- Owner controls: members, versioned add/remove and rotation, state confirmation.
  Conflicts refresh versions and require a new explicit action. Network failure
  after issuance explains recovery by refresh/rotation; never automatically retry.
- Local launcher uses loopback HTTPS, synthetic OAuth identities and a dedicated
  local database. It composes the real session/access/auth adapters. Production
  composition has no development switch.

## Verification

Run RAG typecheck, lint, dependency rules and HTTP regression tests. Exercise
creation, member management, key loss/rotation and cross-consumer denial
through the actual local UI backed by PostgreSQL. Measure navigation and static
asset bytes/request count. Capture no credentials in screenshots or evidence.
Keep live admission removal/restart/outage and operational migration gates open
until observed in their authorized scope.

## First slice delivered locally

See [verification evidence](../roadmap/rag/evidence/feat-530/local-ui.md).
The management flow, separate local launcher and repeatable browser suite are
implemented. Reporting, actual ops dogfood and remaining live admission checks
retain their existing gates; feat-530 stays in progress.
