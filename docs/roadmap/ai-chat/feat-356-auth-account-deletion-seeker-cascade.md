---
id: "feat-356"
title: "apps/auth account-deletion cascade to the Seeker stores"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-01"
duration: 3
depends_on:
  - "feat-337"
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

Deleting a Jesus Film account today does **not** delete that person's Seeker
data. `apps/auth`'s `beforeDelete` hook revokes the Apple credential and
erases admin watch progress, then drops the user row — and nothing tells
Mastra. The person's Seeker threads (`ai_chat` Postgres, keyed
`user:<auth user.id>`) and their Langfuse traces (same value in `userId`)
survive and age out over ≤25 days under the feat-208 / feat-336 retention
windows.

Two things make that worse than a slow deletion:

1. **The mobile copy already promises otherwise.**
   `apps/mobile/src/components/profile/DeleteAccountFlow.tsx` says "This
   permanently deletes your Jesus Film account everywhere". Deliberately not
   softened (owner decision 2026-08-11) — but it is registered as a
   release-gating item in feat-339, and this ticket is the other way to
   resolve it.
2. **Deletion destroys the key.** Once the auth `user` row is gone the `sub`
   is unrecoverable, so a LATER subject-erasure request for that person
   cannot be serviced at all: nothing can turn their email into the
   `user:<sub>` the Seeker stores are keyed by, and completion cannot be
   confirmed to the requester. The data can only age out. Cascading AT
   deletion time is the only moment the key still exists.

Deferred out of feat-337 (owner decision 2026-08-11, KD9): that ticket is
the OPERATOR capability for an inbound erasure request. This one is
user-initiated deletion through a different door, and its hard part is a
contract mismatch — see below. The gap it leaves is bounded at 25 days for a
tiny allowlisted audience, which is why deferring was acceptable.

