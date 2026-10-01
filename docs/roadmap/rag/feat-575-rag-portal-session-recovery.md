---
id: "feat-575"
title: "Renew RAG portal sessions and restore the active section"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-30"
duration: 3
depends_on: []
blocks: []
tags: ["rag", "portal", "auth"]
---

## Problem

The portal's fixed two-hour session can expire while an operator is working.
The page appears ready until a protected request fails, then asks the operator
to click Continue with GitHub. When GitHub still has a browser session, that
click often only starts a quick OAuth round trip. The callback returns to
Consumers even if the operator was on Usage, Sources, or another section.

## Entry Points — Read These First

1. [Session recovery spec](../../plans/2026-09-30-rag-portal-session-recovery.md)
   — agreed behavior, decisions, stories, and test seams.
2. `apps/rag/src/serving/http/portal.ts`, `portal-github.ts`, and
   `portal-assets/portal.js` — authorization, OAuth callback, and section state.
3. `apps/rag/src/adapters/postgres/portal-sessions.ts`,
   `apps/rag/src/contracts/portal-sessions.ts`, and
   `apps/rag/prisma/migrations/20260924000000_portal_sessions/migration.sql`
   — durable session lifetime and restricted role.
4. `apps/rag/src/serving/http/portal-assets/usage.js` and `sources.js` —
   read-only views that must return to the selected section.
5. `apps/rag/portal/README.md` — admission policy and one-time key handling.

## Grep These

`createPortal`, `authorize`, `createSession`, `getSession`,
`__Host-rag_portal`, `showSection`, `signedOut`, `pagehide`, `oauth_states`.

## What To Build

Give portal sessions an eight-hour idle expiry and a 24-hour absolute limit
from OAuth sign-in. Renew the idle deadline on coalesced, genuine input in a
visible portal tab. Do not renew on passive polling, background activity, or
mere focus. Continue checking current merged allowlist admission and live
Forge repository permission on every protected action and renewal.

When a previously signed-in tab's session expires, automatically enter the
existing GitHub OAuth flow. Keep the last selected section in per-tab
`sessionStorage`; the callback may keep returning to `/portal`, whose client
restores the section. Restore a selected Usage UTC date range as nonsecret
view state. A missing or invalid section falls back to Consumers. Show a
brief restoring state, then a clear manual fallback if recovery fails.
Distinguish expiry, changed admission, and temporary service failure so a
denial or outage cannot cause an OAuth loop. Initial visits and explicit
sign-out do not automatically sign in.

Defer automatic navigation while a management mutation is in flight or a
one-time API key is displayed. Never replay a mutation after recovery.
Coordinate open tabs so sign-out remains intentional and simultaneous OAuth
attempts do not collide through the shared browser-binding cookie.

## Constraints

Keep the portal in the RAG bounded context, with no cross-app imports or
change to `/v1` consumer bearer authentication. Do not store API keys,
bearer values, OAuth values, corpus text, or mutation payloads in browser
storage or telemetry. The browser-storage exception is limited to nonsecret,
per-tab view state; update the portal guidance that currently says no browser
storage. Preserve secure HTTP-only cookies, no-store responses, CSRF
protections, current admission checks, and one-time key disposal rules.
Production deployment uses the normal PR-to-main flow.

## Verification

Use the existing local HTTPS portal browser suite for automatic recovery,
return to every section, Usage range retention, explicit sign-out, one-time
key display, mutation non-replay, multi-tab behavior, and failure fallback.
Use portal HTTP tests with pinned time for renewal, cookie and response
contracts, expiry versus admission denial or outage, and OAuth callback.
Extend isolated PostgreSQL session tests for the idle and absolute limits,
revocation, and restricted role grants. Check frontend page-load and request
cost because portal initialization and navigation change. Run touched-scope
format, lint, typecheck, dependency, and CI-sensitive checks. Keep test
artifacts free of credentials and issued keys.

## Resolution

Implemented in Forge [#2499](https://github.com/JesusFilm/forge/pull/2499).
