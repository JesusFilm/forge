---
id: "feat-530"
title: "Deliver internal RAG consumer self-service portal"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-16"
duration: 5
depends_on: ["feat-526", "feat-529"]
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

Implement plan section F after successful dogfood. GitHub OAuth admits only
signed-in handles in the current merged portal-user allowlist. Show all consumers;
only their runtime owners may manage them. CI validates allowlist handles against
Forge contributor/read-write access as safely verifiable, not consumer memberships.

Create consumer directly: globally unique lowercase letters/numbers/dashes name
(`^[a-z0-9-]+$`), own signed-in GitHub handle read-only as initial owner, preview,
then submit. The backend creates the record/owner and random secret, displaying
plaintext once with copy/password-manager warning. Never persist or re-reveal it.
Generate new key atomically replaces the verifier and invalidates the old secret.

Only an existing owner can Add member from the predetermined portal-user allowlist.
Added members can manage/regenerate. Preserve at least one owner, audit, revocation
and removal/session semantics. No consumer-registration or owner-change PRs.
Reports remain Jaco/RAGBot-only; consumer membership grants no report access.

## Constraints

No external consumers or implicit quotas. No secrets in logs, tests, command
output, chat, PRs or telemetry. Preserve hashing/HTTPS and no-store secret displays.
No production action is authorized. J021 is an isolated prototype: allowlist,
durable sessions, live OAuth app registration and Railway deployment remain unproven.

## Verification

Run plan E and package checks plus page-load performance. Test allowlist
before/after merge, stale publication and removed-user sessions; all-consumer
visibility with cross-consumer mutation denial; invalid/duplicate/concurrent names;
initial-owner tampering; preview/submit; owner-only Add member with allowlist
selection; last-owner protection; concurrent removal/rotation and secret-response
loss. Record synthetic outcomes only. Read package guidance before coding.
