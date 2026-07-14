---
title: "Local smoke recipes: signed-in, gate-granted chat + seeded Mastra history with zero external deps"
date: 2026-07-14
category: developer-experience
module: apps/chat + apps/mastra
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Locally verifying signed-in or gate-granted chat flows without running apps/auth"
  - "Seeding server-side conversation history in apps/mastra without a model API key"
  - "Smoke-testing history hydration/replay against a MASTRA_STORAGE_BACKEND=memory run"
  - "Minting a chat session cookie by hand for browser-driven verification"
symptoms:
  - "Setting only CHAT_SESSION_SECRET silently renders the anonymous page because page.tsx reads identity only when chatAuthConfigured() is true"
  - "Exercising the history read path needs real threads/messages, but generating them via the send path requires a model key and a live generation"
related_components:
  - authentication
  - tooling
tags:
  [
    chat,
    mastra,
    seeker,
    local-dev,
    smoke-testing,
    session-cookie,
    seeker-gate,
    mastra-memory-api,
    feat-241,
  ]
---

# Local smoke recipes: signed-in, gate-granted chat + seeded Mastra history with zero external deps

## Context

feat-241 gave signed-in, gate-granted users their persisted Seeker conversations
back: the chat sidebar hydrates from Mastra's history routes and replays
transcripts. Exercising that flow end-to-end normally needs three external
dependencies: a running `apps/auth` (to sign in), Postgres (for the `ai_chat`
schema), and a model key (to generate conversations worth listing). The feat-241
session proved a shortcut that needs none of them:

1. **Hand-mint the chat session cookie** — chat's session IS a signed HS256 JWT
   (no database, no server-side session store), so a locally-signed token with
   the right claims is indistinguishable from one produced by a real OAuth
   callback.
2. **Seed server-side threads through Mastra's built-in memory API** — the
   `mastra dev` server exposes unauthenticated `/api/memory/*` routes that write
   into the exact same shared `Memory` instance the seeker agent and the
   feat-241 history routes use, so seeded rows show up in the sidebar without a
   single model call.

Both recipes were proven working end-to-end in the feat-241 session. Every
mechanism below is re-verified against the tree (pinned versions:
`mastra@1.10.0`, `@mastra/core@1.36.0`, `@mastra/server@1.36.0`); the exact
wire responses of the memory API are marked "per this session's usage" where
only the session, not the dist, is the evidence.

`apps/chat/CLAUDE.md` ("Development") already documents the _real_ dogfood
path: copy `.env.example` → `.env.local`, set `SEEKER_CHAT_ENABLED=true` + the
Mastra base URL/bearer + `AI_CHAT_MASTRA_API_KEY`, configure chat auth against
a local `apps/auth`, and sign in with a verified-email session on the
allowlist. This doc ADDS the two substitutions that remove the external
dependencies — it does not repeat the parts CLAUDE.md covers.

## Guidance

### Recipe 1 — a signed-in, gate-granted session without `apps/auth`

**The gate you must satisfy first.** `page.tsx` reads identity ONLY when
`chatAuthConfigured()` is true, and that function requires FOUR env vars
(`apps/chat/src/config/env.ts:182-189`):

```ts
export function chatAuthConfigured(): boolean {
  return (
    env.AUTH_ISSUER_URL !== undefined &&
    env.AUTH_CHAT_CLIENT_ID !== undefined &&
    isValidChatBaseUrl(env.CHAT_BASE_URL) &&
    isRealSessionSecret(env.CHAT_SESSION_SECRET)
  )
}
```

- `AUTH_ISSUER_URL` and `AUTH_CHAT_CLIENT_ID` are **presence-checked only**
  here — they are never dereferenced until you actually start an OAuth flow at
  `/api/auth/login`. Dummy non-empty values are fine as long as you never click
  "Sign in".
- `CHAT_BASE_URL` must parse as an absolute `http(s)` URL
  (`isValidChatBaseUrl`, `env.ts:164-172`) — `http://localhost:3200` works.
- `CHAT_SESSION_SECRET` must be a REAL secret: `isRealSessionSecret`
  (`env.ts:149-155`) rejects an absent value, the exact `.env.example`
  placeholder (`CHAT_SESSION_SECRET_PLACEHOLDER`, `env.ts:25-26`), and anything
  under 32 chars (`MIN_SESSION_SECRET_LENGTH = 32`, `env.ts:28`).

