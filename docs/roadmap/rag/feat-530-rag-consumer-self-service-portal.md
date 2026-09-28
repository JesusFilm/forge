---
id: "feat-530"
title: "Deliver internal RAG consumer self-service portal"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-16"
duration: 5
depends_on: ["feat-526", "feat-527"]
blocks: ["feat-529"]
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

Implement the management portion of plan section F immediately after the access
backend. Develop on a local branch against a local database and verify through
the actual UI. Reporting views can follow feat-528; dogfood follows the usable
management flow. GitHub OAuth admits only
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

V1 has one runtime environment per consumer and no staging environment. The
portal has no environment picker, environment creation or environment-scoped
routes. Generate new key replaces the consumer's single active credential.

## Constraints

No external consumers or implicit quotas. No secrets in logs, tests, command
output, chat, PRs or telemetry. Preserve hashing/HTTPS and no-store secret displays.
No production action is authorized. Portal admission and production login proof
are already delivered; use the actual feat-527 backend. Development identities
and seed data must remain local, with no production auth bypass or CI fixture setup.

## Verification

Use the local UI to complete deferred feat-527 end-to-end verification.
Run relevant plan E and package checks plus page-load performance. Test allowlist
before/after merge, stale publication and removed-user sessions; all-consumer
visibility with cross-consumer mutation denial; invalid/duplicate/concurrent names;
initial-owner tampering; preview/submit; owner-only Add member with allowlist
selection; last-owner protection; concurrent removal/rotation and secret-response
loss. Record synthetic outcomes only. Read package guidance before coding.
