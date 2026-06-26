---
id: "feat-205"
title: "Wire chat app to the Seeker Mastra route"
owner: "jian wei"
priority: "P1"
status: "in-progress"
start_date: "2026-06-27"
duration: 3
depends_on:
  - "feat-204"
blocks:
  - "feat-207"
  - "feat-208"
tags:
  - "web"
  - "ai-pipeline"
---

## Problem

feat-204 shipped `POST /forge-seeker` — an internal, bearer-gated SSE route that
streams `seekerAgent`. The chat app (`apps/chat`) still answers every message from
a synchronous client stub (`src/lib/chat-stub.ts` `buildStubReply`); it has no
backend, no agent connection, and no env vars. So Seeker can only be exercised one
tester at a time through Mastra Studio — the team can't use it as a real chat to
judge whether its answers are grounded in cited passages.

This wires `apps/chat` to call `/forge-seeker` behind a default-off flag so
dev/product can dogfood Seeker end-to-end, internally, without crossing the
production release gates (safety/crisis guardrails, persisted memory, a public
surface). Full requirements + decisions:
`docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md` (R1–R20).

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md` — the
   brainstorm. R1–R20, flows, acceptance examples, and the accepted-risk framing
   all live here. Read its Dependencies / Assumptions and Outstanding Questions
   before writing code.
2. `apps/mastra/src/mastra/agents/seeker-route.ts` — the route this consumes.
   Body `{ prompt, threadId, resourceId? }`; frames `token_delta {text}` →
   `result {text, sources, grounded, producedBy}` → `error {reason}` (fixed-vocab
   `timeout`|`generation_failed`|`model_key_missing`); 90s budget; default-off via
   `SEEKER_ROUTE_ENABLED`. The source wire shape is `{ sourceName, title|null, url,
score, snippet }`.
3. `apps/admin/src/services/experience-ai/mastra-experience-chat-client.ts` — the
   proven browser→admin→Mastra SSE relay to mirror: `readSseStream` parser, SSRF
   host allowlist before fetch, `redirect:"error"`, `AbortSignal.timeout` composed
   with the caller signal, discriminated `{ ok, reason }` result.
4. `apps/chat/src/lib/chat-stub.ts` — the seam this replaces (`buildStubReply`,
   `STUB_REPLY_DELAY_MS`). Synchronous + never-failing today.
5. `apps/chat/src/lib/use-conversations.ts` — the per-conversation pending +
   double-send guard + `try/finally` slot release (the reply timing lives here, not
   in the stub). Reshaping to streaming changes its async model.
6. `apps/chat/src/lib/conversations.ts` — the `Message` type (`id`/`role`/`content`,
   AI-SDK-aligned) the swap extends with optional `sources`/`grounded`/engine fields;
   `Conversation.id` (`crypto.randomUUID()`) becomes the `threadId`.
7. `apps/chat/CLAUDE.md` — "Intentionally Absent" (no auth/DB/API routes/env vars),
   the "Eventual Mastra Connection" undecided-path note this settles, and the three
   deferred hardening acceptance criteria.

## Grep These

- `SEEKER_ROUTE_ENABLED` (mastra) — the route's own default-off gate; the chat flag
  is a second, independent gate.
- `handleSeekerRouteRequest` / `SEEKER_DEFAULT_RESOURCE_ID` in `seeker-route.ts` —
  the contract + why `resourceId` can be omitted.
- `buildStubReply` / `STUB_REPLY_DELAY_MS` in `apps/chat/src/lib/` — the seam +
  timing to replace.
- `readSseStream` / `streamMastraExperienceChat` / `hostAllowed` in admin — the
  relay + SSRF pattern to mirror.
- `MASTRA_SERVICE_API_KEYS` (mastra) / `MASTRA_CHAT_*` (admin) — the bearer + env
  shape the chat proxy mirrors.
- `producedBy` in `seeker-route.ts` — the field that drives engine attribution (R20).

## What To Build

A feature-flagged backend in `apps/chat` that proxies browser messages to
`/forge-seeker` and streams the reply into the existing UI. Group the work by the
brainstorm's requirement clusters:

- **Feature flag + config (R1, R2, R19).** A default-off env flag selects Seeker
  vs `buildStubReply` (mirror Mastra's `SEEKER_ROUTE_ENABLED` string-boolean).
  Add `apps/chat`'s first `env.ts` scaffold (Mastra base URL, service bearer, the
  flag, SSRF host allowlist, outbound timeout) — all required only when the flag is
  on, so default-off deploys boot with no new env.
- **Server-side SSE proxy (R3, R4, R5).** A route handler holds the bearer + base
  URL server-side (never the browser), checks the Mastra host against an SSRF
  allowlist before fetch, sets `redirect:"error"`. v1 has no inbound auth gate and
  no rate limit — document this in code as an accepted risk; the chat origin is
  world-reachable HTTPS, so the only thing limiting reach is URL obscurity + a
  small trusted audience (not an access gate; see brainstorm Dependencies).
- **Conversation identity (R6, R7).** Forward the browser's `Conversation.id` as
  the `threadId`; omit `resourceId`. **Verify the route's `agent.stream(...)`
  per-thread memory contract FIRST** — feat-204 flags that recall on a never-created
  thread can throw; if it does, decide thread-creation ownership or fall back to
  stateless per-turn.
- **Streaming render (R8–R11).** Show a pre-first-token waiting state; relay
  `token_delta` frames to render token-by-token; complete on the terminal `result`.
  Reshape `chat-stub.ts` into an async streaming seam (token callback + terminal
  result) and rework the synchronous timer/throw assertions in
  `app-shell.test.tsx` alongside.
- **Sources + grounding (R12, R13).** Render a compact sources list + grounded
  indicator from `result` (add optional `Message` fields); render an explicit
  "no sources cited" state for empty `sources`; treat source `url`/`title`/`snippet`
  as untrusted (https-only link allowlist, `rel="noopener noreferrer"`, text not HTML).
- **Failure handling (R14–R18).** Surface every failure visibly (never silently
  re-enable the composer); bound the outbound call with a timeout in R15's two-sided
  window; map `error` reasons + transport outcomes to distinct messages; keep
  partial text on a mid-stream error; release the per-conversation slot across the
  full stream lifecycle.
- **Engine attribution (R20).** When the flag is on, mark each assistant turn as
  Seeker-produced (from `producedBy`) so a Seeker answer is never confusable with a
  stub answer, and a conversation never silently mixes stub + Seeker turns.

## Constraints

- **Internal dogfooding only.** Do not widen Seeker's audience beyond the trusted
  dogfood group until the guardrail gate is met. The v1 boundary is URL obscurity +
  a small audience — not an access gate (see brainstorm Dependencies). Real inbound
  auth + a rate/concurrency cap are prerequisites before any public reachability.
- **Server-to-server only.** Bearer stays server-side; no CORS, no browser-direct
  path. Do not adopt the `apps/mastra-gateway` path — settled in feat-204.
- **No Mastra-side change.** `/forge-seeker` shipped in feat-204; this is the
  consumer. Do not relocate any Mastra responsibility here.
- **Verify the memory contract before locking the seam.** R7/AE3 are contingent;
  don't assume multi-turn recall works.
- **Outbound timeout > 90s** (the route's ceiling) so a route timeout isn't
  misclassified as a network error — AND below the platform connection ceiling;
  confirm that ceiling is >90s or the clean-timeout guarantee doesn't hold.
- **threadId is throwaway.** v1 forwards the browser `conversationId` as `threadId`
  (a conscious relaxation, safe only while there is no per-conversation URL and the
  audience stays the small trusted dogfood group — the origin is world-reachable, so
  obscurity is not a gate). It is re-plumbed server-side + user-bound when auth lands.

## Verification

- `pnpm --filter @forge/chat test` — flag-off uses the stub with no Mastra call
  (AE1); flag-on streams `token_delta` then renders text + sources + grounded
  (AE2); same-conversation recall when the memory contract holds (AE3, contingent);
  timeout surfaces a distinct message (AE4); mid-stream error keeps partial text +
  re-enables composer (AE5); 401 surfaces a failure, not a silent re-enable (AE6);
  empty `sources` renders "no sources cited" (AE7); Seeker turns are attributable
  vs stub (AE8).
- `pnpm --filter @forge/chat typecheck && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat build`.
- Confirm default-off mode introduces no required-at-boot env var.
- Manually probe the `agent.stream(...)` memory contract (recall on a fresh thread)
  before finalizing the seam shape.
- Browser-verify (per `apps/chat`'s chromium rule) on port 3200: flag on, stream a
  turn, confirm sources render and a failure path shows a visible error.
