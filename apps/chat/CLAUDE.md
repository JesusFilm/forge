# CLAUDE.md — Forge Chat

## What This Is

A chat UI for the Forge Mastra agents (jesusfilm.ai). The initial styling
follows the "Vigil" design direction (see below) — a starting point handed to
us to get going, not a locked-in convention; expect it to evolve. Replies come
from the client stub by default, or stream from Seeker behind the
`SEEKER_CHAT_ENABLED` kill switch composed with the per-user seeker dogfood
email allowlist (`SEEKER_ALLOWED_EMAILS`, feat-205, feat-233). On the Seeker
path the SERVER side persists (feat-208): Mastra stores threads/messages in
its `ai_chat` Postgres schema, keyed by a proxy-resolved per-user resource —
and since feat-241 signed-in, gate-granted users get that history BACK: the
sidebar hydrates from a paginated server listing, threads carry LLM titles,
and selecting a thread replays its transcript and resumes in the same server
thread (see "Server-side conversation history" below). Anonymous and
gate-denied users keep the ephemeral client-only sidebar that resets on
refresh. Per-conversation URLs/deep-linking is feat-209.

## Architecture

```
src/
  app/
    layout.tsx           Root layout; loads globals.css (server)
    page.tsx             Resolves the seeker gate (resolveSeekerGate, surface "page"; force-dynamic) → <AppShell seekerEnabled> (server)
    globals.css          "Vigil" token layer — Tailwind v4 @theme palette + fonts + base styles
    api/
      seeker/route.ts    'force-dynamic' POST proxy → Mastra /forge-seeker SSE (feat-205): bearer server-side, SSRF+https guard, redirect:"error", timeout-bounded, normalizes every failure to one terminal error{reason} frame. feat-208: resolves + always sends resourceId (user:<sub> / anon:<uuid>), re-issues the rolling anon cookie on the SSE response, passes thread_forbidden/thread_limit through. feat-233: per-user seeker gate enforced before any upstream call (deny → terminal gate_denied frame the client maps to the stub). Testable core handleSeekerProxyRequest
      history/history-proxy.ts   feat-241: shared testable cores for the two history proxies — session→resource (user:* only, 401 invalid_session otherwise, NO anon minting), dogfood gate (surface "history"), AI_CHAT_MASTRA_API_KEY lane bearer, hostAllowed reuse, min(seekerTimeoutMs,10s) budget, status-before-body, byte-capped JSON reads (2/8 MiB), KTD8 deny contract
      history/list/route.ts      POST → Mastra /forge-ai-chat-history-list (thin wrapper; force-dynamic)
      history/thread/route.ts    POST → Mastra /forge-ai-chat-history-replay (POST so thread ids never hit URL/CDN logs)
      auth/login/route.ts    GET → apps/auth authorize + set transient state/verifier/return_to cookies; sends prompt=login when the feat-240 force-login marker is present (marker consumed by callback success, never here); no-op home redirect when unconfigured (feat-207)
      auth/callback/route.ts GET → verify state, exchange code, verifyChatIdToken (id-token-only), set signed session cookie + consume the feat-240 force-login marker (success only), 302 return_to; single catch → non-PII log + ?signin=failed (marker kept armed)
      auth/logout/route.ts   POST → clear session cookie + set the 30-day single-use force-login marker (feat-240), 303 home (POST so it isn't prefetchable)
  auth/                  Chat auth (feat-207), adapted from apps/admin/src/auth/* — SDL of the OAuth flow, no DB, no authorization
    oauth-state.ts       state + PKCE (S256) via node:crypto (verbatim port)
    oauth-client.ts      authorize URL + token exchange + verifyChatIdToken (JWKS-derived alg allowlist, NO access-token fallback — R9 divergence)
    session-cookie.ts    signed identity cookie create/read + option helpers (session / transient / feat-240 force-login marker) + readRequestCookie; fail-closed to anonymous without a real secret
    origins.ts           resolveChatReturnToURL — post-login return-target validated against chat's own origin (R10)
    identity.ts          getChatIdentity() server reader (next/headers); never redirects; display-only
    anon-id.ts           feat-208: anonymous continuity id — resolveSeekerResource (user:/anon: namespacing, prefix-check only), UUID validation, rolling 30-day hardened cookie serialization
    errors.ts            ChatAuthError + fixed non-PII reason codes (KTD7)
    sign-in-notice.ts    the R12 ?signin=failed marker constants (fixed enum, never free text)
  config/
    env.ts               Validated env (zod, all .optional()): SEEKER_CHAT_ENABLED + Mastra vars (feat-205: SEEKER_MASTRA_BASE_URL + SEEKER_MASTRA_ALLOWED_HOSTS + SEEKER_TIMEOUT_MS; since feat-250 the one Mastra bearer is AI_CHAT_MASTRA_API_KEY — SEEKER_MASTRA_API_KEY is gone), the feat-207 auth vars, AND the feat-233 SEEKER_ALLOWED_EMAILS allowlist. isSeekerChatEnabled() / isSeekerEmailAllowed() / seekerTimeoutMs() / chatAuthConfigured() / chatAuthCookiePrefix(). Boots clean with none set
  components/
    shell/
      app-shell.tsx      'use client' — owns conversation state (useConversations) + sidebar view state (collapsed rail / mobile drawer open); matchMedia breakpoint reset, body scroll-lock, <main> inert focus-trap
      sidebar.tsx        'use client' — responsive left rail composition (scrim + <aside>): desktop expanded ↔ collapsed icon-rail + mobile off-canvas drawer. Presentational shell now — UI mechanics live in use-sidebar-chrome, collapsed-style policy in sidebar-collapsed-styles, sub-rows in the sidebar-* components
      use-sidebar-chrome.ts        'use client' — sidebar UI-mechanics hook: collapse clip state machine (+ 400ms fallback timer), Escape-to-close listener, drawer focus trap/restore. Derives presentation from collapsed/mobileOpen; owns no view state
      sidebar-collapsed-styles.ts  collapsedStyles(collapsed) → the md:-scoped collapsed-rail class policy in one slot-keyed map (header/brand/wordmark/newButton/nav)
      sidebar-header.tsx           Brand mark + wordmark + the three mutually-exclusive controls (desktop collapse toggle / collapsed expand affordance / mobile close X); presentational
      sidebar-new-conversation.tsx New-conversation action (full-width labeled ↔ centered icon-only when collapsed); presentational
      sidebar-conversation-list.tsx Conversation history nav (select + per-row replying pulse; hidden when collapsed); presentational
      sidebar-account.tsx          Rail-foot account control (feat-207): signed-out "Sign in" anchor / signed-in identity (name→email→label, avatar→initials→icon) + "Sign out" POST form + R12 notice; presentational, three-presentation coverage; hidden when auth unconfigured
      icons.tsx          Inline line-icon components (panel/compose/menu/close/chevron/…) — currentColor, no icon dependency, no emoji
    chat/
      chat.tsx           Conversation pane — the centered 680px reading "room" (presentational)
      message-list.tsx   Renders turns (Embersoot user bubble / plain assistant text) + streaming pulse (aria-live), grounded badge (3 states), engine marker, role="alert" failure notice
      sources-list.tsx   Collapsed "Sources · N" disclosure of cited passages (feat-269: deduped by URL, snippets line-clamped behind per-source disclosures) or explicit always-visible "No sources cited" state; untrusted RAG sources → https-only links (rel=noopener), text never HTML (feat-205)
      composer.tsx       Auto-growing textarea + 12px Vesper send-dot (no paper-airplane icon)
      empty-state.tsx    "What would you like to ask?" heading + starter questions
    brand/
      brand-lockup.tsx   Inlined JFP flag mark + "jesusfilm.ai" wordmark
  lib/
    chat-stub.ts         Reply seam (still the single swap point): streamReply() — stub path (buildStubReply) OR Seeker path (POST /api/seeker, parse SSE, first-terminal-wins)
    sse.ts               Chat-local SSE parser (readSseStream + encodeSseFrame), forked from admin's reference; used by the proxy AND the client seam
    cn.ts                Tiny conditional-className joiner (no clsx/tailwind-merge dependency)
    seeker-gate.ts       feat-233: resolveSeekerGate — kill switch + verified email + SEEKER_ALLOWED_EMAILS membership → {seekerEnabled, outcome} + the [seeker-gate] R15 log line (grants and denials, sub not email)
    conversations.ts     Message (+ optional sources/grounded/engine/error) + SeekerSource + ReplyFailureReason + Conversation types (feat-241 additive: origin, serverPersisted, lastActivityAt, replay state) + createConversation / deriveTitle / fallbackTitle
    history-client.ts    feat-241: never-throw typed client for /api/history/* — fetchHistoryPage / fetchHistoryThread with the closed access | not_available | unavailable reason set
    use-conversations.ts Client hook: send + async streaming lifecycle (empty assistant turn → token append → terminal finalize/error) + per-conversation AbortController slot (pending + double-send guard, released in finally) + new/select conversation. feat-241: post-mount history hydration (gated on seekerEnabled), merge by conversation id, Load more, lazy single-flight replay, R22 send blocking, KTD10 allowStubFallback wiring; pure merge/order helpers exported for tests
public/                  Static assets served by URL (Next.js convention, matches apps/web)
  brand/
    jfp-sign.svg         JFP flag mark — canonical source (the mark is inlined in brand-lockup.tsx)
    jesus-film-logo.svg  Full wordmark (unused for now; kept for longer-form surfaces)
```