**The trap this recipe exists to record:** setting ONLY `CHAT_SESSION_SECRET`
silently renders the anonymous page. `apps/chat/src/app/page.tsx:24-27` reads
identity conditionally:

```ts
const authConfigured = chatAuthConfigured()
const identity = authConfigured ? await getChatIdentity() : null
```

No error, no log line — your perfectly-signed cookie is simply never read. The
seeker gate then resolves with `identity === null` → `seekerEnabled=false`
(anonymous short-circuit, `apps/chat/src/lib/seeker-gate.ts:78-80`), and
history hydration never fires either — `useConversations` guards the fetch on
the `seekerEnabled` prop (`apps/chat/src/lib/use-conversations.ts:409-414`).
The symptom is a "why is my cookie ignored" dead end with zero diagnostics.
Set all four vars.

**What the cookie reader accepts.** The session cookie is read by
`readChatSessionCookie` (`apps/chat/src/auth/session-cookie.ts:73-106`):

- Cookie name: `` CHAT_SESSION_COOKIE = `${prefix}_session` ``
  (`session-cookie.ts:41-42`) where the prefix defaults to
  `DEFAULT_CHAT_AUTH_COOKIE_PREFIX = "forge_chat"` (`env.ts:29`,
  `chatAuthCookiePrefix()` `env.ts:192-194`). With `AUTH_COOKIE_PREFIX` unset,
  the runtime cookie name is **`forge_chat_session`**.
- Verification: `jwtVerify(value, key, { algorithms: ["HS256"] })`
  (`session-cookie.ts:80-82`), keyed on
  `new TextEncoder().encode(CHAT_SESSION_SECRET)` (`session-cookie.ts:158-164`).
  jose validates `exp` when present (an expired token → catch → `null` →
  anonymous); no issuer/audience is checked.
- Claim requirements: `sub` must be a non-empty string
  (`session-cookie.ts:86-88`); `email`/`name`/`picture` must be strings to
  survive; `emailVerified` must be a **strict boolean**
  (`session-cookie.ts:98-101`) — anything else reads as `undefined`, which the
  gate treats as unverified.
- The seeker gate then requires `emailVerified === true` AND a non-empty
  `email` (`seeker-gate.ts:84-88`) AND membership of the normalized
  (trim+lowercase) email in the `SEEKER_ALLOWED_EMAILS` CSV
  (`seeker-gate.ts:91`, `isSeekerEmailAllowed` `env.ts:122-130`) — with the
  `SEEKER_CHAT_ENABLED` kill switch checked before everything
  (`seeker-gate.ts:70-74`).

**Mint the token** (jose is a direct dependency of apps/chat —
`apps/chat/package.json`). Use the SAME secret as `.env.local`:

```bash
cd apps/chat && CHAT_SESSION_SECRET='<same 32+ char value as .env.local>' \
node --input-type=module -e '
import { SignJWT } from "jose"
const jwt = await new SignJWT({
  sub: "local-dev-sub",
  email: "you@example.org",   // must be in SEEKER_ALLOWED_EMAILS
  emailVerified: true,         // strict boolean — "true" the string fails the gate
  name: "Local Dev",
})
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime("8h")
  .sign(new TextEncoder().encode(process.env.CHAT_SESSION_SECRET))
console.log(jwt)
'
```

Then in the browser console on `http://localhost:3200`:

```js
document.cookie = "forge_chat_session=<paste-jwt-here>; path=/"
```

Reload — the account row renders signed-in and (with the rest of the env
below) the gate grants. Cookie-attribute notes: the server writes this cookie
`HttpOnly` (`chatSessionCookieOptions`, `session-cookie.ts:109-118`), but
HttpOnly only blocks JS _reads_ — JS can freely SET a non-HttpOnly cookie of
the same name, and both the page reader (`getChatIdentity` via `next/headers`
`cookies()`, `apps/chat/src/auth/identity.ts:25-28`) and the history proxies
(raw `Cookie` header via `readChatSessionCookie`,
`apps/chat/src/app/api/history/list/route.ts:24-27`) read the header value
without caring how it was set. `Secure` is production-only
(`session-cookie.ts:113`), so plain-http localhost is fine; a JWT is URL-safe
base64 + dots, so no encoding gymnastics are needed.

