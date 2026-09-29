---
id: "feat-529"
title: "Dogfood RAG consumer access and seven-day migration"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-09-16"
duration: 7
depends_on: ["feat-528", "feat-530"]
blocks: []
tags: ["rag", "auth", "observability"]
---

## Problem

Access and reporting need an independently tracked operational proof and usable
internal management path; planning completion does not deliver either.

## Entry Points — Read These First

1. [Plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md).
2. `apps/rag/src/serving/http/auth.ts` and `app.ts` — HTTP boundary.
3. Programme plan section A — GitHub allowlist admission and runtime consumer ownership.

## Grep These

`forge-rag-retrieve`, `TokenRegistry`, `owners`, `FallbackEmbedder`.

## What To Build

Execute plan sections D/E after access and reporting exist. Register RAGBot first through the feat-530 portal UI: sign in as an allowlisted
owner, create the consumer, then save its one-time key directly in
the approved receiver secret manager. Record the UI journey without capturing
the secret. Do not create or seed the dogfood consumer through SQL, CLI or an
API-only setup
and use the actual forge-rag-retrieve ops task over HTTP.
Record task path/revision and approved source scope and receiver before execution.
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
load performance, cross-consumer denial and concurrent owner/rotation behavior.

## Production role provisioning audit — 2026-09-29

The usage schema deployed with feat-528 already existed. Jaco authorized usage
activation in the Ops session; the operator created three restricted PostgreSQL
login roles, granted their explicit privileges and saved three service connection
entries in the operational vault. This changed role/ACL security metadata, not
application rows or table/view/column definitions. Railway settings and deployment
inventory were not changed. Portal/model/HTTP retrieval is confirmed for consumer
`1547b524-ad60-4cf7-ac67-930b9715dc4e` (`ragbot`, owner `jaco-brink`).

The [retrospective audit](evidence/feat-529/production-usage-role-provisioning.md)
records exact statements, credential receiver names, privilege verification and
remaining activation work. The audit PR does not execute provisioning again or
claim full feat-529 completion. It changes no personal consumer-key custody.

## Production report coverage recovery — 2026-09-29

The [inventory and collector recovery audit](evidence/feat-529/production-usage-coverage-recovery.md)
records three independently sourced deployment inventory intervals and
reconciliation of two confirmed-stopped collectors. The existing aggregate
reader proved five recorded requests/successes for `[03:41,03:42)` UTC with
complete coverage and unchanged counts. Uninstrumented history and uncertain
shutdown intervals remain unavailable. This is actual aggregate proof, not
completion of the staged +3/+2, lifecycle, isolation or migration/cutoff criteria.
Independent inventory must be maintained on subsequent deployments.

The later 2026-09-29 product correction removes coverage/inventory as a reporting
requirement. The recovery above is historical audit evidence only. Recorded
counts must be visible for the original consumer/date range without interruptions
causing suppression; no ongoing inventory upkeep or collector-stop proof is needed.