- **State ownership:** all conversation state lives in `useConversations`,
  consumed by `AppShell`, which also owns sidebar _view_ state (`collapsed`,
  `mobileOpen`). Data flows one way: `useConversations`/view-state → `AppShell`
  → `Sidebar` / `Chat` → leaf components. Both `chat.tsx` and `sidebar.tsx` are
  presentational compositions now: `sidebar.tsx` lays out the scrim + `<aside>`
  and delegates its local _UI mechanics_ (collapse clip animation, Escape
  listener, drawer focus trap) to the `useSidebarChrome` hook, its collapsed
  class policy to `collapsedStyles`, and its rows to the `sidebar-*`
  sub-components (feat-203). State ownership stays in `AppShell` — the hook
  only derives presentation from the `collapsed`/`mobileOpen` flags.
- **The reply seam:** reply generation is isolated in `lib/chat-stub.ts`
  (`streamReply` — stub path OR Seeker proxy, selected by the `seekerEnabled`
  flag). The hook orchestrates the streaming lifecycle (append an empty assistant
  turn, feed `onToken` into it, finalize/error on the terminal result), the
  per-conversation pending/double-send guard, and which conversation a reply
  lands in. The `Message` type + `SeekerSource` + `ReplyFailureReason` live in
  `lib/conversations.ts` (NOT in the seam) so they survive the seam's deletion;
  the `id`/`role`/`content` core is AI-SDK-aligned. See "Mastra Connection
  (Seeker, feat-205)" below for the proxy + flag + accepted-risk detail.