**Full chat-side env for the gated stack** (`.env.local` in `apps/chat/`;
`.env.example` documents each var):

```bash
SEEKER_CHAT_ENABLED=true
SEEKER_MASTRA_BASE_URL=http://localhost:4111
SEEKER_MASTRA_API_KEY=local-mastra-service-key      # in Mastra's MASTRA_SERVICE_API_KEYS
AI_CHAT_MASTRA_API_KEY=local-ai-chat-lane-key       # in Mastra's AI_CHAT_SERVICE_API_KEYS (feat-241 history lane)
AUTH_ISSUER_URL=http://localhost:9999/dummy          # presence-checked only
AUTH_CHAT_CLIENT_ID=local-dummy-client               # presence-checked only
CHAT_BASE_URL=http://localhost:3200
CHAT_SESSION_SECRET=<real random 32+ chars — NOT the .env.example placeholder>
SEEKER_ALLOWED_EMAILS=you@example.org                # the minted email
```

See `apps/chat/CLAUDE.md` "Development" for what each of the seeker/history
vars does — this recipe changes only the auth trio + the minted cookie.

### Recipe 2 — seed server-side history without a model key

**Boot Mastra with in-memory storage and no model key.**
`MASTRA_STORAGE_BACKEND` is a `z.enum(["postgres", "memory"])` defaulting to
postgres (`apps/mastra/src/config/env.ts:218`); `memory` selects an
`InMemoryStore` for runtime storage
(`apps/mastra/src/mastra/index.ts:133-140`). The ai-chat lane follows it:
`resolveAiChatMemoryBackend()` is `AI_CHAT_MEMORY_BACKEND ?? MASTRA_STORAGE_BACKEND`
(`env.ts:793-794`), and `buildAiChatMemory` builds on an `InMemoryStore` under
the `memory` backend (`apps/mastra/src/mastra/memory.ts:160-165`). No model
key is needed to boot: `assertMastraRuntimeEnv` returns early outside
production (`env.ts:698`) — the model-key requirement lives in the
production-only `missing` list. What IS asserted in EVERY environment
(`env.ts:684-687`): `AI_CHAT_SERVICE_API_KEYS` and `MASTRA_SERVICE_API_KEYS`
must not share a key value — you cannot reuse `local-mastra-service-key` for
both CSVs locally; boot throws.

```bash
MASTRA_STORAGE_BACKEND=memory \
SEEKER_ROUTE_ENABLED=true \
MASTRA_SERVICE_API_KEYS=local-mastra-service-key \
AI_CHAT_SERVICE_API_KEYS=local-ai-chat-lane-key \
pnpm --filter @forge/mastra dev            # port 4111
```

`SEEKER_ROUTE_ENABLED=true` (`env.ts:768-770`) is required for BOTH the send
path (`/forge-seeker` 404s without it) and the feat-241 history routes (their
gate ladder checks the same flag first — see `apps/mastra/CLAUDE.md`
"ai-chat history read surface (feat-241)"). `OPENROUTER_API_KEY` remains
optional: without it real Seeker sends degrade and LLM titling is a benign
no-op (`memory.ts:119-127`) — irrelevant when you seed threads directly.

**Why seeded rows appear in the sidebar: one shared Memory instance.** The
agent is registered under the id `seekerAgent`
(`apps/mastra/src/mastra/index.ts:164-168`, `agents: { …, seekerAgent, … }`)
and carries `memory: getAiChatMemory()`
(`apps/mastra/src/mastra/agents/seeker-agent.ts:224`). The feat-241 history
handlers read through the SAME lazy singleton — both `handleAiChatHistoryList…`
and the replay handler default `getMemory = () => getAiChatMemory()`
(`apps/mastra/src/mastra/ai-chat-history-route.ts:302` and `:362`), where
`getAiChatMemory()` caches one `Memory` per process
(`memory.ts:175-182`). So anything written via the seekerAgent's memory
surface is what the history list returns.

