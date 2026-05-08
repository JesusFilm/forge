---
id: "feat-121"
title: "Agentic Studio Frame Isolation Hardening"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-05-11"
duration: 2
depends_on:
  - "feat-120"
blocks: []
tags:
  - "manager"
  - "tooling"
  - "security"
---

## Problem

The first Manager-gated Agentic Studio slice uses a same-origin iframe so Studio
can make authenticated calls through `/api/agentic-studio`. That is the
functional path for Manager session cookies and same-origin mutation checks, but
it means Studio JavaScript runs as a Manager-origin document.

Harden the frame model so a compromised or unexpectedly permissive Studio
bundle cannot use the Manager session outside the Studio proxy boundary.

## Entry Points -- Read These First

1. `apps/manager/src/app/dashboard/agentic-studio/page.tsx`
2. `apps/manager/src/lib/agentic-studio-proxy.ts`
3. `apps/manager/src/lib/auth.ts`
4. `docs/plans/2026-05-08-001-feat-manager-gated-agentic-studio-plan.md`

## Grep These

- `sandbox=\"allow-scripts allow-same-origin` in `apps/manager/src/app/dashboard/agentic-studio/page.tsx`
- `isTrustedBrowserOrigin` in `apps/manager/src/lib/agentic-studio-proxy.ts`
- `content-security-policy` in `apps/manager/src/lib/agentic-studio-proxy.ts`
- `strapi-jwt` in `apps/manager/src/`

## What To Build

1. Choose a stricter isolation model for Studio-in-Manager:
   - opaque sandbox plus frame-scoped proxy token, or
   - same-origin iframe plus proven browser-enforced path restrictions and
     parent-frame isolation.
2. Keep the browser-visible token scoped to `/api/agentic-studio` only if a
   token model is chosen; never expose `AGENTIC_OPERATOR_API_KEY`.
3. Add browser proof that Studio can perform a read and mutating API call
   through `/api/agentic-studio`, but cannot call non-Studio Manager APIs.
4. Keep the Manager login guard as the outer gate.

## Constraints

- Do not make `agentic-studio` publicly reachable.
- Do not allow `MANAGER_API_KEY` or the operator key in the browser.
- Do not relax Manager API auth globally to accommodate Studio.

## Verification

- Unit tests cover the selected isolation/token contract.
- Browser smoke proves Studio traffic stays inside `/api/agentic-studio` and
  non-Studio Manager API calls fail from the Studio frame.
- Existing Agentic runtime calls still use `AGENTIC_BASE_URL`.
