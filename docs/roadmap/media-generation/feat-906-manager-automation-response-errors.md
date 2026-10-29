---
id: "feat-906"
title: "Manager automation response errors"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Creating a source-subtitle automation at `/dashboard/agents` exposes an HTML-to-JSON parser error. The automation store still calls the removed CMS client; Admin currently has no enrichment automation storage or scheduler. Language validation and authentication can also throw outside the creation route's JSON error boundary.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/agents-page.tsx` — create, refresh, status and dry-run response handling.
2. `apps/manager/src/app/api/automations/route.ts` — JSON response boundary.
3. `apps/manager/src/features/agents/automation-store.ts` — retired CMS dependency and mock branch.
4. `apps/manager/src/cms/client.ts` — `RemovedCmsClientError`.

## Grep These

- `response.json|findMissingLanguageIds|authenticateRequest`
- `RemovedCmsClientError|enrichmentAutomations`

## What To Build

- Preserve actionable JSON responses when backend reads or authentication fail.
- Keep HTML error pages out of operator-facing parser messages.
- Identify the missing automation backend explicitly; preserve working mock behavior and track restoration in feat-907.
- Prevent Review launch from submitting while React changes the footer button.

## Constraints

- Do not restore Strapi dependencies or claim that saving alone restores scheduling.
- Do not deploy local worktree code directly to production.

## Verification

- Regression tests cover HTML responses and failed language validation reads.
- Manager typecheck, focused lint and formatting pass.
- Browser verification includes page-load evidence if rendering changes.

## Result

Creation/list authentication and backend errors return JSON. The client handles HTML and malformed responses and preserves structured validation errors. Review launch no longer submits; only the final create action sends a POST. Admin automation persistence, candidate selection and scheduling remain absent and are tracked in feat-907.

Verified: 69 focused tests across 14 files, Manager typecheck, touched-source ESLint, Prettier and browser failure/success smoke. Browser request counting proved zero POSTs on review and one on final create. Three warm dev navigations retained 22 initial resources; median load time changed from 61 ms to 57 ms. See `docs/solutions/integration-issues/manager-automation-html-errors-and-review-submit.md`.
