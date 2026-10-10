---
date: "2026-06-25"
topic: "chat-wire-seeker-route"
---

# Wire the Chat App to the Seeker Mastra Route

## Summary

Add feature-flagged backend wiring in `apps/chat` that proxies browser messages
to the internal `/forge-seeker` SSE route (shipped in feat-204) and streams
Seeker's grounded, source-cited answers into the existing chat UI. Default off:
when the flag is off the app keeps using today's client-side stub; when on,
trusted internal users can dogfood Seeker end-to-end. This is the chat-side
consumer only — no Mastra-side change.

## Problem Frame

`/forge-seeker` exists and streams the Seeker agent over a stable, bearer-gated
contract, but nothing consumes it. `apps/chat` still answers every message from a
synchronous client stub (`src/lib/chat-stub.ts` `buildStubReply`) — there is no
data layer, no agent connection, no backend at all (the app's CLAUDE.md lists
auth, a database, API routes, and env vars as "Intentionally Absent").

So Seeker can only be exercised through Mastra Studio, one tester at a time. The
team has no way to use Seeker as a _chat_ — multi-turn, in the real UI, judging
whether its answers are actually grounded in cited passages. This wiring closes
that gap for internal dogfooding without crossing the documented production gates
(safety/crisis guardrails, persisted memory, a public surface), which all stay
deferred.

## Key Decisions

- **Deployment-wide env flag, not per-user gating.** A single default-off flag in
  `apps/chat` selects Seeker vs the stub, mirroring Mastra's `SEEKER_ROUTE_ENABLED`.
  The flag is a convenience toggle, not a security boundary — there is no inbound
  gate today, only URL obscurity and a small trusted audience (see Dependencies).
  Real inbound auth is the prerequisite before the audience widens. Per-user
  targeting (e.g. LaunchDarkly) is a post-auth upgrade.

- **Server-to-server proxy holding the bearer.** Chat grows its first backend
  surface: a server route that holds the Mastra service bearer + base URL and
  relays the SSE stream. The bearer never reaches the browser. It mirrors admin's
  proven `streamMastraExperienceChat` relay (SSRF host allowlist before fetch,
  `redirect:"error"`, server-side `Authorization` header).

- **v1 uses the client conversation id as the `threadId`; no `resourceId`.** With
  no auth/no DB/no session, the browser's existing `Conversation.id` is sent as
  the Seeker `threadId`, and `resourceId` is omitted (the route supplies its own
  default). This is a conscious relaxation of the ticket's "server-mint, never
  forward a browser `threadId`" guidance, justified for the no-auth, no-URL,
  single-dogfooder phase (see Dependencies / Assumptions). It is re-plumbed
  (server-minted, `resourceId = userId`, owner-checked) when auth + persisted
  memory land.

- **Stream tokens live.** The UI renders the reply token-by-token (the route is
  SSE-only and the UI already has a pulse cursor + AI-SDK-aligned `Message`
  type). This reshapes the stub seam to an async streaming contract rather than
  the `Promise<string>` shape the chat CLAUDE.md sketched — done with the
  integration, not speculatively.

- **Render sources + grounded.** The cited passages and grounded flag the route
  returns are the core signal a dogfooder is evaluating, so v1 surfaces them
  rather than hiding them in logs.

## Requirements

### Feature flag and access

- R1. A default-off env flag in `apps/chat` selects the reply source. Off or unset
  → `buildStubReply` exactly as today; on → messages route to Seeker. Mirrors
  Mastra's `SEEKER_ROUTE_ENABLED` string-boolean convention.
- R2. The flag is deployment-wide for v1; there is no per-user targeting.

### Server-side proxy and bearer

- R3. A server-side route in `apps/chat` holds the Mastra service bearer and base
  URL and proxies browser messages to `POST /forge-seeker`. The bearer is never
  exposed to the browser.
- R4. The proxy mirrors admin's streaming relay: it checks the Mastra base host
  against an SSRF allowlist before fetching, sets `redirect:"error"`, and sends
  the bearer only in the server-side `Authorization` header.
- R5. The proxy is an unauthenticated same-origin endpoint with no v1 inbound
  access gate — the chat origin is world-reachable HTTPS, guarded only by URL
  obscurity and a small trusted audience (not a gate; see Dependencies). It
  therefore exposes the bearer-gated Seeker capability to any caller who can reach
  the chat origin, and
  applies no rate limit (each turn is a ~90s paid generation, so an open proxy is
  a cost-amplification surface). An inbound auth gate and a per-caller rate or
  concurrency cap are hard prerequisites before any public exposure — tracked with
  the auth deferral.

### Conversation identity

