---
id: "feat-788"
title: "Rotate the portal GitHub runtime credential"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-10-27"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "security", "operations"]
---

## Problem

The incident runtime credential needs replacement and retirement. The replacement
now passes GitHub organization-access checks. Database rotation is separate and
already complete under feat-783.

## Entry Points — Read These First

1. `apps/rag/docs/ops/github-runtime-token-cutover.md` — live gates.
2. `apps/rag/scripts/serve.ts` — runtime credential wiring.
3. `apps/rag/src/serving/http/portal-github.ts` — admission requests.

## Grep These

`RAG_PORTAL_GITHUB_TOKEN`, `createGitHubAdmission`.

## What To Build

Execute the bounded runbook through PR-to-main and record redacted live evidence
in the incident tracker. This PR prepares deployment; it does not claim completion.

## Constraints

No manual redeploy, database changes, CI-token rotation, or OAuth-secret rotation.
No plaintext credential evidence. Preserve the old token until replacement
runtime and fresh portal verification pass, unless already revoked by the owner.

## Verification

Formatting, reviewed runbook, successful autodeployment, runtime credential match,
fresh portal sign-in, protected read, and old-token rejection.
