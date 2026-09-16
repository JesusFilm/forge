---
id: "feat-514"
title: "Dogfood RAG consumer access and seven-day migration"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-16"
duration: 7
depends_on: ["feat-513"]
blocks: ["feat-515"]
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

Execute plan sections D/E after access and reporting exist. Register Jaco's VM
integration or RAGBot and use the actual forge-rag-retrieve ops task over HTTP.
Record task path/revision and approved source/environment before execution.
Prove +3 then +2 request/success counts, last activity/window, second-consumer
isolation, revoked denial and no success increment, and honest coverage failures.
Support existing callers for seven days through registration. Disable legacy
shared bearer access afterwards only in separately approved production cutover
scope, with a named owner and exact timestamps. Verify embedding primary/fallback
configuration and capacity in that later authorized scope, without secrets.

## Constraints

No external consumers; future external access needs separate rate-limit design.
Heavy use is visibility-and-conversation only. No credentials in logs, tests,
command output, chat, tickets, PRs or telemetry. No production action is authorized
by the documentation PR. Read package guidance before implementation.

## Verification

Run the applicable plan acceptance criteria and package checks. Record synthetic
counts, coverage, revision and outcomes only. Portal work must also verify page
load performance, cross-consumer denial and concurrent manager/rotation behavior.