- R6. v1 sends the browser's existing client conversation id (`Conversation.id`)
  as the Seeker `threadId`. `resourceId` is omitted; the route applies its
  constant default.
- R7. The same conversation id yields the same `threadId` across turns so Seeker
  can recall earlier turns within a session. This is contingent on the route's
  memory contract holding (see Dependencies / Assumptions); if it does not hold,
  behavior ranges from clean per-turn statelessness to a first-turn error on a
  never-created thread — resolved by the contingency note below.

### Streaming and rendering

- R8. Between send and the first token, the conversation shows a distinct
  waiting/thinking state (e.g. the existing pulse cursor on an empty assistant
  turn) so a multi-second first-token wait reads as in-progress, not hung.
- R9. The proxy relays the route's `token_delta` frames to the browser as they
  arrive; the assistant message renders token-by-token.
- R10. The terminal `result` frame completes the turn, carrying the final text plus
  `sources` and `grounded`.
- R11. The reply seam (`src/lib/chat-stub.ts`) is reshaped to a streaming async
  contract (token callback + terminal result). The synchronous timer/throw
  assertions in `src/components/shell/app-shell.test.tsx` are reworked alongside.

### Sources and grounding display

- R12. The assistant message renders a compact sources list (linked
  title/`sourceName`) plus a grounded/ungrounded indicator, read from the terminal
  `result`. `sources` and `grounded` are added as optional fields on the `Message`
  type in `src/lib/conversations.ts` so display stays a pure view concern. Source
  `url`/`title`/`snippet` are untrusted (RAG-corpus-originated): rendered links
  enforce an `https:`-only scheme allowlist with `rel="noopener noreferrer"`, and
  all source text renders as text, never HTML.
- R13. When `sources` is empty, the UI renders an explicit "no sources cited" state
  rather than a blank container, and a `grounded` answer carrying no citations is
  surfaced as its own signal — not rendered identically to a cited answer (the
  grounding signal is the point of the dogfood).

### Failure and timeout handling

- R14. Reply failures are surfaced to the user as a visible failure (an
  assistant/error turn or per-conversation error state). The composer is never
  re-enabled without a visible failure shown.
- R15. The proxy→Mastra call is bounded by an outbound timeout that is strictly
  greater than the route's 90s `chatTurn` ceiling (so a route-side timeout returns
  a clean `timeout` rather than being misclassified as a network error) and
  strictly below the browser/platform connection ceiling (so the clean timeout
  reaches the user rather than a transport abort). This window assumes the platform
  connection ceiling exceeds 90s — confirm before committing AE4's guarantee; if it
  does not, lower the route's ceiling or map an over-budget turn to a transport-abort
  failure (R16).
- R16. User-facing messaging distinguishes timeout, generation failure, and
  config/unavailable, mapped from the route's fixed-vocabulary `error` reasons and
  the transport outcome.
- R17. A mid-stream failure after partial tokens keeps the streamed text, appends
  an error notice, and releases the per-conversation send-lock.
- R18. The per-conversation pending/double-send guard in
  `src/lib/use-conversations.ts` releases the slot across the full stream
  lifecycle: terminal result, error, timeout, and caller disconnect.

### Config

- R19. `apps/chat` gains its first validated env surface (an `env.ts` scaffold):
  Mastra base URL, service bearer, the enable flag, the SSRF host allowlist, and
  the outbound timeout. All are required only when the flag is on; default-off mode
  introduces no new env-var prerequisite, so unprovisioned deploys still boot.

### Engine attribution

- R20. When the flag is on, each assistant turn is attributable to its engine (the
  terminal `result` carries `producedBy`), so a Seeker answer — including a
  legitimately ungrounded one (R13) — is never visually confusable with a stub
  answer, and a conversation never silently mixes stub and Seeker turns. The
  mechanism (a per-message engine marker vs. a reset-on-flip rule) is a planning
  choice; without it the grounding verdict the dogfood exists to produce is
  corrupted at the source.

## Key Flows

- F1. Seeker turn (flag on, happy path)
  - **Trigger:** User sends a message while the flag is on.
  - **Steps:** Browser posts `{ text, conversationId }` to the chat proxy → proxy
    sends `{ prompt, threadId: conversationId }` to `/forge-seeker` with the bearer
    → relays `token_delta` frames, which render token-by-token → terminal `result`
    renders the final text, sources list, and grounded indicator.
  - **Covers:** R1, R3, R4, R6, R7, R8, R9, R10, R12, R20.

- F2. Stub turn (flag off)
  - **Trigger:** User sends a message while the flag is off or unset.
  - **Steps:** `send()` routes to `buildStubReply` exactly as today; no Mastra
    call, no new env required.
  - **Covers:** R1, R19.

