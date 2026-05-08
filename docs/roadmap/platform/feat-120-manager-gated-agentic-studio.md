---
id: "feat-120"
title: "Manager-Gated Agentic Studio"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-08"
duration: 2
depends_on:
  - "feat-115"
blocks:
  - "feat-121"
tags:
  - "manager"
  - "tooling"
  - "ai-pipeline"
---

## Problem

Mastra Studio exists as part of the Agentic runtime boundary, but operators need
to reach it through Manager without exposing a standalone public Railway URL or
browser-visible operator credential.

## Entry Points -- Read These First

1. `docs/plans/2026-05-08-001-feat-manager-gated-agentic-studio-plan.md`
2. `apps/manager/src/lib/auth.ts`
3. `apps/manager/src/config/env.ts`
4. `apps/manager/src/features/shell/manager-shell.tsx`
5. `apps/agentic/src/mastra/index.ts`
6. `apps/agentic/CLAUDE.md`

## Grep These

- `agentic-studio` in `apps/manager/src/` -- Manager page, proxy, tests, and shell entry
- `AGENTIC_STUDIO_ORIGIN|AGENTIC_OPERATOR_API_KEY` in `apps/manager/` -- server-only env and docs
- `MASTRA_STUDIO_BASE_PATH|mastra studio` in `apps/agentic/` -- private Studio service docs
- `AGENTIC_BASE_URL` in `apps/manager/src/lib/` -- runtime calls stay pointed at the Agentic backend, not Studio

## What To Build

1. Add `/dashboard/agentic-studio` for authenticated Manager users.
2. Add `/api/agentic-studio/[[...path]]` as a Manager-authenticated reverse
   proxy to the private `agentic-studio` service.
3. Keep `AGENTIC_OPERATOR_API_KEY` server-side and strip browser-supplied auth
   or forwarding headers.
4. Keep existing Manager runtime calls on `AGENTIC_BASE_URL`.
5. Document the private Railway Studio service and required smoke proof.

## Constraints

- Studio remains Agentic-owned; Manager only gates and proxies access.
- `agentic-studio` must not have a public domain in the primary path.
- `MANAGER_API_KEY` must not grant Studio access.
- Mutating proxy requests must fail closed without trusted same-origin evidence.

## Verification

- Red/Green tests cover proxy auth, header stripping, operator-token injection,
  config failure, same-origin checks, page rendering, and runtime-origin
  separation.
- Browser smoke proves logged-out redirect, logged-in Studio visibility,
  Manager-origin-only Studio traffic, and no browser-visible operator token.
- Railway readback proves `agentic-studio` has no public domain and Manager uses
  the private internal origin.
