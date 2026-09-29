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
isolation, revoked denial and no success increment, and recorded counts across interruptions.
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
counts, windows, revision and outcomes only. Portal work must also verify page
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

## Usage reporting correction — 2026-09-29

The product owner removed coverage/inventory requirements as a design mistake.
Reporting returns recorded requests and successes for the selected consumer and
unchanged date range, regardless of interruptions. Deployment declarations,
collector-stop recovery and narrowed diagnostic windows are not prerequisites
for dogfood reporting. See the corrected feat-528 plan and operator runbook.
Historical provisioning receipts remain audit records, not setup instructions.
The +3/+2, isolation, lifecycle and separately approved grace/cutoff checks remain.