Also unresolved and worth deciding here: **a chat-only user has no
self-serve deletion path at all.** `apps/chat` exposes no delete-account
surface; the deletion entry point lives in `apps/mobile`. Someone who only
ever used the Seeker must email an operator.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/ai-chat-erasure.ts` (feat-337) — the reusable
   seam this ticket builds on. `previewAiChatErasure` /
   `executeAiChatErasure` return typed INDEPENDENT per-store outcomes
   (`postgres` and `langfuse`); consume those, never the CLI's exit codes.
2. `apps/auth/src/services/account-deletion.service.ts` — the hook to
   extend. Read its header comment in full: it states the strict
   prove-or-abort posture and its rationale, and the ordering rule (side
   effects run BEFORE the user row is deleted; any failure aborts the
   deletion with the account intact).
3. `apps/auth/src/auth/config.ts` — where `buildAccountDeletionHooks` is
   wired and how its deps (`getAdminErasureConfig`, `getAppleConfig`) are
   supplied.
4. `apps/mastra/CLAUDE.md` → "Operator erasure runbook (subject-erasure
   requests)" (feat-337) — the
   accepted limitations this cascade does and does not close, and the
   erasure key contract.
5. `docs/plans/2026-08-11-003-feat-per-user-erasure-capability-plan.md` —
   feat-337's plan; KD9/KD10 and KTD2 are the decisions this ticket inherits.
6. `docs/solutions/best-practices/single-upstream-predicate-bounding-irreversible-blast-radius-20260812.md`
   — the safety rules feat-337 PR 1 earned, and the ones a network-callable
   cascade must re-derive rather than inherit: the client-side re-check pair,
   and (critically for this ticket) the fact that a confirm token must pin
   every axis the operation is parameterized by. A cascade has no operator
   confirm step at all, so decide explicitly what plays that role.

## Grep These

- `eraseAdminWatchData` in `apps/auth` — the existing side effect whose
  shape the Seeker cascade should mirror (bearer, timeout, typed abort).
- `account_deletion_admin_erasure_skipped` — the config-absent skip log line
  that IS the posture to match (see Constraints).
- `AccountDeletionSideEffectError` — the abort type; a Seeker cascade that
  throws this blocks account deletion.
- `previewAiChatErasure|executeAiChatErasure` in `apps/mastra` — the seam.
- `SEEKER_DEFAULT_RESOURCE_ID` in `apps/mastra/src/mastra/ai-chat-thread-ownership.ts`
  — the shared fallback key the erasure module refuses; unreachable by any
  cascade.

## What To Build

A Mastra-side surface that wraps the feat-337 functions, plus an
`apps/auth` side effect that calls it. `apps/auth` cannot import
`apps/mastra` source, so the seam is HTTP — but the SHAPE of that surface is
deliberately left open here (a `/forge-*` service route on the ai-chat lane
bearer is the obvious candidate; decide it in this ticket, not before).

**Recorded design lean — best-effort for BOTH stores (owner, 2026-08-11,
feat-337 KD10; the final call belongs to this ticket).** Both Seeker stores
self-clean within 25 days once activity stops, so strictness buys only
"immediately vs within 25 days" — not worth a Mastra outage blocking a
person's account deletion. `apps/auth` already carries exactly one blocking
dependency (admin watch-progress erasure); adding a second doubles the
surface on which an unrelated service outage traps a user who is trying to
leave.

The mechanical reason strictness is hard, not merely unattractive: auth's
hook contract is **prove-or-abort**, and Langfuse deletion cannot be proven.
It is ~15 minutes asynchronous with no completion receipt (feat-336), so the
best a synchronous call can return is "deletes submitted" — which is not
proof. A strict cascade would either abort on something that in fact
succeeded, or claim a proof it does not have.

If the lean is accepted, the cascade must still be OBSERVABLE — a failed
best-effort cascade that no one ever sees is indistinguishable from no
cascade at all. Decide what carries that signal (enum-only log line at
minimum; feat-339 separately asks whether a durable erasure record is needed
before public release).

**Key discipline across the app boundary.** The Seeker resource key is
`"user:" + auth user.id` verbatim — the chat OAuth client is not pairwise,
so the ID token `sub` IS the raw `user.id` and no join is needed. A future
pairwise flip (`OauthClient.subjectType`) would silently invalidate that
mapping; whatever builds this should assert the assumption rather than
inherit it.

## Constraints

- **Match the config-absent skip carve-out, do not invent a new posture.**
  `eraseAdminWatchData` treats absent erasure config as a SKIP (logged), not
  a failure — an unprovisioned environment must still be able to delete
  accounts. The Seeker cascade behaves identically: no Mastra config →
  logged skip → deletion proceeds.
- **Reuse the feat-337 module; do not re-implement erasure.** The whole
  point of `ai-chat-erasure.ts` returning typed per-store outcomes (KTD2) is
  that this caller consumes them. No second deletion path, no SQL.
- **`anon:*` resources are out of reach by design.** A cascade can only ever
  erase the `user:<sub>` key; a person's pre-sign-in `anon:<uuid>` turns
  cannot be linked to an account by any query. Retention is their only
  deletion path — say so wherever this ticket's completion is claimed.
- **The shared `seeker-dogfood` fallback resource is never erasable.** The
  module refuses that exact key (feat-337 R2), and a cascade must not try to
  work around it.
- **Never claim per-PERSON completion.** A subject's Seeker data may span
  several resourceIds; a cascade covers exactly one key.
- Keep the Mastra-side surface off any public network path and on the
  dedicated ai-chat lane bearer, per the lane's existing auth rules.

## Verification

- Unit (`apps/auth`): absent Mastra config → the deletion completes with a
  skip log and NO cascade attempt; a cascade failure under the accepted lean
  → the deletion still completes, with a loud enum-only line; the cascade
  runs BEFORE the user row is deleted (ordering, mirroring the existing side
  effects).
- Unit (`apps/mastra`): the surface refuses the shared fallback key and any
  non-`user:` resource; it consumes the module's typed outcomes and never
  reports a Langfuse "submitted" result as proven deletion.
- Cross-app: one end-to-end run against a throwaway auth account proving the
  `user:<user.id>` key derivation is byte-correct — the assumption most
  likely to be wrong, and silently.
- Re-read feat-339's register items on erasure records, the mobile copy, and
  this cascade; update whichever this ticket resolves.