- **Sidebar is our own addition**, not from the design system — the Vigil
  system as handed to us is single-surface (it lists no conversation sidebar),
  so the rail was built from its tokens rather than copied from it. It is
  responsive (Gemini-style): a desktop rail that collapses to an icon column,
  and a mobile off-canvas drawer (hamburger opens; scrim / X / Escape close;
  `<main>` is `inert` while open). This too may change. Multi-conversation state
  is client-only and resets on refresh (no DB/users yet).

### Initial design direction — "The Vigil"

The first styling pass follows the jesusfilm.ai design system, ported into
`globals.css` as Tailwind v4 `@theme` tokens. **This is a starting point and
may change** — treat it as the current direction, not a hard rule. The one part
worth keeping regardless: where tokens exist, prefer the token utilities over
raw hex/values (that's just code hygiene, not a design commitment).

- **Palette:** `hearthblack` (bg), `embersoot` (cards/user bubbles), `linen`
  (text), `vellum` (scripture), `ash` (metadata), `vesper` (terracotta —
  primary action), `lamplight` (the one warm accent — cursor/pulse, never
  buttons). E.g. `bg-hearthblack`, `text-linen`, `border-linen/10`.
- **Fonts (three, no fourth):** `font-display` (Newsreader serif — headings),
  `font-body` (Inter Tight — UI/chat, weights 400/500 only), `font-scripture`
  (Cormorant Garamond italic — quoted scripture only).
- **Currently avoided** (per the source system, not immutable): pure
  `#FFF`/`#000`, gradients (except the composer protection fade), cold blues,
  glassmorphism, and emoji.

## Mastra Connection (Seeker, feat-205)

The integration path is **settled**: direct server-to-server bearer (admin's
`MASTRA_BASE_URL` pattern), NOT the `apps/mastra-gateway` browser-facing path.
feat-205 wired a feature-flagged proxy to the internal `/forge-seeker` SSE route
(see `docs/plans/2026-06-26-001-feat-chat-wire-seeker-route-plan.md` +
`docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md`).

- **Gated, default off — two composed layers since feat-233.**
  `SEEKER_CHAT_ENABLED` is the service-wide kill switch, no longer the sole
  reply-source selector: the decision is `resolveSeekerGate()`
  (`src/lib/seeker-gate.ts`) = kill switch AND signed-in verified email AND
  membership in the `SEEKER_ALLOWED_EMAILS` env allowlist (CSV of emails,
  normalized both sides; unset/empty admits no one). `page.tsx`
  resolves it server-side (`force-dynamic`, surface `page`) into the
  `seekerEnabled` prop; the route re-resolves it on every request (surface
  `route`) and denies with a terminal `gate_denied` frame the client maps to
  the stub. Any deny → the original client stub (`buildStubReply`); full grant
  → messages stream from Seeker.
- **The seam is `src/lib/chat-stub.ts`** (`streamReply` — stub path + Seeker
  path), still the single swap point. The `Message` type + `SeekerSource` +
  `ReplyFailureReason` live in `src/lib/conversations.ts` so they outlive the seam.
- **The proxy** is `src/app/api/seeker/route.ts` (+ `src/lib/sse.ts` parser). It
  holds the bearer server-side (`AI_CHAT_MASTRA_API_KEY`, the single ai-chat
  lane bearer since feat-250 — Mastra's `/forge-seeker` accepts only its
  `AI_CHAT_SERVICE_API_KEYS` lane CSV, so the shared pool never reaches
  conversation data), SSRF-checks the base host + enforces `https:`
  (exempting loopback for local dev AND `*.railway.internal` — the prod
  transport: Railway private networking is plain HTTP over a
  WireGuard-encrypted mesh, and Mastra has no public domain),
  `redirect:"error"`, bounds the call with `SEEKER_TIMEOUT_MS` (95s > Mastra's
  90s ceiling), and normalizes every failure to one terminal `error{reason}` SSE
  frame. Plain-string logging only.
- **Accepted v1 risk (restated under feat-208's durable-storage physics):** the
  proxy is unauthenticated + un-rate-limited + world-reachable, gated only by
  URL obscurity + a small trusted audience (NOT a gate). Since feat-208, each
  junk POST no longer costs only an ephemeral ~90s paid generation — it also
  writes durable rows into the SAME Postgres database as Mastra runtime
  storage. Two bounds apply, honestly framed: the per-resource thread ceiling
  (200, `thread_limit`) bounds a single cooperative or runaway client ONLY — a
  cookie-refusing attacker mints a fresh `anon:<uuid>` resource per POST for
  free. The 30-day retention purge is the only adversarial storage control
  and it is bounded: it drains junk once aged past the window (capping total
  junk at ~one retention window × inflow), but in-window growth is unbounded
  and a concurrent burst can saturate Mastra's small ai-chat pool long before
  storage matters. Inbound auth + a rate/concurrency cap remain prerequisites
  before the audience widens — they, not the purge, are the actual flood
  control; do not "fix" the open proxy without that work.
- **Memory keying (feat-208):** the proxy resolves `resourceId` server-side
  (`src/auth/anon-id.ts`): the session's verified `sub` → `user:<sub>` when
  signed in, else `anon:<uuid>` from a hardened, UUID-validated cookie that is
  minted on first send and re-issued with a fresh 30-day Max-Age on EVERY send
  (rolling, aligned with the anonymous retention window). The subject is a
  memory PARTITION KEY only in this path — the one authorization-adjacent use
  of identity is the separate feat-233 seeker gate (R13 carve-out).
  Prefix-check resources (`startsWith`) — never split on `:`. Known accepted behaviors: a
  cookie-refusing client loses continuity at turn 2 (`thread_forbidden`
  notice); an identity change starts fresh threads (client state resets on the
  OAuth redirect — an invariant feat-209 must preserve); anonymous→account
  thread migration is out of scope.

The three former "deferred hardening" criteria (surface failures, outbound
timeout, single-file async seam) are now **implemented**: failures render a
`role="alert"` notice keeping partial text; the call is timeout-bounded; the seam
is async (`streamReply`) and the hook only awaits it.

## Server-side conversation history (feat-241)

The read path for feat-208's persisted threads. Plan:
`docs/plans/2026-07-13-001-feat-chat-server-history-sidebar-plan.md`; feat-236
owns the dogfood-gate layer's removal recipe (refreshed by this feature's PR).

- **Three refusal layers before any message bytes move:** chat proxy (signed
  session → `user:<sub>` resource, dogfood gate surface `"history"`) → Mastra
  history routes (dedicated `AI_CHAT_SERVICE_API_KEYS` lane bearer, `user:`
  resource refusal) → thread-ownership gate on replay.
- **Proxies** (`src/app/api/history/*`): POST-shaped (thread ids never in
  URLs), no anon-cookie minting, the `AI_CHAT_MASTRA_API_KEY` lane bearer
  (since feat-250 the send path presents the same lane bearer — chat holds no
  pool key at all), reusing `SEEKER_MASTRA_BASE_URL` + allowlist + the exported
  `hostAllowed`. Read budget `min(seekerTimeoutMs(), 10s)`; upstream status
  classified before any body parse; byte-capped buffered reads (2 MiB list /
  8 MiB thread — sized for the worst-case UTF-8 inflation of the 8,192
  UTF-16-unit per-message text cap). Deny wire (KTD8): 401 `invalid_session` (anonymous ≡ expired
  ≡ tampered), 403 `gate_denied` / `thread_forbidden`, 404 `thread_not_found`
  (only when the upstream body carries the reason — a reasonless 404 is
  `unavailable`, so config outages never read as data loss), 502/504.
- **Client mapping** (`lib/history-client.ts`): `access` (401/gate_denied) →
  silent fall-back to the client-only sidebar, no nudge (R16; the sign-in
  nudge is deferred to feat-236); `not_available` → the "no longer available"
  state; `unavailable` → error state with retry.
- **Hook semantics** (`lib/use-conversations.ts`): hydration fires once
  post-mount when `seekerEnabled` (= full gate grant — anonymous/denied users
  never fetch; the server render path gains no awaits); merge by conversation
  id (client conversation id === server thread id): in-session messages
  authoritative, non-empty server LLM title beats the `deriveTitle` snippet,
  server-origin conversations skip the retitle branch; ordering =
  fresh-empty-local pinned, then activity-desc. Replay is per-conversation
  single-flight and session-cached (`idle → loading → loaded | failed |
not_available`; failed retries only via the explicit action); sends into a
  server-origin conversation are BLOCKED unless its replay is `loaded` (R22 —
  the composer keeps the draft, only the send action is disabled). Replayed
  turns render as bare text — no engine/grounded/source badges (R21).
- **Denied sends fail visibly on persisted conversations (KTD10):** a
  conversation counts as server-persisted once hydrated from history OR after
  a send's SUCCESS finalize with engine `"seeker"` (never from the engine tag
  alone). The hook passes `allowStubFallback: false` for those, so
  `gate_denied` renders the access-changed failure copy instead of silently
  stub-forking; never-persisted conversations keep the feat-233 stub
  downgrade.