- F3. Failure / timeout
  - **Trigger:** Missing/invalid bearer, model-key-missing, generation error,
    route timeout, or caller disconnect.
  - **Steps:** The proxy maps the route's `error` reason or transport outcome to a
    user-facing failure; a mid-stream failure keeps already-streamed text and
    appends the notice; the send-lock is released in every case.
  - **Covers:** R14, R15, R16, R17, R18.

## Acceptance Examples

- AE1. Covers R1. **Given** the flag is off, **when** a user sends a message,
  **then** the stub reply renders and no request reaches Mastra.
- AE2. Covers R9, R10, R12. **Given** the flag is on and a valid turn, **when**
  Seeker generates, **then** the user sees tokens stream in, followed by the final
  text with a sources list and a grounded indicator.
- AE3. Covers R7. **Given** two turns in the same conversation, **when** the second
  is sent, **then** Seeker can recall context from the first (same `threadId`).
  Contingent on the memory contract (Dependencies / Assumptions); waived under the
  stateless fallback.
- AE4. Covers R15, R16. **Given** generation exceeds the route's 90s ceiling,
  **when** the route emits its `timeout` error, **then** the user sees a timeout
  message — not a generic network error — because the outbound budget outlasts the
  route's. Contingent on a non-empty timeout window (see R15).
- AE5. Covers R17. **Given** an error frame arrives after some tokens already
  rendered, **then** the partial text is retained, an error notice is appended, and
  the composer re-enables.
- AE6. Covers R14. **Given** Mastra returns 401, **when** the proxy receives it,
  **then** the user sees a failure message rather than a silently re-enabled
  composer.
- AE7. Covers R13. **Given** a `result` frame whose `sources` array is empty,
  **then** the message shows an explicit "no sources cited" state, and a
  `grounded` answer with no citations is visibly distinct from a cited answer.
- AE8. Covers R20. **Given** the flag is on, **when** Seeker answers, **then** the
  turn is identifiable as Seeker-produced (not the stub), and a conversation never
  shows unmarked stub and Seeker turns side by side.

## Success Criteria

The dogfood is a decision-producing experiment, not just working wiring. It
answers one question: **is Seeker's grounding good enough to justify investing in
the auth + guardrail work toward a public surface?** Trusted internal users
exercise Seeker through the real chat UI, judge whether answers are backed by the
cited passages, and that verdict feeds the go/no-go on the deferred production
gates. "Done" means the team can reach that judgment — not merely that tokens
stream. Who dogfoods, over what window, and who owns acting on the verdict are
named at planning.

## Scope Boundaries

Deferred (not v1) — each captured as a follow-on stub ticket:

- **Chat auth** — unlocks `resourceId = userId`, per-user flag targeting
  (LaunchDarkly), and the server-minted/owner-checked `threadId` re-plumb.
- **Postgres-persisted Seeker memory + conversation persistence** — durable,
  listable, restorable threads (the sidebar of past conversations). v1 memory is
  Mastra's in-memory store (lost on Mastra restart) and client history resets on
  browser refresh.
- **Per-conversation URLs** — deep-linkable, restorable conversations; depends on
  both chat auth and Postgres memory.
- **Capturing the grounding verdict** — a thumbs/note/export of
  `{ prompt, answer, sources, grounded, verdict }`. Deferred: in v1 dogfooders
  record notable judgments manually (e.g. paste into a shared doc), since memory is
  ephemeral and there's no capture affordance. A lightweight in-app capture is the
  natural follow-up. Named so the gap is a choice, not an oversight.

Out of scope for this work entirely:

- Any Mastra-side change — `/forge-seeker` shipped in feat-204; this is the
  consumer.
- The `apps/mastra-gateway` browser-facing path — server-to-server bearer is the
  chosen model (per feat-204), not a stepping stone.
- Safety/crisis guardrails — a Mastra-side release gate. The v1 interim mitigation
  is the flag plus URL obscurity and a small trusted audience (not an access
  boundary — see Dependencies), not these guardrails.

## Dependencies / Assumptions

- `/forge-seeker` must be deployed with `SEEKER_ROUTE_ENABLED="true"` and a
  provisioned `MASTRA_SERVICE_API_KEYS` value before chat can reach it.
  Receiver-first deploy ordering: enable the route + key on Mastra, then point the
  chat proxy at it.
- Chat's backend reaches `@forge/mastra` over Railway's private network (Mastra has
  no public domain).
