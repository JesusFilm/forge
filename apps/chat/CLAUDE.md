# CLAUDE.md — Forge Chat

## What This Is

A chat UI for the Forge Mastra agents (jesusfilm.ai). The initial styling
follows the "Vigil" design direction (see below) — a starting point handed to
us to get going, not a locked-in convention; expect it to evolve. Replies come
from the client stub by default, or stream from Seeker behind the
`SEEKER_CHAT_ENABLED` kill switch (feat-205) composed with the per-user
seeker dogfood email allowlist (`SEEKER_ALLOWED_EMAILS`, feat-233/feat-239).
On the Seeker
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
      seeker/route.ts    'force-dynamic' POST proxy → Mastra /forge-seeker SSE (feat-205): bearer server-side, SSRF+https guard via the shared transport (lib/server/mastra-upstream — fetch shape, signal composition, failure classifier), timeout-bounded, normalizes every failure to one terminal error{reason} frame; the 503 error-body read is byte-capped (64 KiB, feat-282's hardening delta). feat-208: resolves + always sends resourceId (user:<sub> / anon:<uuid>), re-issues the rolling anon cookie on the SSE response, passes thread_forbidden/thread_limit through. feat-233: per-user seeker gate enforced before any upstream call (deny → terminal gate_denied frame; the SESSION stubs never-persisted conversations, feat-281 Ruling 3). Testable core handleSeekerProxyRequest
      history/history-proxy.ts   feat-241: shared testable cores for the two history proxies — session→resource (user:* only, 401 invalid_session otherwise, NO anon minting), dogfood gate (surface "history"), AI_CHAT_MASTRA_API_KEY lane bearer, the shared transport (lib/server/mastra-upstream: hostAllowed, fetch shape, signal composition, failure classifier, readJsonCapped), [9s,10s]-clamped read budget, status-before-body, byte-capped JSON reads (the 2/8 MiB cap sizes stay here), KTD8 deny contract
      history/list/route.ts      POST → Mastra /forge-ai-chat-history-list (thin wrapper; force-dynamic)
      history/thread/route.ts    POST → Mastra /forge-ai-chat-history-replay (POST so thread ids never hit URL/CDN logs)
      auth/login/route.ts    GET → apps/auth authorize + set transient state/verifier/return_to cookies; sends prompt=login when the feat-240 force-login marker is present (marker consumed by callback success, never here); no-op home redirect when unconfigured (feat-207)
      auth/callback/route.ts GET → verify state, exchange code, verifyChatIdToken (id-token-only), set signed session cookie + consume the feat-240 force-login marker (success only), 302 return_to; single catch → non-PII log + ?signin=failed (marker kept armed)
      auth/logout/route.ts   POST → clear session cookie + set the 30-day single-use force-login marker (feat-240), 303 home (POST so it isn't prefetchable)
      health/route.ts    feat-305: Railway's deploy healthcheck ('force-dynamic' GET → 200 {ok,service}). Deliberately shallow — no env read, no Mastra call, no session decode — so it passes on the default-off boot and an upstream outage never rolls chat back. Its body is a fixed literal: the prober is unauthenticated and the route is publicly reachable
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
    env.ts               Validated env (zod, all .optional()): SEEKER_CHAT_ENABLED + Mastra vars (feat-205: SEEKER_MASTRA_BASE_URL + SEEKER_MASTRA_ALLOWED_HOSTS + SEEKER_TIMEOUT_MS; since feat-250 the one Mastra bearer is AI_CHAT_MASTRA_API_KEY — SEEKER_MASTRA_API_KEY is gone), the feat-207 auth vars, AND the feat-233 SEEKER_ALLOWED_EMAILS allowlist. isSeekerChatEnabled() / isSeekerEmailAllowed() / seekerTimeoutMs() / chatAuthConfigured() / chatAuthCookiePrefix() + the egress pin's requireSeekerEgressAllowlist() / describeSeekerEgressMisconfiguration(). Boots clean with none set
  instrumentation.ts     Next server-start hook: ENFORCES the Seeker egress pin as a DEPLOY GATE since feat-306 — logs [seeker-egress] event=misconfigured reason=allowlist_unset|host_not_allowed effect=boot_refused_all_requests|seeker_sends_and_history_refuse (the effect= token IS the posture), then THROWS in a production build, so the server listens but 500s every route (incl /api/health) and the healthcheck refuses to promote. Report-only outside a production build — and only host_not_allowed is reachable there, since allowlist_unset is production-only by construction, so an unset allowlist logs NOTHING outside production. A failed diagnostic (event=diagnostic_failed stage=import|call) never throws and fails OPEN. The proxies remain the security control (see "Production egress pin")
  components/
    shell/
      app-shell.tsx      'use client' — owns conversation state (useConversations) + sidebar view state (collapsed rail / mobile drawer open); matchMedia breakpoint reset, body scroll-lock, <main> inert focus-trap; mobile-only top bar (menu trigger + brand, feat-270 — the drawer trigger never floats over transcript text)
      sidebar.tsx        'use client' — responsive left rail composition (scrim + <aside>): desktop expanded ↔ collapsed icon-rail + mobile off-canvas drawer. Presentational shell now — UI mechanics live in use-sidebar-chrome, collapsed-style policy in sidebar-collapsed-styles, visible-row policy in sidebar-projection (applied here at render, feat-281 Ruling 4b), sub-rows in the sidebar-* components
      use-sidebar-chrome.ts        'use client' — sidebar UI-mechanics hook: collapse clip state machine (+ 400ms fallback timer), Escape-to-close listener, drawer focus trap/restore. Derives presentation from collapsed/mobileOpen; owns no view state
      sidebar-collapsed-styles.ts  collapsedStyles(collapsed) → the md:-scoped collapsed-rail class policy in one slot-keyed map (header/brand/wordmark/newButton/nav/account/signIn/signOut/…); signIn is deliberately NOT newButton (differs by md:mx-auto + md:hover:border-transparent)
      sidebar-header.tsx           Brand mark + wordmark + the three mutually-exclusive controls (desktop collapse toggle / collapsed expand affordance / mobile close X); presentational
      sidebar-new-conversation.tsx New-conversation action (full-width labeled ↔ centered icon-only when collapsed); presentational
      sidebar-conversation-list.tsx Conversation history nav (select + per-row replying pulse; hidden when collapsed); presentational
      sidebar-projection.ts        feat-281 (Ruling 4b): the sidebar-facing projection module — listConversations (the visible-row filter + ordering the rail renders; sidebar.tsx applies it) + the HistoryListUi type (the session snapshot's history field satisfies it structurally)
      sidebar-account.tsx          Rail-foot account control (feat-207): signed-out "Sign in" anchor / signed-in identity (name→email→label, avatar→initials→icon) + "Sign out" POST form + R12 notice; presentational, three-presentation coverage; hidden when auth unconfigured
      icons.tsx          Inline line-icon components (panel/compose/menu/close/chevron/…) — currentColor, no icon dependency, no emoji
    chat/
      chat.tsx           Conversation pane — the centered 680px reading "room" (presentational); a ResizeObserver on the composer band re-pins a bottom-pinned reader on auto-grow (never a scrolled-up one) and keeps the scroller's scroll-padding sized to the band (feat-270)
      message-list.tsx   Renders turns (Embersoot user bubble = React-escaped plain text / assistant turns via assistant-markdown) + streaming pulse (aria-live), grounded badge (3 states, plain-language title tooltips — feat-270), stub-only visible engine marker (the machine data-engine tag stays on finalized turns that carry an engine; replayed and user-stopped turns deliberately carry none), role="alert" failure notice, and the feat-328 VideoCard sibling block (streaming + finalized branches, after the markdown content — never through the markdown allowlist)
      assistant-markdown.tsx  feat-268: hardened markdown for ASSISTANT turns only — react-markdown + remark-breaks, element allowlist (p/strong/em/ul/ol/li/blockquote/code/a/br), raw HTML → inert text (no rehype-raw, skipHtml stays false), https-only links via untrusted-link, Vigil-token styling (blockquote = font-scripture), streaming cursor slot, THREE pathological-input controls that each degrade one turn to plain pre-wrap text (chat has no app-level error boundary): prefix guard (short deep-nesting crash) + length cap at the 8192-unit per-message ceiling (shape-agnostic freeze bound, catches emphasis nesting the prefix regex misses) + MarkdownRenderBoundary (any throw the guards miss)
      untrusted-link.tsx feat-268: the ONE hardened anchor for untrusted URLs (isHttpsUrl gate + target=_blank + rel="noopener noreferrer" + sr-only suffix); shared by sources-list + assistant-markdown so the surfaces cannot drift
      video-card.tsx     feat-328: the featured video as an inline Mux player — lazy `next/dynamic(() => import("@forge/video-player/mux-video"), {ssr:false})` so hls.js stays out of the initial load, derived image.mux.com poster, title+duration caption whose link goes through untrusted-link. Mux gets ONLY the pattern-gated playbackId + this origin: disableTracking/disableCookies are passed EXPLICITLY (never inherited from the package defaults) and no metadata/viewer-id prop exists. Carries its OWN per-message VideoRenderBoundary (the MarkdownRenderBoundary pattern) — the card renders OUTSIDE the markdown boundary and chat has no app-level one, so a MuxVideo/hls.js throw degrades that ONE turn to a plain line, never the tree. Its `children` is a render callback so the two failure CLASSES converge on that one fallback: a render-phase throw (caught by getDerivedStateFromError) AND an async playback `error` event (which no React boundary can catch — MuxVideo's onError calls `fail`). Scope caveat worth keeping straight: a CHUNK-load failure is NOT per-turn and is NOT retryable at the import layer — the rejection is cached by BOTH Turbopack's emitted runtime and React.lazy's module-scoped payload, so every video turn degrades together until a page reload (see "Featured video" below for the mechanism and its bundler scope)
      sources-list.tsx   Collapsed "Sources · N" disclosure of cited passages (feat-269: deduped by URL, snippets line-clamped behind per-source disclosures) or explicit always-visible "No sources cited" state; untrusted RAG sources → https-only links via untrusted-link, text never HTML (feat-205)
      composer.tsx       Auto-growing textarea; the 44px send slot is a Vesper up-arrow when a draft is ready, a dim dot otherwise, and a stop control while pending (feat-270 — R22 blocked states keep the plain disabled send)
      empty-state.tsx    "What would you like to ask?" heading + starter questions
    brand/
      brand-lockup.tsx   Inlined JFP flag mark + "jesusfilm.ai" wordmark
  lib/
    chat-stub.ts         Reply seam (still the single swap point): streamReply() — stub path (buildStubReply) OR Seeker path (POST /api/seeker, parse SSE, first-terminal-wins). Honest since feat-281 (Ruling 3): every error frame — gate_denied included — returns { ok: false, reason, partialText } truthfully; the session owns stub-vs-failure. Also owns the two defensive wire projections: toSources and the feat-328 toVideo (see "Featured video" below)
    sse.ts               Chat-local SSE parser (readSseStream + encodeSseFrame), forked from admin's reference; used by the proxy AND the client seam
    cn.ts                Tiny conditional-className joiner (no clsx/tailwind-merge dependency)
    is-https-url.ts      The https-only link gate for untrusted content, shared by sources-list + assistant-markdown (feat-268)
    server/mastra-upstream.ts feat-282: the shared Mastra upstream transport both proxy families import — hostAllowed (the SSRF guard: https floor with loopback + *.railway.internal http carve-outs, optional host allowlist), validateBaseUrl → the ValidatedBaseUrl brand minted only from hostAllowed's success path (feat-294 — postMastraUpstream's baseUrl demands it, so skipping the guard is a compile error, not a convention; null maps to each proxy's own deny wire), MAX_CONVERSATION_ID_CHARS, postMastraUpstream (the fetch shape: URL-from-path+base, POST, bearer, JSON content-type, per-proxy accept, redirect:"error", signal), composeUpstreamAbortSignal (skips absent sources; single source passes through as-is), classifyUpstreamFailure (timeout | cancelled | network — seeker's check precedence, budget → caller-abort → error name, canonical for both proxies; each proxy keeps its own wire mapping), readJsonCapped + undefinedOnAbort (the byte-capped read + abort-race helper). Pure (no env reads), `import "server-only"`-guarded; deny ladders, budgets, byte-cap SIZES, response channels, and the gate stay per-proxy. Its test file carries the railway.internal label-boundary matrix + direct unit coverage of every transport helper
    seeker-gate.ts       feat-233: resolveSeekerGate — kill switch + verified email + SEEKER_ALLOWED_EMAILS membership → {seekerEnabled, outcome} + the [seeker-gate] R15 log line (grants and denials, sub not email)
    conversations.ts     Message (+ optional sources/grounded/engine/error/video) + SeekerSource + VideoAttachment (feat-328) + ReplyFailureReason + Conversation types (feat-241 additive: origin, serverPersisted, lastActivityAt, replay state) + createConversation / deriveTitle / fallbackTitle
    history-client.ts    feat-241: never-throw typed client for /api/history/* — fetchHistoryPage / fetchHistoryThread with the closed access | not_available | unavailable reason set
    conversation-session.ts feat-281: the framework-agnostic conversation session (no React imports) — createConversationSession(deps) owns EVERY conversation machine behind a subscribe/getSnapshot store: send + async streaming lifecycle (empty assistant turn → token append → terminal finalize/error), per-conversation AbortController slots (pending + double-send guard, released in finally), stopReply's quiet finalize (feat-270), new/select with draft semantics, history hydration/paging/merge (feat-241), lazy single-flight replay, R22 send blocking, and ALL of KTD10 (the three markServerPersisted branches + mergeServerThreads' hydration stamp + the stub-vs-failure decision: captured at send START from serverPersisted, gate_denied on a never-persisted conversation rebuilds the immediate inline stub in the finalize — buildStubReply directly, never streamStubReply's 800ms delay). getSnapshot is cached — new identity only on commit; snapshot.conversations is the FULL list (the sidebar projects it — Ruling 4b). Construction is side-effect-free; activate() arms hydration/replay, deactivate() aborts in-flight fetches AND rolls their pending states back so re-activating the SAME instance re-arms (the StrictMode setup→cleanup→setup contract). Deps (streamReply + the two history fetchers + seekerEnabled) are injected — the direct unit suite drives the machines with no DOM. Pure merge/order helpers exported for tests
    use-conversations.ts Thin 'use client' adapter over the session (feat-281): one session per hook lifetime (useState initializer), useSyncExternalStore for the snapshot, a mount effect driving activate/deactivate. Returns the same 16-field UseConversations shape as before the extraction (conversations = the full unprojected list since PR 2)
public/                  Static assets served by URL (Next.js convention, matches apps/web)
  brand/
    jfp-sign.svg         JFP flag mark — canonical source (the mark is inlined in brand-lockup.tsx); primary favicon
    jfp-sign-32.png      32px PNG favicon fallback for Safari, which renders no SVG favicons (feat-270)
    jesus-film-logo.svg  Full wordmark (unused for now; kept for longer-form surfaces)
```

- **State ownership:** all conversation state lives in the framework-agnostic
  session module (`lib/conversation-session.ts`, feat-281); `useConversations`
  is a thin `useSyncExternalStore` adapter over one session instance, consumed
  by `AppShell`, which also owns sidebar _view_ state (`collapsed`,
  `mobileOpen`). Data flows one way: session → `useConversations` → `AppShell`
  → `Sidebar` / `Chat` → leaf components. Both `chat.tsx` and `sidebar.tsx` are
  presentational compositions now: `sidebar.tsx` lays out the scrim + `<aside>`
  and delegates its local _UI mechanics_ (collapse clip animation, Escape
  listener, drawer focus trap) to the `useSidebarChrome` hook, its collapsed
  class policy to `collapsedStyles`, its visible-row projection to
  `sidebar-projection` (feat-281 Ruling 4b — the session hands the full list;
  the rail decides what it shows), and its rows to the `sidebar-*`
  sub-components (feat-203). State ownership stays in `AppShell` — the hook
  only derives presentation from the `collapsed`/`mobileOpen` flags.
- **The reply seam:** reply generation is isolated in `lib/chat-stub.ts`
  (`streamReply` — stub path OR Seeker proxy, selected by the `seekerEnabled`
  flag), injected into the session as a dep. The session orchestrates the
  streaming lifecycle (append an empty assistant
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
  `<main>` is `inert` while open). This too may change. For anonymous and
  gate-denied users, multi-conversation state is client-only and resets on
  refresh; signed-in gate-granted users hydrate the sidebar from the server
  and resume threads (see "Server-side conversation history (feat-241)").

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
  `route`) and denies with a terminal `gate_denied` frame the seam reports
  honestly (feat-281 Ruling 3) — the conversation session then rebuilds the
  original client stub (`buildStubReply`) for never-persisted conversations,
  so any deny still renders the stub; full grant → messages stream from
  Seeker.
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
  frame; since feat-282 the transport mechanics (fetch shape, signal
  composition, failure classifier, the byte-capped 503 error-body read) come
  from the shared `lib/server/mastra-upstream`, while the SSE wire mapping
  and budgets stay here. Plain-string logging only.
- **Access posture (feat-233; supersedes the feat-205/feat-208 "open proxy"
  framing):** an inbound per-user auth gate now EXISTS — the seeker dogfood
  gate is enforced on every request before config checks or any upstream
  fetch, so an anonymous or denied POST gets a terminal `gate_denied` frame
  and never reaches Mastra (no paid generation, no durable rows). The route
  stays world-reachable HTTPS and un-RATE-limited: each granted turn is still
  a ~90s paid generation writing durable rows into the SAME Postgres as
  Mastra runtime storage, so the cost/storage-amplification surface is now
  bounded by the allowlisted dogfood roster + the prompt-length cap rather
  than URL obscurity. Within that granted lane the storage bounds still hold,
  honestly framed: the per-resource thread ceiling (200, `thread_limit`)
  bounds a cooperative or runaway client; the retention purge caps total junk
  at ~one retention window × inflow but NOT in-window growth, and a
  concurrent burst can saturate Mastra's small ai-chat pool long before
  storage matters. A per-caller rate/concurrency cap remains the open
  prerequisite before the audience widens — the R15 grant log is the interim
  volume signal; do not "fix" this surface piecemeal without that work.
- **Production egress pin (`SEEKER_MASTRA_ALLOWED_HOSTS`).** The var stays
  `.optional()` (chat's boots-clean-with-nothing contract), but what UNSET
  MEANS is environment-dependent: outside production it trusts the
  operator-set base host; **in production an unset allowlist DENIES**, because
  the scheme floor alone admits any `https://…` base, so a typo'd or tampered
  `SEEKER_MASTRA_BASE_URL` would egress the `AI_CHAT_MASTRA_API_KEY` bearer
  and prompt text to it. The policy is `requireSeekerEgressAllowlist()`
  (production only), carried on BOTH proxies' config as `requireAllowlist` and
  threaded into `validateBaseUrl` — the third arg of `hostAllowed` /
  `validateBaseUrl` is required with no default, so a new call site cannot
  silently inherit fail-open. **Request-path enforcement at the proxies is the
  actual security control** — a missing pin denies exactly the calls that would
  carry the bearer (`ssrf_blocked` frame / history 502) while the stub path,
  page, and auth keep working. Since feat-306 `instrumentation.ts` adds a
  DEPLOY GATE on top: on a genuine misconfiguration in a production build it
  logs the enum line and then THROWS. A throw rejects Next's `prepare()`
  process-wide, so under `next start` the server still LISTENS and returns HTTP
  500 on every route (including `/api/health`), staying alive and re-throwing
  the hook once per request — it is NOT a dead port (verified by hand
  2026-07-27 on `next@16.2.4`, non-standalone: `next build` then `next start`
  with the pin violated, `curl -o /dev/null -w '%{http_code}' /api/health` →
  500, `pgrep` still finds the process; no CI assertion holds this, so
  re-verify on a Next bump or if chat adopts `output: "standalone"`).
  feat-305's `healthcheckPath = "/api/health"` (60s) turns that 500 into a
  FAILED DEPLOY: the probe gets 500, not 2xx, so the build is never PROMOTED
  and the previous healthy deployment keeps serving. Scope it honestly — the
  gate covers PROMOTION only: an already-promoted deployment restarting into
  the same throw is not re-probed, and rollback does not undo an env change;
  the recovery there is to revert the variable, not the deployment, and until
  then chat is fully down (the process never exits, so `restartPolicyType`
  does not fire). It also depends on the service's "Config-as-code Path"
  actually pointing at `railway.toml` — unwired, there is no probe and the
  broken build promotes; confirm it the way feat-305 did, by seeing the
  healthcheck run in a chat deploy's Railway build log. BOTH layers are armed
  by the production BUILD, not by the deployed environment's `NODE_ENV` — this
  one is easy to get backwards: `next build` replaces `process.env.NODE_ENV`
  with the literal `"production"` in the server bundle, and `config/env.ts`
  reads it by direct member access
  (`NODE_ENV: emptyToUndefined(process.env.NODE_ENV)`), so
  `requireSeekerEgressAllowlist()` compiles down to a constant-true comparison.
  Both layers are therefore armed in EVERY production build — every deployed
  environment, and a local `next build` + `next start` too. An operator CANNOT
  opt an environment into report-only by setting `NODE_ENV=staging`; only
  `next dev` and the test runner stay fail-open, and an unset allowlist logs
  nothing there because `allowlist_unset` is production-only by construction
  (verified by hand 2026-07-27: a `NODE_ENV=staging` build still emitted
  `NODE_ENV: …("production")` into the env chunk, and the resulting server
  500ed `/api/health` with the pin violated while still listening). The
  consequence is that there is no staged rollout — provision the allowlist in
  EVERY environment you deploy, before the code that requires it lands there.
  Outside a production build the hook stays
  report-only (note `next start` IS a production build, so a mismatched
  allowlist 500s a local build+start run). A failed diagnostic never throws and
  deliberately fails OPEN — `event=diagnostic_failed stage=import|call` means
  that deploy promotes with the gate disarmed; treat it as an alert, and note
  `stage=import` means every real route is 500ing on the same module while the
  zero-import health route still answers 200. **Deploy
  ordering:** set the env var in an environment BEFORE shipping code that
  requires it there, or the first deploy lands with the pin already violated.
  Value is hostnames only, CSV, no scheme or port (`.env.example` ships
  `localhost` to match its localhost base URL).
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

## Featured video (feat-328)

The terminal SSE `result` frame may carry one video the Seeker featured on that
turn. Plan: `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md`
(unit U3); mastra owns the producer side (feat-327) behind its default-off
`SEEKER_VIDEO_ENABLED` flag, so nothing renders until that flips.

- **Terminal-frame only (plan D3).** No new SSE event, no proxy change — the
  proxy already relays result frames verbatim, and there is deliberately NO
  mid-stream `onVideo` callback. The wire shape is
  `{ videoId, title, slug, playbackId, durationSeconds, languageSlug }`
  (the last two nullable).
- **`toVideo` in `lib/chat-stub.ts` is the trust boundary (plan D9/P7).**
  Field-by-field allowlist; `playbackId` must match `^[A-Za-z0-9_-]{8,64}$`
  and `slug` must match `^[a-z0-9][a-z0-9_-]{0,80}$` — **case-SENSITIVE**, so
  odd-cased values fail closed rather than slipping past
  `buildCanonicalWatchVideoPath`'s exact `=== "english"` comparison. That slug
  pattern is the SOLE control over the built path (the policy interpolates
  raw), which is why it excludes `/ ? # %` and whitespace. Any REQUIRED-field
  failure yields `undefined` and the turn simply renders without a player.
  **All three gates (`videoId`, `playbackId`, `slug`) are a deliberate MIRROR
  of `apps/mastra/src/mastra/seeker-video-gates.ts` (feat-327)** — apps cannot
  cross-import, so changing one means changing the other, and the chat comment
  names that module (note the pointer is currently ONE-WAY: mastra's docstring
  names its own two consumers, not this mirror). A non-conforming slug reaching
  `toVideo` is a contract break, and the gate rejecting it is correct. The
  mirror is NOT symmetric in the loosening direction: chat's slug gate is the
  sole control in front of `buildCanonicalWatchVideoPath`'s raw interpolation,
  so it may only ever be TIGHTENED — never relaxed to match a relaxed producer.
  Verified against the merged twin on 2026-08-04: `PLAYBACK_ID_PATTERN` and
  `SLUG_PATTERN` are byte-identical; `VIDEO_ID_PATTERN` was added here to close
  the drift. Mastra's `FEATURABLE_AVAILABILITY_KIND` has no chat counterpart by
  design — availability never crosses the wire.
  **The slug gate is link-integrity-bearing as well as security-bearing.** It is
  the sole control over the raw-interpolated path, AND the two non-conforming
  (accented) slugs seen on the agent-tools wire have no published watch page —
  so admitting them would ship a working player beside a dead caption link. The
  method behind that census lives in the mastra twin's docstring.
- **The wire `title` is bounded at the RENDER layer only, never at the
  projection.** `toVideo` checks non-empty and stops there — a long catalog
  title must never cost the whole row (pinned by a 10,000-char `toVideo` test).
  The caption `line-clamp-2`s (the full text stays in the DOM for selection and
  screen readers) and the player's `aria-label` is whitespace-collapsed and
  truncated to 200 UTF-16 CODE UNITS — not characters — since CSS cannot reach
  an accessible name; the cut drops a trailing lone surrogate so an emoji at
  the boundary never lands half-encoded. Do not add a display utility beside
  `line-clamp-2`: any of them silently unclamps it (browser-caught in
  feat-269), which is why both this suite and `sources-list.test.tsx` carry the
  same 13-name denylist — keep the two in step.
- **No URL is ever trusted from the wire.** `watchUrl` is built client-side as
  `https://www.jesusfilm.org/watch` + `buildCanonicalWatchVideoPath(slug,
languageSlug)` from `@forge/watch-url-policy/routes`; a `watchUrl` on the
  wire is ignored (pinned by a hostile-payload test). **`languageSlug` is
  deliberately asymmetric with mastra's projection:** an absent or invalid one
  falls back to the default watch language HERE, while the mastra side drops
  the declared row — both behaviors are test-pinned, so do not "harmonize"
  them. Only the CONTENT slug is a rejection vector on this side.
- **Rendering** is `chat/video-card.tsx` as a sibling block below the message
  text (the SourcesList pattern), in both the streaming and finalized
  branches — never through the markdown element allowlist, which stays locked
  (plan D2). `assistant-markdown.tsx` is untouched by this feature.
- **Failure containment is per-turn for the per-turn faults only.** The card's
  own `VideoRenderBoundary` catches a render throw, and MuxVideo's `onError`
  routes an async playback failure (which no React boundary can catch) to the
  SAME fallback line; the caption link stays reachable either way, and the
  reserved 16:9 box collapses with the player rather than framing the
  fallback. A CHUNK-load failure is NOT per-turn and is NOT retryable at the
  import layer: it degrades every video turn in the session until a page reload
  (caption links stay live), and there is deliberately no user-facing reload
  affordance today — feat-334 owns that seam. See
  `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`
  for the two-cache-layer mechanism, the bundler-scope caveat and the
  verification commands; re-verify THERE on any Next/bundler change, not here.
  Do not restate the containment claim without this carve-out.
- **No egress or CSP change (plan E11):** the browser talks to
  `stream.mux.com` / `image.mux.com` directly; `SEEKER_MASTRA_ALLOWED_HOSTS`
  covers only chat-server→Mastra. No new env var exists for this feature.
- **`[chat-video] event=projection_rejected reason=<token>` is the drift
  diagnostic.** A silently-rejected payload would make a producer/consumer wire
  drift invisible at the flag flip, so `toVideo` names WHICH gate refused:
  `shape | video_id | title | playback_id | slug`.
  **Know where it lands before you rely on it: the dogfooder's BROWSER CONSOLE,
  and nowhere else.** `apps/chat` ships no RUM, no Sentry, and no browser log
  forwarding, so this line never reaches Railway or any drain — grepping deploy
  logs for the token proves nothing. Observing drift at the flag flip means a
  human with devtools open. The operator-visible half of the pair stays
  mastra's SERVER-side `availability_missing` line; treat this as its
  client-side counterpart in intent, not in channel. It is plain-string for
  format consistency with the server lines — not because Railway ingests it.
  **This is deliberately the FIRST client-side `console` call in `apps/chat`** —
  every other one is server-side. A precedent, not an oversight: it runs in the
  browser because that is where the projection runs.
  Three rules keep it safe and quiet: the reason TOKEN only — never a wire
  value, since titles are catalog text and the frame rides a special-category
  conversation; **silence when no video was declared**, which is most turns
  (the producer omits the field, so only a value actually sent and then
  refused logs); and it is scoped to the LIVE terminal frame — a replay caller
  (feat-329 re-projects every stored turn on thread open) must suppress or
  aggregate, or one thread open becomes a burst.
- **Slug shape is not page LIVENESS (residual).** The gate proves a slug is
  well-formed, not that the watch page exists. An ASCII-slugged but unpublished
  row passes every gate here and would still ship a live player beside a dead
  caption link. Catalog hygiene owns that, not these patterns.
- **Not yet persisted:** replayed threads lose the video (and sources) until
  feat-329 lands — the accepted D7 gap.

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
  pool key at all), reusing `SEEKER_MASTRA_BASE_URL` + allowlist + the shared
  transport from `lib/server/mastra-upstream` (feat-282 — `hostAllowed`, the
  fetch shape, signal composition, the failure classifier, `readJsonCapped`;
  both proxy families import it and the seeker route no longer exports SSRF
  primitives). Read budget = `seekerTimeoutMs()` clamped to [9 s, 10 s]
  (`composeHistoryTimeoutMs` — the 9 s floor keeps the budget above Mastra's
  8 s `historyRead` even when the send-path `SEEKER_TIMEOUT_MS` escape hatch
  lowers the send budget); upstream status classified before any body parse;
  byte-capped buffered reads via the shared `readJsonCapped` (2 MiB list /
  8 MiB thread — cap sizes stay in this proxy, sized for the worst-case UTF-8
  inflation of the 8,192 UTF-16-unit per-message text cap). Deny wire (KTD8): 401 `invalid_session` (anonymous ≡ expired
  ≡ tampered), 403 `gate_denied` / `thread_forbidden`, 404 `thread_not_found`
  (only when the upstream body carries the reason — a reasonless 404 is
  `unavailable`, so config outages never read as data loss), 502/504.
- **Client mapping** (`lib/history-client.ts`): `access` (401/gate_denied) →
  silent fall-back to the client-only sidebar, no nudge (R16; the sign-in
  nudge is deferred to feat-236); `not_available` → the "no longer available"
  state; `unavailable` → error state with retry.
- **Session semantics** (`lib/conversation-session.ts`, feat-281 — reached via
  the `use-conversations` adapter): hydration fires once on activation when
  `seekerEnabled` (= full gate grant — anonymous/denied users
  never fetch; the server render path gains no awaits); merge by conversation
  id (client conversation id === server thread id): in-session messages
  authoritative, non-empty server LLM title beats the `deriveTitle` snippet,
  server-origin conversations skip the retitle branch; ordering =
  fresh-empty-local pinned, then activity-desc. Replay is per-conversation
  single-flight and session-cached (`idle → loading → loaded | failed |
not_available`; failed retries only via the explicit action); sends into a
  server-origin conversation are BLOCKED unless its replay is `loaded` (R22 —
  the composer keeps the draft, only the send action is disabled). Replayed
  turns carry no engine/grounded/source badges (R21) but get the SAME
  feat-268 markdown treatment as live turns — badge stripping, not text
  divergence.
- **Denied sends fail visibly on persisted conversations (KTD10):** a
  conversation counts as server-persisted once hydrated from history, after
  a send's SUCCESS finalize with engine `"seeker"`, after a failed Seeker
  turn that streamed partial text, or after ANY user-stopped Seeker turn
  (feat-270 — Mastra creates the thread row before generating, so even a
  zero-token stop may have persisted it; never from the engine tag alone).
  The seam reports `gate_denied` honestly (feat-281 Ruling 3); the session
  captures stub-vs-failure at send START from `serverPersisted`: persisted
  conversations render the access-changed failure copy instead of silently
  stub-forking; never-persisted conversations keep the feat-233 stub
  downgrade, rebuilt inline in the finalize (immediate — no
  `STUB_REPLY_DELAY_MS`, engine `"stub"`).
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
  rendering discipline: no raw HTML ever reaches the DOM (feat-268). User
  turns render as React-escaped plain text; assistant turns render through
  the hardened markdown pipeline (`chat/assistant-markdown.tsx`: element
  allowlist, raw HTML inert-texted, https-only links via the shared
  `isHttpsUrl` gate) — no `dangerouslySetInnerHTML`, no `rehype-raw`, no HTML
  passthrough of any kind; keep it that way. The everyone-at-once incident
  lever is rotating `CHAT_SESSION_SECRET`.
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
  `chat/message-list.tsx`, `chat/assistant-markdown.tsx`,
  `chat/untrusted-link.tsx`, `chat/sources-list.tsx`, `chat/video-card.tsx`
  (feat-328 — presentational plus a class error boundary; its `next/dynamic`
  `ssr:false` call is legal only because it inherits a client context), and the
  `shell/sidebar-{header,new-conversation,conversation-list,account}.tsx`
  sub-components carry no `'use client'` — they have event handlers but no hooks,
  so they inherit the client context of the `'use client'` modules that import
  them (`shell/icons.tsx`, the stateless SVGs, is the same). `shell/sidebar-collapsed-styles.ts`
  (a pure class-map function), `shell/sidebar-projection.ts` (pure projection,
  feat-281), `brand/*`, `lib/cn.ts`, `lib/sse.ts`,
  `lib/conversation-session.ts` (feat-281 — client-shipped but React-free by
  contract; only the `use-conversations` adapter may touch React), the `app/`
  entry files, and the server-only modules (`config/env.ts`, `app/api/seeker/route.ts`,
  `app/api/auth/*`, `auth/*` — note `auth/identity.ts` uses `next/headers` — the
  feat-233 `lib/seeker-gate.ts`, and the feat-282 `lib/server/mastra-upstream.ts`,
  both `import "server-only"`)
  stay server / framework-agnostic.
- Strict TypeScript, `src/` layout, `@/*` path alias — config mirrors
  `apps/web` (the CI-proven template).
- Tailwind v4, CSS-first (`@import "tailwindcss"` in `src/app/globals.css`;
  no tailwind.config file). Design tokens live in the `@theme` block there.
- Tests colocated (`*.test.ts(x)`). Component tests use **React Testing
  Library** (`render` / `screen` / `within` + `@testing-library/user-event`,
  with `@testing-library/jest-dom` matchers); the hook test uses `renderHook`.
  jsdom is the app-wide test env (`vitest.config.ts` `environment: "jsdom"` +
  `vitest.setup.ts`). Two classes of tests carry a top-of-file
  `// @vitest-environment node` directive. Required: the jose-touching auth
  tests (`src/auth/oauth-client`, `session-cookie`, `identity`, and the
  `src/app/api/auth/*` route tests) — `jose`'s WebCrypto path throws a
  cross-realm `payload must be an instance of Uint8Array` under jsdom (jsdom's
  `TextEncoder` produces a different-realm `Uint8Array` than jose's
  `instanceof` check). Opt-in: tests of server-only wiring that need no DOM —
  `src/auth/anon-id.test.ts`, the feat-233 `lib/seeker-gate.test.ts`, and the
  two `*.gate-wiring.test.ts` files. Not every server-module test opts in
  (`config/env`, `auth/oauth-state`, `auth/origins`, `lib/sse`, and the main
  proxy suites run under jsdom); when unsure,
  `grep -rln "vitest-environment node" apps/chat/src` is authoritative.
  Component/hook tests stay on jsdom. This is a **deliberate divergence** from the `apps/admin` /
  `apps/web` no-testing-library convention (plain `react-dom/client` + `act`),
  scoped to chat by design — it does not change those apps. Pure-function tests
  (`lib/conversations.test.ts`, `lib/chat-stub.test.ts`,
  `shell/sidebar-collapsed-styles.test.ts`,
  `shell/sidebar-projection.test.ts`) stay plain vitest. The behavioral
  suite lives in `components/shell/app-shell.test.tsx` (AppShell consumes the
  session state); the extracted `use-sidebar-chrome` hook has its own colocated
  `renderHook` unit test for its state machine in isolation. The conversation
  session (feat-281) has a direct unit suite (`lib/conversation-session.test.ts`
  — injected deps, no DOM) and the adapter a StrictMode-rendered suite
  (`lib/use-conversations.strictmode.test.tsx`); the whole-tree suites plus
  their `Remount safety` describe stay the extraction's acceptance gate.
  Gotcha pinned there: `renderHook` needs RTL's `reactStrictMode: true` option
  — a custom `<StrictMode>` wrapper doubles initializers but NOT the effect
  cycle, silently skipping the re-arm path (see the Detection pitfall in
  `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`).
  feat-328's `chat/video-card.test.tsx` +
  `chat/message-list.video.test.tsx` keep the REAL `next/dynamic` boundary and
  mock only the leaf `@forge/video-player/mux-video` — the ssr:false lazy
  resolves asynchronously under jsdom, so those assertions use `findBy*`
  (mocking `@mux/mux-video-react` itself is not an option: pnpm strict
  resolution leaves it unresolvable from `apps/chat`). Note for the
  behavioral suite: the reply lands via `setTimeout`, so it runs on fake timers
  with `userEvent.setup({ advanceTimers, ... })` under
  `vi.useFakeTimers({ shouldAdvanceTime: true })` — a plain fake clock hangs
  user-event's awaited interactions. Layout/visibility behavior jsdom can't
  represent (e.g. focus-restore-on-close, which depends on `offsetParent`) stays
  **browser-verified**, not asserted in jsdom.
- **Client-side console output carries fixed enum TOKENS only** — never message
  text, titles, wire values, or anything conversation-derived. `rejectVideo` in
  `lib/chat-stub.ts` is the reference shape: a module-private helper taking a
  closed union, interpolating that parameter and nothing else. The browser
  console is not a telemetry channel here (no RUM, no log forwarding), so a
  line there is for a human with devtools open, never for ops. The server-side
  counterpart is KTD7 under Authentication.
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
Mastra base URL + bearer, keep `SEEKER_MASTRA_ALLOWED_HOSTS` matching that base
URL's HOSTNAME (it ships pinned to `localhost`; switch it to `127.0.0.1` or
whatever host you point at, or sends fail `ssrf_blocked`),
configure chat auth against a local `apps/auth`,
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

Deploy promotion is gated on `healthcheckPath = "/api/health"` (60s, feat-305).
Scope it honestly: it catches a deployment that fails the probe — a rejected
`prepare()` returns HTTP 500 on every route including `/api/health` (the
feat-306 case, verified), and a bad bind or crashed boot refuses the connection
outright; either way the probe is non-2xx. It does NOT catch a failure confined
to one route or page, since the health route imports nothing from the app; `/`
could 500 on every request while `/api/health` stays 200 and the deploy
promotes. That shallowness is the deliberate trade: a probe with dependencies
turns a Mastra outage into a chat rollback. `restartPolicyType = "on_failure"`
stays — it covers a process that EXITS, which the healthcheck does not.

Production hostname is the Cloudflare-fronted `chat.jesusfilm.ai` (feat-235;
DNS, WAF, Authenticated Origin Pulls, DNSSEC). Railway env sets
`CHAT_BASE_URL=https://chat.jesusfilm.ai`; domain-lifecycle rules for the
OAuth seed live in
`docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md`.
