---
id: "feat-515"
title: "Deliver internal RAG consumer self-service portal"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-16"
duration: 5
depends_on: ["feat-511", "feat-514"]
blocks: []
tags: ["rag", "auth", "observability"]
---

## Problem

Access and reporting need an independently tracked operational proof and usable
internal management path; planning completion does not deliver either.

## Entry Points — Read These First

1. [Plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md).
2. `apps/rag/src/serving/http/auth.ts` and `app.ts` — HTTP boundary.
3. `apps/auth/src/auth/config.ts` — reference only, not proof of deployed GitHub login.

## Grep These

`forge-rag-retrieve`, `TokenRegistry`, `owners`, `FallbackEmbedder`.

## What To Build

Implement plan section F after successful dogfood. GitHub login identifies the
engineer; the current merged per-consumer `owners` list authorizes management
and key regeneration. A non-owner submits a normal PR adding their handle and
waits for merge. Registration and owner edits use repository PRs, never immediate
portal grants. No senior/specific approver or global engineer/email allowlist.

Confirm host/client registration, stable GitHub identity binding and trusted
merged-revision publication before coding. Provide owner-scoped status/audit and
Generate new key with secure verifier-only persistence, one-time display and
immediate invalidation of the previous key. Reports remain Jaco/RAGBot-only.

## Constraints

No external consumers; future external access needs separate rate-limit design.
Heavy use is visibility-and-conversation only. No credentials in logs, tests,
command output, chat, tickets, PRs or telemetry. No production action is authorized
by the documentation PR. Read package guidance before implementation.

## Verification

Run the applicable plan acceptance criteria and package checks. Record synthetic
counts, coverage, revision and outcomes only. Portal work must also verify page
load performance, cross-consumer denial and concurrent owner/rotation behavior. Test non-owner denial, PR-before/after-merge, removed-owner sessions, stale registry denial, last-owner protection and audit records.