**The built-in memory API.** The `mastra dev` server (vendored `mastra@1.10.0`)
mounts its built-in routes under the `/api` prefix
(`apiPrefix ?? "/api"`, `mastra/dist/index.js:3316` in the pnpm store). The two
routes this recipe uses exist in the vendored dist — route metadata in
`mastra/dist/commands/api/route-metadata.generated.d.ts:777-800`
(`"POST /memory/save-messages"` with query `["agentId"]` + body
`["messages"]`; `"POST /memory/threads"` with query `["agentId"]` + body
`["metadata", "resourceId", "threadId", "title"]`) and the handlers in
`@mastra/server@1.36.0` (`dist/chunk-4KSV4WWQ.js:941` `SAVE_MESSAGES_ROUTE`,
`:1030` `CREATE_THREAD_ROUTE`). The save handler requires every message to
carry `threadId` AND `resourceId`, and all messages of one thread to share one
`resourceId` (400 otherwise).

**Auth posture of these routes, reconciled with the studio-guard doc.** Both
routes declare `requiresAuth: true`, but that only engages when a Mastra
server-level `auth` config exists — `checkRouteAuth` returns null (pass) when
`this.mastra.getServer()?.auth` is undefined
(`@mastra/server/dist/server/server-adapter/index.js:452-456`). `apps/mastra`
configures no `auth` (its `server` block is just `studioBase` + `apiRoutes`,
`apps/mastra/src/mastra/index.ts:233-235`), and
`docs/solutions/integration-issues/mastra-studio-api-auth-guard.md` records
that this is deliberate: a blanket `/api/*` bearer guard would break Studio's
own browser calls, so built-in `/api/*` routes are code-unauthenticated and
containment is the network/gateway boundary. Consequence for this recipe: **no
header is needed locally** — and for exactly the same reason, never run these
seeding calls against a deployed Mastra endpoint.

**Seed a thread + messages** (resourceId must be `user:<sub>` with the SAME
`sub` as the minted JWT — chat's proxy resolves the session to
`` `user:${identity.sub}` `` (`apps/chat/src/auth/anon-id.ts:106`) and Mastra's
history routes refuse non-`user:` resources):

```bash
# 1. Create a thread (endpoint shape verified in the vendored dist; response body per this session's usage)
curl -sS -X POST 'http://localhost:4111/api/memory/threads?agentId=seekerAgent' \
  -H 'content-type: application/json' \
  -d '{
    "resourceId": "user:local-dev-sub",
    "threadId": "11111111-1111-4111-8111-111111111111",
    "title": "Seeded conversation"
  }'

# 2. Save MastraDBMessage-shaped rows into it
curl -sS -X POST 'http://localhost:4111/api/memory/save-messages?agentId=seekerAgent' \
  -H 'content-type: application/json' \
  -d '{
    "messages": [
      {
        "id": "seed-msg-1",
        "threadId": "11111111-1111-4111-8111-111111111111",
        "resourceId": "user:local-dev-sub",
        "role": "user",
        "type": "text",
        "createdAt": "2026-07-01T00:00:00.000Z",
        "content": { "format": 2, "parts": [{ "type": "text", "text": "Who was John the Baptist?" }], "content": "Who was John the Baptist?" }
      },
      {
        "id": "seed-msg-2",
        "threadId": "11111111-1111-4111-8111-111111111111",
        "resourceId": "user:local-dev-sub",
        "role": "assistant",
        "type": "text",
        "createdAt": "2026-07-01T00:00:05.000Z",
        "content": { "format": 2, "parts": [{ "type": "text", "text": "John the Baptist was..." }], "content": "John the Baptist was..." }
      }
    ]
  }'
```

The row shape is `MastraDBMessage`
(`@mastra/core@1.36.0` `dist/agent/message-list/state/types.d.ts:82-84`):
`{ id, role: 'user'|'assistant'|'system'|'signal', createdAt, threadId?,
resourceId?, type? }` (`MastraMessageShared`, `types.d.ts:9-16`) with
`content: { format: 2, parts: MastraMessagePart[], content?, … }`
(`MastraMessageContentV2`, `types.d.ts:71-81`). `createdAt` as an ISO string is
accepted per this session's usage. Keep to `user`/`assistant` roles with
`text` parts: the feat-241 replay wire projects user/assistant text parts only
(`apps/mastra/CLAUDE.md` "Replay (KTD4/KTD5)"), so anything else is invisible
in chat.

Then load `http://localhost:3200` with the minted cookie set: the sidebar
hydrates the seeded thread, and selecting it replays the transcript.