- **The v1 interim mitigation is URL obscurity plus a small trusted audience — not
  an access boundary.** The chat origin is already world-reachable HTTPS (an
  unadvertised Railway-generated domain, no `jesusfilm.org` DNS, no Cloudflare, no
  auth); obscurity is the absence of a gate, not a gate. So the revisit trigger is
  "reachable by anyone outside the trusted dogfood group" — not "gains a public
  domain"; reachability already exists. Real inbound auth (R5) and the guardrail
  gate are prerequisites before the audience widens at all.
- **The threadId scheme assumes no per-conversation URL in v1.** Adding a URL
  before auth would place the memory key in a shareable link — revisit the identity
  decision if that changes.
- **In v1, Mastra's thread-owner check is inert, so the unguessable UUID is the
  sole confidentiality barrier between conversations.** Mastra keys a thread to its
  owning `resourceId` and errors (rather than leaking) on a cross-owner query — but
  every v1 thread shares the route's one default `resourceId`, so that check cannot
  isolate conversations. The only thing separating them is the conversation id
  being an unguessable `crypto.randomUUID`, plus a single trusted audience and
  ephemeral non-sensitive memory. Unguessability only resists _guessing_: because
  the proxy is unauthenticated (R5) and forwards the client `threadId` verbatim
  with no format or ownership check, anyone who _obtains_ a thread id (screen-share,
  devtools, logs, a referrer) can replay that conversation. Thread-id
  confidentiality — not just unguessability — is therefore a pre-public
  prerequisite alongside R5's inbound auth gate. Genuine per-user isolation arrives
  post-auth via `resourceId = userId`, at which point the owner-check actually fires.
- **Multi-turn recall (R7/AE3) is contingent on an unverified upstream contract,
  and the failure mode may be a crash, not graceful degradation.** feat-204 named
  the `agent.stream(...)` per-thread memory keying as its key technical risk, with
  three possible outcomes: (a) keying works → multi-turn recall; (b) keying is
  ignored but a never-created thread is tolerated → clean per-turn statelessness;
  (c) recall on a never-created thread _throws_ → the first turn of every new
  conversation errors unless the route or the chat proxy creates the thread first.
  feat-204's memory tests point at (c) as a real risk, so "stateless fallback" is
  only safe under (b). Planning must verify which holds and assign thread-creation
  ownership. Note also that the browser's `Conversation.id` and Mastra's in-memory
  store have independent lifetimes: a Mastra restart drops the thread while the
  browser keeps sending the same `threadId`, re-triggering the uncreated-thread
  path mid-conversation. Under any fallback the route still earns its keep as a
  stable bearer-gated contract.

## Outstanding Questions

Resolve early in planning:

- Verify the route's `agent.stream(...)` per-thread memory contract before locking
  the seam shape (R7/AE3): not just "does keying work" but "does recall on a
  never-created thread throw" (outcome (c) in Dependencies). Assign thread-creation
  ownership (route vs chat proxy) if it does. If keying can't be made to work, the
  fallback is stateless dogfooding — confirm single-turn Seeker still answers the
  dogfood's grounding question rather than just waiving AE3.

Deferred to planning:

- The exact error-reason → user-message mapping and the concrete outbound timeout
  value within R15's two-sided bound (confirm the platform connection ceiling is
  above 90s so the window is non-empty).
- Proxy transport shape (App Router route handler streaming SSE to the browser vs a
  streamed-fetch/`ReadableStream` relay) and where the SSE parser lives (admin's
  `readSseStream` is a reference).
- The precise sources-list layout, grounded/ungrounded prominence, and mid-stream
  error-notice placement within the Vigil design tokens.
- Final env var names.

No product-shape items block planning; the memory-contract verification above is
the one technical risk to resolve early.

## Sources / Research

- `apps/mastra/src/mastra/agents/seeker-route.ts` — the `/forge-seeker` handler:
  body contract, `token_delta`/`result`/`error` frames, 90s budget, default-off
  gate, `sources[]` allowlist, `resourceId` default behavior.
- `apps/admin/src/services/experience-ai/mastra-experience-chat-client.ts` — the
  proven browser→admin→Mastra SSE relay to mirror (SSRF allowlist, `redirect:"error"`,
  timeout composition, discriminated result).
- `apps/chat/src/lib/chat-stub.ts`, `use-conversations.ts`, `conversations.ts` —
  the reply seam, the per-conversation pending/double-send guard, and the `Message`
  type the swap extends.
- `apps/chat/CLAUDE.md` — "Intentionally Absent" list, the "Eventual Mastra
  Connection" undecided-path note this work settles, and the three deferred
  hardening acceptance criteria (R11, R14, R15 here).
- `docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md` —
  feat-204's scope boundaries, the consuming-app responsibilities, and the
  client-budget-greater-than-90s residual.
- Mastra memory docs (threads/resources, owner validation):
  `https://mastra.ai/docs/memory/threads-and-resources`.