- **Titles:** LLM-generated server-side (Mastra `generateTitle`, signed-in
  threads only); untitled rows (`title: ""`) render the deterministic
  `fallbackTitle(lastActivityAt)` date label. No in-session polling — new
  titles appear on the next hydration.
- Logging is enum-only plain-string `[history-proxy] event=… reason=…` —
  never conversation ids, titles, or upstream body fragments.

## Authentication (feat-207)

Optional sign-in / sign-out against `apps/auth` (Better Auth OIDC), reusing
admin's redirect-based OAuth client _shape_. **Authentication establishes _who_
the user is and gates almost nothing** (R7, amended by feat-233/R13): chat
stays fully usable anonymously and there are no role/permission checks, but
the seeker reply source is per-user since feat-233 — the page and the
`/api/seeker` route resolve the seeker dogfood gate from the session's
verified-email claims, so signed-in allowlisted dogfooders get Seeker and
everyone else (unlisted, unverified, anonymous, direct callers) gets the
stub.

- **Cookie-only session, no database.** The session IS a signed, app-local cookie
  carrying the verified identity claims (`{ sub, name?, email?, picture?,
emailVerified? }`) read from the id_token at callback — chat writes no user
  record (matches the no-persistence boundary). `HS256` via `jose`; short TTL
  (`SESSION_TTL_SECONDS`, 8h — deliberately not admin's 7 days, for shared-device
  exposure); the cookie's own lifetime is authoritative (the id_token's ~1h `exp`
  is verified once at callback, not carried onto the session). The one gated
  decision — the feat-233 seeker dogfood gate — rides the cookie's 8h claim
  snapshot (`email` + `emailVerified`), not token freshness. A live session
  cannot be ended early per-user — no revocation, a deliberate decision
  (feat-240's Decision Record), not an oversight. The honest mitigations are
  the 8h TTL (the repo's shortest), server-side self-scoped reads, and chat's
  plain-text message rendering discipline: message content renders as
  React-escaped text only — no `dangerouslySetInnerHTML`, no HTML, no
  markdown; keep it that way. The everyone-at-once incident lever is rotating
  `CHAT_SESSION_SECRET`.
- **Config-gated, default off.** `chatAuthConfigured()` (`config/env.ts`) is true
  only when `AUTH_ISSUER_URL`, `AUTH_CHAT_CLIENT_ID`, `CHAT_BASE_URL`, and a REAL
  `CHAT_SESSION_SECRET` (rejects empty, the `.env.example` placeholder, and
  sub-32-char values — fail-closed to anonymous) are all set. When false the
  sidebar hides the "Sign in" affordance and `/api/auth/login` refuses to start a
  flow, so chat never dead-ends in a `redirect_uri` mismatch. **All auth env vars
  are `.optional()`** — the default-off deploy boots with none set.
- **Out-of-codebase PREREQUISITE:** a chat OAuth client must be registered in
  `apps/auth` (with the `openid` scope and the EXACT redirect URI
  `<CHAT_BASE_URL>/api/auth/callback` per environment) **before** these env vars
  are set in that environment — mirroring the repo's receiver-registers-first
  cross-app discipline.
- **The flow:** `src/auth/` holds the primitives (`oauth-state` PKCE/state,
  `oauth-client` authorize+exchange+`verifyChatIdToken`, `session-cookie` signed
  cookie, `origins` return-target validation, `identity` the server reader,
  `errors`/`sign-in-notice` shared constants); `src/app/api/auth/{login,callback,
logout}/route.ts` wire it. `getChatIdentity()` reads the cookie server-side in
  `page.tsx` (`force-dynamic`) and threads `identity` / `authConfigured` /
  `signInError` down to `SidebarAccount` (like `seekerEnabled`). It NEVER
  redirects (anonymous is valid) and is **display-only, with ONE bounded
  carve-out (R13, feat-233)**: the seeker dogfood gate
  (`src/lib/seeker-gate.ts`) may consume the claims for named-person feature
  gating via the `SEEKER_ALLOWED_EMAILS` env allowlist — internal staff
  dogfooders only. Anything broader (rule-based gating, allowlist entries
  outside the org, or reuse beyond seeker dogfooding) still requires a
  membership gate first — revocation is deliberately not required (see the
  code comment + feat-240's Decision Record and its scope tripwire).
- **R9 divergence from admin's verifier (net-new, so it carries its own tests):**
  `verifyChatIdToken` verifies the **id_token only** (no `idToken ?? accessToken`
  fallback — admin is safe without this only because it also gates on
  `admin:access`, which chat doesn't) and pins a **JWKS-derived `algorithms`
  allowlist** admin omits. `createRemoteJWKSet` (asymmetric-only) is the
  symmetric-key barrier; the allowlist's job is `alg:none` rejection +
  rotation-tracking. The allowlist is derived from the issuer's published JWKS
  (`kty`+`crv` mapping; fail-closed loudly on an unrecognized key), cached with a
  bounded TTL + re-derived once on an alg-mismatch (never pinned for process
  lifetime), and all endpoint URLs use `new URL(absolutePath, issuerUrl)` (NOT
  string concatenation).
- **Cookie hardening (R11):** `HttpOnly`, `Secure` in production, `SameSite=Lax`
  (the callback is a top-level cross-site GET return — `Strict` would withhold the
  cookie), host-only (no `Domain`, per `apps/auth`'s no-shared-parent-cookie
  rule), `Path=/`. The transient `state`/`verifier`/`return_to` cookies share the
  hardening with a ~10m TTL and are cleared on callback. Sign-out is a **POST
  form** (not a GET link — a GET logout is prefetchable/crawlable); it clears
  chat's session cookie and sets the **force-login marker** (feat-240):
  `forge_chat_force_login`, same hardening, 30-day TTL. Every sign-in on
  that browser within 30 days sends `prompt=login` to `apps/auth` — a real
  login page renders instead of a silent SSO re-auth — until one COMPLETES:
  the marker is consumed by the callback's success path only, so a failed or
  abandoned attempt keeps it armed (review-hardened; web deletes on the login
  redirect instead, which lets an abandoned attempt burn the marker).
  `apps/auth`'s SSO session itself stays untouched, and the marker is
  deliberately 30 days (not web's 10 minutes): the SSO session is rolling, so
  no finite marker covers the whole silent-re-auth window; lifetime is
  cost-free under consume-on-success. See feat-240's Decision Record for the
  dropped lease/revocation design.
- **No PII in logs or surfaces (KTD7):** the callback logs only fixed non-PII
  reason codes in the `[chat-auth] event=callback_failed reason=<code>`
  plain-string format (Railway logsV2 silences JSON stdout); it never logs the
  claims or the caught verification error. The R12 sign-in-failure notice is keyed
  off a FIXED enum marker (`?signin=failed`, stripped from the URL after first
  read), never reflected error text.
- **Accepted v1 risk (recorded decision, do NOT "fix" without the follow-up):**
  the `login`/`callback` routes are world-reachable and drive outbound calls to
  `apps/auth`, and — like `/api/seeker` above — ship **un-rate-limited** in v1,
  gated only by the outbound timeout. A per-IP cap (as admin's auth routes use via
  Redis, fired before the outbound call) is a prerequisite before the audience
  widens.

## Intentionally Absent

- No **authorization** beyond ONE bounded carve-out (feat-233/R13): the seeker
  dogfood gate (`src/lib/seeker-gate.ts`) — named-person feature gating via
  the `SEEKER_ALLOWED_EMAILS` env allowlist, internal staff dogfooders only.
  No other role/permission checks and no gating of any other surface;
  rule-based gating, non-org entries, or reuse beyond seeker dogfooding
  requires a membership gate first (revocation deliberately not required —
  feat-240's Decision Record). Sign-in itself stays optional
  (feat-207) and default-off.
- No rate/concurrency cap on `/api/seeker` or the auth routes (lands later,
  alongside Cloudflare fronting — see the access-posture notes above). Inbound
  auth on `/api/seeker` DOES exist since feat-233 (the per-user seeker gate);
  the cap remains the open prerequisite before the audience widens
- No chat-side database (the auth session is a cookie, not a DB row; chat
  writes no user record). Since feat-208 the SERVER side does persist: Seeker
  threads/messages live in Mastra's `ai_chat` Postgres schema (30d anon / 180d
  signed-in retention), and since feat-241 signed-in gate-granted users get
  sidebar history + replay/resume back from it (see "Server-side conversation
  history"). Still absent: per-conversation URLs / deep-link restore
  (feat-209), thread delete/rename (feat-247), and anonymous ephemerality
  stays deliberate — the anon continuity cookie never becomes a
  history-reading credential
- No browser-direct Mastra path / CORS (server-to-server bearer only)
- No i18n, no design-system sharing with `apps/web`

Now present (feat-205, behind the default-off flag): a validated `env.ts`, the
`/api/seeker` App Router route handler, and SSE streaming. Now present (feat-207,
behind `chatAuthConfigured()`, default off): optional OAuth sign-in/out against
`apps/auth` — `src/auth/*`, the `/api/auth/*` routes, and the sidebar account
control. Now present (feat-233, default deny): the per-user seeker dogfood
gate — `src/lib/seeker-gate.ts` (`SEEKER_ALLOWED_EMAILS` membership), enforced
at the page and on every `/api/seeker` request. Authentication now feeds that
one gate; everything else stays ungated. Now present (feat-240): sign-out sets
the 30-day single-use force-login marker, so the next sign-in shows a real
login page instead of silently re-authenticating via the SSO session.

## Key Conventions

- Server Components by default. Client components are the ones holding hooks:
  `shell/app-shell.tsx`, `shell/sidebar.tsx`, `shell/use-sidebar-chrome.ts`,
  `chat/chat.tsx`, `chat/composer.tsx`, and `chat/empty-state.tsx`.
  `chat/message-list.tsx`, `chat/sources-list.tsx`, and the
  `shell/sidebar-{header,new-conversation,conversation-list,account}.tsx`
  sub-components carry no `'use client'` — they have event handlers but no hooks,
  so they inherit the client context of the `'use client'` modules that import
  them (`shell/icons.tsx`, the stateless SVGs, is the same). `shell/sidebar-collapsed-styles.ts`
  (a pure class-map function), `brand/*`, `lib/cn.ts`, `lib/sse.ts`, the `app/`
  entry files, and the server-only modules (`config/env.ts`, `app/api/seeker/route.ts`,
  `app/api/auth/*`, `auth/*` — note `auth/identity.ts` uses `next/headers` — and the
  feat-233 `lib/seeker-gate.ts`, `import "server-only"`)
  stay server / framework-agnostic.
- Strict TypeScript, `src/` layout, `@/*` path alias — config mirrors
  `apps/web` (the CI-proven template).
- Tailwind v4, CSS-first (`@import "tailwindcss"` in `src/app/globals.css`;
  no tailwind.config file). Design tokens live in the `@theme` block there.
- Tests colocated (`*.test.ts(x)`). Component tests use **React Testing
  Library** (`render` / `screen` / `within` + `@testing-library/user-event`,
  with `@testing-library/jest-dom` matchers); the hook test uses `renderHook`.
  jsdom is the app-wide test env (`vitest.config.ts` `environment: "jsdom"` +
  `vitest.setup.ts`). The auth crypto/route tests (`src/auth/oauth-client`,
  `session-cookie`, `identity`, and `src/app/api/auth/*` route tests) are one
  class of exception: they carry a top-of-file `// @vitest-environment node`
  directive because `jose`'s WebCrypto path throws a cross-realm `payload must be an
instance of Uint8Array` under jsdom (jsdom's `TextEncoder` produces a
  different-realm `Uint8Array` than jose's `instanceof` check). The feat-233
  `lib/seeker-gate.test.ts` carries the same `node` directive — the module
  under test is server-only and needs no DOM. Component/hook tests stay on jsdom. This is a **deliberate divergence** from the `apps/admin` /
  `apps/web` no-testing-library convention (plain `react-dom/client` + `act`),
  scoped to chat by design — it does not change those apps. Pure-function tests
  (`lib/conversations.test.ts`, `lib/chat-stub.test.ts`,
  `shell/sidebar-collapsed-styles.test.ts`) stay plain vitest. The behavioral
  suite lives in `components/shell/app-shell.test.tsx` (AppShell owns the
  state); the extracted `use-sidebar-chrome` hook has its own colocated
  `renderHook` unit test for its state machine in isolation. Note for the
  behavioral suite: the reply lands via `setTimeout`, so it runs on fake timers
  with `userEvent.setup({ advanceTimers, ... })` under
  `vi.useFakeTimers({ shouldAdvanceTime: true })` — a plain fake clock hangs
  user-event's awaited interactions. Layout/visibility behavior jsdom can't
  represent (e.g. focus-restore-on-close, which depends on `offsetParent`) stays
  **browser-verified**, not asserted in jsdom.
- Runs on port **3200**.

### Comments

- **Inline comments are 3 lines maximum.** This applies to every `//` comment
  that explains code (in function bodies, beside JSX) and to file/module
  headers. If a note needs more, cut it down to the load-bearing insight.
- **Every new exported building block — component, hook, or non-trivial module —
  gets a JSDoc (`/** … \*/`) block** directly above it, describing its purpose
and any non-obvious behavior: for a component, what it renders and its key
props/state; for a hook or module, what it does and its inputs/outputs. This
is the one exception to the 3-line cap — keep it concise. Trivial one-line
helpers (e.g. a `cn`class joiner) don't need one; a short`//` note is fine.

## Development

```bash
pnpm --filter @forge/chat dev         # http://localhost:3200
pnpm --filter @forge/chat build
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat test
```

Env is optional: the app runs against the stub with no config. To dogfood
Seeker locally (the gate keeps production's shape locally — R12, feat-233):
copy `.env.example` → `.env.local`, set `SEEKER_CHAT_ENABLED=true` plus the
Mastra base URL + bearer, configure chat auth against a local `apps/auth`,
sign in with a session whose email is verified (`emailVerified === true`), and
put that email in `SEEKER_ALLOWED_EMAILS`. The mechanism is identical locally
and deployed — no dev-only override exists. Anonymous, unverified email, or an
email not on the allowlist → stub. The one Mastra bearer is
`AI_CHAT_MASTRA_API_KEY` (feat-250) — set it to a value in Mastra's
`AI_CHAT_SERVICE_API_KEYS` CSV; it covers sends AND the feat-241 sidebar
history. Unset, sends get the `config_missing` failure notice and the history
routes refuse (502 `unavailable`) — a GRANTED user's sidebar shows the history
error state with Retry until the key is provisioned (per KTD8: 502/504 render
the error state — a config gap is an outage to a granted user, never silently
hidden); anonymous/denied users are unaffected.

## Deployment

Railway via `railway.toml` (railpack builder), but only once the service's
"Config-as-code Path" points at the file — see README's wiring checklist
and its `configFile` verification step.

Production hostname is the Cloudflare-fronted `chat.jesusfilm.ai` (feat-235;
DNS, WAF, Authenticated Origin Pulls, DNSSEC). Railway env sets
`CHAT_BASE_URL=https://chat.jesusfilm.ai`; domain-lifecycle rules for the
OAuth seed live in
`docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md`.