**Gotcha — seeding order:** `saveMessages` bumps the thread's `updatedAt` to
NOW for every thread it touches — verified in the InMemory storage domain
(`@mastra/core@1.36.0` `dist/chunk-XW7PRUR5.js:4651-4657`:
`thread.updatedAt = new Date()`), and the history list orders
`{ field: "updatedAt", direction: "DESC" }`
(`apps/mastra/src/mastra/ai-chat-history-route.ts:328`). So seeded threads
sort as most-recent regardless of the `createdAt` you put in the rows; to
fabricate a specific sidebar order, seed threads in reverse (oldest-first)
save order.

**Lifetime:** the `memory` backend is process-lifetime — seed and browse
against the SAME running `mastra dev` process; a restart wipes everything.

## Why This Matters

The full feat-241 surface — gate grant, sidebar hydration, pagination, replay,
R22 send-blocking, gate-deny states — becomes smoke-testable with **zero
external dependencies**: no `apps/auth` instance, no Postgres, no model key,
no OAuth client registration. That turns "verify the gated history flow in a
browser" from an environment-provisioning task into a two-minute setup, which
is exactly what feat-241's own verification needed and what any follow-up
(feat-209 deep links, feat-247 thread delete/rename, feat-236 gate removal)
will need again.

## When to Apply

- Any `apps/chat` work that needs a signed-in and/or gate-granted state
  locally: the seeker gate, history hydration/replay, sidebar behavior, the
  account row.
- Any `apps/mastra` work on the history read surface that needs pre-existing
  threads without burning model calls.
- **Local only.** The memory-API seeding path is unauthenticated by design and
  must never be pointed at a deployed Mastra endpoint; the minted cookie is a
  real credential for whatever secret signed it, so use a throwaway
  `CHAT_SESSION_SECRET`, never a deployed environment's value.
- Not a substitute for one real `apps/auth` round-trip when the change touches
  the OAuth flow itself (login/callback/logout routes, claim mapping) — the
  mint bypasses exactly that code. This recipe does NOT conflict with
  `docs/solutions/auth/auth-owned-agent-login-handles-for-local-preview-oauth-20260611.md`'s
  "no app-local auth bypasses" rule: it adds zero code paths, exploiting the
  existing design property that chat's session is a pure HS256 cookie with no
  DB row (feat-207) — a data-only local shortcut. Agent login handles remain
  the pattern for real-OAuth/browser-flow validation and preview environments.

## Examples

The feat-241 session ran this end-to-end (per this session's usage): minted
`forge_chat_session` cookie → page rendered signed-in with
`[seeker-gate] … outcome=granted` → two threads seeded via
`POST /api/memory/threads` + `POST /api/memory/save-messages?agentId=seekerAgent`
→ sidebar hydrated both (newest save-order first, per the `updatedAt` gotcha)
→ replay rendered the seeded transcript as bare text. The runnable snippets in
Guidance are the example.

## Related

- `apps/chat/CLAUDE.md` — "Development" (the real dogfood path this recipe
  substitutes into) and "Server-side conversation history (feat-241)".
- `apps/mastra/CLAUDE.md` — "Local run" (`MASTRA_STORAGE_BACKEND=memory`) and
  "ai-chat history read surface (feat-241)" (gate ladder, lane bearer,
  `updatedAt DESC` listing).
- `docs/solutions/integration-issues/mastra-studio-api-auth-guard.md` — why
  Mastra's built-in `/api/*` surface carries no service-bearer guard (the
  auth posture Recipe 2 relies on, and the reason it is local-only).
- `docs/solutions/auth/auth-owned-agent-login-handles-for-local-preview-oauth-20260611.md`
  — the boundary: agent login handles own real-OAuth/browser-flow validation
  and preview envs; this recipe is a local, data-only smoke shortcut.
- `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md`
  — the in-process Memory semantics (message v2 shape, save-thread-before-messages,
  resourceId-gated ownership) the seeded payloads must satisfy.
- `docs/solutions/best-practices/deterministic-mastra-sse-route-testing-stub-model-budget-seam-20260625.md`
  — the unit-test-level counterpart for exercising memory-keyed routes without
  a live model; this doc is the running-stack-level sibling.
- `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md`
  — the fail-closed gating philosophy behind the "silently anonymous" trap:
  deny-by-default wiring is the desired production property; this recipe is
  how you satisfy (not bypass) the gate locally.
- `docs/plans/2026-07-13-001-feat-chat-server-history-sidebar-plan.md` — the
  feat-241 plan whose verification this recipe served.
