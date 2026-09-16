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
3. `apps/auth/src/auth/config.ts` — existing provider integration.

## Grep These

`forge-rag-retrieve`, `TokenRegistry`, `email_verified`, `FallbackEmbedder`.

## What To Build

Refine and implement plan section F after successful dogfood. Design is captured
now for expected Bible lookup demand. The later
[feat-518 discovery decisions](evidence/feat-518/consumer-access-discovery.md)
supersede the original Google recommendation: use GitHub authentication with
account ID and verified email matching the same active allowlist entry. Confirm
per-environment host/client registration during implementation. Enforce the
repository allowlist and audited multi-manager authorization; Jaco alone recovers.
PR review policy belongs to feat-512: any valid non-author approval only for
registry/schema changes, with option-B enforcement gap tracked there. Do not
add senior-only or general portal/RAG PR approval requirements.
Provide register, membership, scope/status and Generate new key flows with
hash-only persistence and one-time display. Reports remain Jaco/RAGBot-only.

## Constraints

No external consumers; future external access needs separate rate-limit design.
Heavy use is visibility-and-conversation only. No credentials in logs, tests,
command output, chat, tickets, PRs or telemetry. No production action is authorized
by the documentation PR. Read package guidance before implementation.

## Verification

Run the applicable plan acceptance criteria and package checks. Record synthetic
counts, coverage, revision and outcomes only. Portal work must also verify page
load performance, cross-consumer denial and concurrent manager/rotation behavior.
