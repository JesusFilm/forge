---
title: "Browser-facing SSE proxy to a bearer-gated internal SSE service — parse-and-re-emit, classify HTTP status before the stream, one client parse path"
date: 2026-06-26
last_updated: 2026-09-03
category: architecture-patterns
problem_type: architecture_pattern
component: service_object
severity: medium
module: apps/chat
applies_when: "A browser surface must stream from an internal bearer-gated SSE service (e.g. a Mastra /forge-* route) and the bearer must stay server-side"
related_components:
  - apps/mastra
  - apps/admin
tags:
  - sse
  - streaming
  - proxy
  - nextjs
  - app-router
  - mastra
  - ssrf
  - bearer
  - error-mapping
  - railway
  - private-networking
---

## Context

A browser surface (apps/chat) needs to stream answers from an internal,
bearer-gated SSE service (Mastra's `POST /forge-seeker`). The bearer must never
reach the browser, so a server-side route handler
(`apps/chat/src/app/api/seeker/route.ts`)
proxies the call. This is the **browser-restreaming** variant of admin's
`mastra-experience-chat-client.ts` relay — admin re-emits tokens onto its own
editor channel and returns the final text server-side, whereas here the proxy
must re-stream SSE all the way to the browser, which the client then parses.

Reference (Mastra route side, feat-204):
`docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md`
and `docs/solutions/best-practices/deterministic-mastra-sse-route-testing-stub-model-budget-seam-20260625.md`.

## Guidance

**1. Parse and re-emit frames — do not raw-pipe `response.body`.** The proxy
builds its own `ReadableStream` and re-encodes upstream frames. Raw passthrough
cannot inject a synthesized terminal `error` frame when the proxy's own outbound
timeout or a transport drop fires _mid-stream_, which would strand the client
with a truncated stream and no terminal frame. Mirror the upstream route's
`start()/enqueue/closed/cancel` structure.

**2. Classify the upstream HTTP status BEFORE entering the stream parser.** This
is the load-bearing, non-obvious step. Not every failure reason arrives as an
in-stream SSE `error` frame:

- The Mastra route emits only `timeout` and `generation_failed` as in-stream
  `error` frames.
- `model_key_missing` comes back as a **503 JSON body** (a pre-stream gate), never
  an SSE frame. Auth failures are **401/403**. Route-disabled is **404**.

A naive "relay every frame verbatim" parser never sees the 503 body and
misclassifies it as a generic network error, defeating a distinct
config/unavailable user message. Check `response.status` first (mirroring admin's
client), read the 503 JSON `reason`, and only `response.ok` + non-null body
proceeds to the parser:

```ts
if (response.status === 401 || response.status === 403)
  return fail("auth_failed")
if (response.status === 503) {
  const reason = await response
    .json()
    .then((b) =>
      b?.reason === "model_key_missing"
        ? "model_key_missing"
        : "config_missing",
    )
    .catch(() => "config_missing")
  return fail(reason)
}
if (response.status === 404) return fail("config_missing")
if (!response.ok || response.body == null) return fail("network_error")
// only now: readSseStream(response.body, ...)
```

> **Relocated (2026-07-22, feat-282 PR 2):** the transport mechanics shown
> inline in this doc now live in `apps/chat/src/lib/server/mastra-upstream.ts`,
> shared by the send proxy AND the history proxies: the POST fetch shape
> (`postMastraUpstream`, with an origin pin on the composed URL), the
> three-source signal composition (`composeUpstreamAbortSignal`), the failure
> classifier (`classifyUpstreamFailure`, `timeout | cancelled | network`,
> budget → caller-abort → error-name precedence), and the byte-capped
> `readJsonCapped` + `undefinedOnAbort` — the 503 read above is now
> byte-capped (64 KiB) via that shared reader, feat-282's one declared
> hardening delta. Each proxy keeps its own wire MAPPING over the
> discriminant, deny ladder, budgets, and cap sizes. The classification
> rules in this doc are unchanged.

**3. Give the client exactly one parse path.** The proxy normalizes _every_
failure — closed gate, bad HTTP status, outbound timeout, transport drop, and
relayed upstream `error` — into a single terminal `error { reason }` frame on a
**200** SSE response. The only non-SSE response is a 400 for a malformed request
body. The browser then never branches on HTTP status; it parses frames and maps
`reason` → user-facing copy. Split the reason set in code/comments into "relayed
from upstream" (`timeout`, `generation_failed`) vs "synthesized by the proxy"
(everything else) so the parser and the synthesizer are not conflated.

**4. cancel() must actively abort the upstream fetch.** Compose the caller's
`request.signal`, the outbound `AbortSignal.timeout`, AND a handler-owned
`AbortController` into the upstream fetch signal; abort the handler's controller
in the stream's `cancel()`. Relying on `request.signal` propagation alone leaves
a paid generation draining to the timeout ceiling on any path where the signal
doesn't fire.

**5. SSRF guard: require https EXCEPT loopback and `*.railway.internal`.** The
bearer rides the outbound request, so an `http://` base would egress it in
cleartext — enforce `https:`. But exempt two private transports where the
cleartext concern doesn't apply:

- **Loopback** (`localhost`/`127.0.0.1`/`::1`) — local dev against an
  `http://localhost:4111` Mastra; the bearer never leaves the machine.
- **`*.railway.internal`** — Railway private networking, the intended prod
  transport when the internal service has no public domain (the network
  boundary IS Mastra's containment). The mesh is WireGuard-encrypted, but
  services serve plain HTTP and Railway issues no TLS cert for
  `*.railway.internal`, so `https://` can never work there. Without this
  exemption there is NO base-URL value that works in production — the guard
  contradicts its own deployment path (this happened; the loopback exemption
  masked it in local dev). The exemption is name-based and sound ONLY where
  `.railway.internal` resolves through Railway's private DNS — i.e., the app
  itself runs on Railway; elsewhere the name guarantees nothing about
  transport encryption, so a copier deploying off-platform should drop the
  exemption or gate it on `RAILWAY_ENVIRONMENT_NAME` (the platform marker
  `apps/web/src/env.ts` already reads). Match on `url.hostname` (never a substring of the
  URL string) with an END-ANCHORED dotted suffix: the leading dot makes it a
  label-boundary match, so `railway.internal.evil.com`, `evilrailway.internal`,
  bare `railway.internal`, and a trailing-dot host such as
  `mastra.railway.internal.` are all rejected. A bare `endsWith` is NOT yet a
  full-label match, though — empty-label hosts (`.railway.internal`,
  `a..railway.internal`) parse fine in the WHATWG URL parser and satisfy the
  suffix, so pair it with the empty-label rejections shown below.

```ts
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const host = url.hostname.toLowerCase()
const railwayInternal =
  host.endsWith(".railway.internal") &&
  !host.startsWith(".") && // no empty leading label (".railway.internal")
  !host.includes("..") // no empty inner labels ("a..railway.internal")
const privateHttp =
  url.protocol === "http:" && (LOOPBACK.has(host) || railwayInternal)
if (url.protocol !== "https:" && !privateHttp) return false // ssrf_blocked
```

> **Relocated (2026-07-21, feat-282 PR 1 — #1661):** this guard now lives as
> `hostAllowed` in `apps/chat/src/lib/server/mastra-upstream.ts`, imported by
> BOTH the send proxy and the history proxies (it is no longer exported from
> the seeker route file); the label-boundary test matrix is direct unit
> coverage beside it. The logic above is unchanged.

Keep the host allowlist check after the scheme floor; an unset allowlist trusts
the operator-set host (admin parity; `redirect:"error"` still blocks off-host
hops), but the scheme floor applies regardless — including to
`*.railway.internal` hosts, which a configured allowlist still gates. As
defense-in-depth, prod should set the allowlist to the exact internal host —
"should" not "must" because Railway private networks are isolated per
project+environment, so an unset allowlist's worst-case http misconfig reaches
only a sibling service in the same environment; treat the allowlist as
REQUIRED if the environment ever hosts services outside this trust boundary.

> **"Should" became "must" in production (2026-07-24, feat-304 — #1731):** the paragraph above is
> retained as the original reasoning, but its blanket "an unset allowlist trusts
> the operator-set host" is no longer true for `apps/chat`. `hostAllowed` /
> `validateBaseUrl` now take a third required `requireAllowlist` argument, and
> `requireSeekerEgressAllowlist()` (`apps/chat/src/config/env.ts`) sets it for
> any production BUILD — so an unset `SEEKER_MASTRA_ALLOWED_HOSTS` DENIES every
> send and history read there, rather than trusting the base host. The trigger
> for tightening was not the sibling-service worst case but the wider one the
> old text did not price: the scheme floor alone admits any `https://` base, so
> a typo'd or tampered `SEEKER_MASTRA_BASE_URL` egresses the ai-chat lane bearer
> and prompt text to an arbitrary public host. Enforcement is at the proxies,
> not a boot throw — chat's `railway.toml` has no healthcheck, so a throwing
> `register()` would take the whole app down with no rollback; `instrumentation.ts`
> reports the misconfiguration and never throws. Operators must provision the
> allowlist in every deployed environment BEFORE shipping code that requires it.

> **The rollback premise changed (2026-07-24, feat-305 — #1762).** The note above says
> chat's `railway.toml` has no healthcheck — true when it was written, false
> now: `railway.toml` carries `healthcheckPath = "/api/health"` (60s). A
> throwing `register()` is therefore caught — `prepare()` rejects and (verified
> under `next start`) the server still LISTENS but returns HTTP 500 on every
> route including `/api/health`, so the probe gets 500 (not 2xx) and the
> deployment is not promoted.
> The general law survives intact and is the reusable part: **your fail-closed
> enforcement point is a function of your rollback capability.** Two limits keep
> the report-only choice standing until feat-306 — the gate covers PROMOTION
> only (an already-promoted deployment restarting into the same throw is not
> re-probed, and rollback does not undo a service-variable edit), and the probe
> has not yet been observed gating a real deploy.

> **The gate is armed (2026-07-27, feat-306).** Both limits above have now been
> priced and accepted: `apps/chat/src/instrumentation.ts` THROWS on a genuine
> misconfiguration in a production build, so the 500 on `/api/health` fails the
> probe and the misconfigured build is never promoted. Read the two notes above
> as history — "reports the misconfiguration and never throws" is no longer
> chat's posture. The gate still covers PROMOTION only: an already-promoted
> deployment restarting into the same throw is not re-probed, and the recovery
> there is to revert the service variable, not the deployment. Request-path
> enforcement at the proxies remains the actual security control; the boot throw
> is a deploy gate on top of it, and a FAILED DIAGNOSTIC deliberately fails open
> rather than failing the deploy. That the probe GATES (rather than merely runs)
> is proven by a production experiment after feat-306 lands, not before it.

> **Sibling application: Mastra to Forge RAG (2026-09-03, feat-434 —
> [#2153](https://github.com/JesusFilm/forge/pull/2153), open at this
> update).** Mastra applies the same private-HTTP transport exception to
> `JESUSFILM_RAG_BASE_URL`, but its production host pin is always mandatory:
> HTTPS and Railway-private HTTP both pass through the same exact
> `JESUSFILM_RAG_ALLOWED_HOSTS` membership check
> (`apps/mastra/src/config/env.ts:1427-1451`). The optional-integration
> boundary is separate: an unset RAG URL still returns before validation, so
> unrelated agents do not acquire a new required variable; once configured in
> production, an invalid URL or missing host pin fails shared Mastra startup
> (`apps/mastra/src/config/env.ts:1614-1621`,
> `apps/mastra/src/mastra/index.ts:185`).
>
> Pin every conjunct independently. The Mastra matrix accepts the exact private
> host; rejects a valid private host when its allowlist is missing or names a
> sibling; rejects bare, prefix-lookalike, suffix-lookalike, leading-empty,
> inner-empty, and trailing-dot hostnames; and retains the public-HTTP,
> allowlisted-HTTPS, and non-production cases
> (`apps/mastra/src/config/env.test.ts:1065-1192`). The missing- and
> mismatched-allowlist cases should fail under a mutation that lets private HTTP
> bypass the exact pin; a happy-path test alone proves only that the exception
> opens. Because this guard runs before the shared Mastra runtime initializes,
> pair the focused environment suite with the full Mastra test, lint,
> typecheck, and build gates. Validation for PR #2153 recorded 179 focused
> environment tests and 3,015 full-suite tests passing, but those results are
> execution evidence rather than a permanent claim about the tree.
>
> Repository checks and live checks answer different questions (session
> history). Unit and service suites prove the configuration matrix and broad
> agent regression posture; only the deployed service can prove private DNS,
> process boot with the exact variables, authenticated retrieval, source
> presentation, and rollback. Deploy the guard before changing the URL and
> allowlist atomically, retain the public values, smoke Seeker, observe, and
> restore both values together on failure. The open cutover contract remains
> `docs/roadmap/rag/feat-434-rag-seeker-cutover.md`.

**6. First terminal frame wins (both sides).** The proxy emits exactly one
terminal frame then closes; the client treats the first `result`/`error` as
authoritative and ignores later frames. This guards the route-timeout-vs-proxy-
timeout race when the two budgets are close (e.g. 90s route vs 95s proxy).

**7. Body-conditional reason passthrough binds EVERY hop of the chain
(buffered-JSON history variant — added 2026-07-14, feat-241, unmerged as of
this writing).** The SSE path sidesteps semantic client-side status
classification (#3); the history surfaces (`/api/history/*`, the buffered-JSON siblings in the
supersession note below) instead speak status + JSON `reason` at each hop —
Mastra route → chat proxy → browser client — and there the classification rule
is the CHAIN's contract, not one hop's implementation detail. The rule: a
status code alone is never a semantic discriminator. Data-level meanings
("gone", "forbidden") require the chain's own reason literal in the body; a
reasonless or non-JSON response gets the infrastructure meaning (retryable
`unavailable`) — because any hop can be handed a status by infrastructure that
doesn't speak the vocabulary (a chat-router 404 after a rollback/deploy skew,
middleware/CDN interception, a front-door HTML error page). feat-241 shipped
the rule at the proxy hop from the start (`history-proxy.ts`: a reasonless
upstream 404 is `unavailable`, "never 'your conversations were deleted'") but
initially NOT at the browser client, which mapped any 404 to the
session-cached data-loss state — so a config outage would have rendered "This
conversation is no longer available" and stayed that way after the outage
cleared (the replay state is session-cached and blocks sends, R22). Caught in
the pre-push Tier-2 review, where two independent model families (the
in-process adversarial persona and a Codex cross-model pass) converged on it.
The fix mirrors the proxy at the last hop: `failureReasonFor`
(`apps/chat/src/lib/history-client.ts:64-81`) maps 403 AND 404 to
`access`/`not_available` only when the body carries the proxy's own
`gate_denied`/`thread_forbidden`/`thread_not_found` literal; reasonless →
`unavailable`. Two riders: when classifying ambiguity, prefer the
retryable/infrastructure reading over the destructive/data-loss one — doubly
so when the wrong state gets cached (a cached destructive state converts a
transient outage into a permanent-looking loss); and every hop's suite needs a
reasonless AND a wrong-shape (non-JSON) fixture for each semantically-mapped
status (`history-client.test.ts:43`, `:51-57`, `:59-71`) — a reason-carrying
fixture alone satisfies both a status-only classifier and the body-conditional
one, so only the reasonless/non-JSON cases make the body check load-bearing
(see `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`,
which carries this as a worked instance). Genus sibling:
`docs/solutions/best-practices/client-mirror-server-dedupe-per-id-contract-20260506.md`
— a client must mirror a server-side boundary discipline, stated in both
halves' comments.

## Why This Matters

The contract mismatch in guidance #2 is invisible to mocked tests that only feed
SSE frames — they never exercise a 503-body upstream, so the bug ships green. The
one-parse-path design (#3) is what lets the client stay simple and the failure
UX stay correct; without it, half the failure reasons silently collapse to
"network error" and the dogfood's failure-mode signal is corrupted. The bearer
stays server-side throughout, and a boolean is the only flag value crossing to
the browser.

**This pattern secures the OUTBOUND leg only — it does NOT add an inbound gate.**
The bearer/SSRF/https hardening protects the egress to the internal service; it
says nothing about who may call the proxy. The reference implementation ships
deliberately unauthenticated and un-rate-limited (accepted v1 risk: a
world-reachable but unadvertised Railway domain), and since each turn is a ~90s
paid generation, an open proxy is a cost-amplification surface. The only inbound
lever applied is a prompt-length cap (`MAX_PROMPT_CHARS`). A real inbound auth
gate AND a per-caller rate/concurrency cap are HARD PREREQUISITES before the
audience widens — do not copy this pattern onto a wider-audience surface without
solving the inbound gate separately.

> **Posture partially superseded (2026-07-13, feat-241):** the chat HISTORY
> surface (`/api/history/*`, buffered JSON siblings of this SSE proxy sharing
> the same base URL/host-allowlist discipline) ships WITH a real inbound gate —
> a valid signed session resolved server-side (401 `invalid_session` otherwise)
> plus, for the dogfood phase, the seeker allowlist gate (surface `"history"`;
> removed by feat-236). The "deliberately unauthenticated" posture note above
> now describes the SEND path (`/api/seeker`) only; the rate/concurrency cap
> remains the open prerequisite on both.

## When to Apply

Any browser surface that must stream from an internal bearer-gated SSE service.
The HTTP-status-before-stream classification (#2) applies whenever the upstream
returns _some_ failures as pre-stream HTTP responses and others as in-stream
frames — verify which is which before writing the relay. Note the scope limit in
"Why This Matters": this pattern is the _outbound_ relay only — pair it with an
inbound auth gate + rate cap before any non-trivial audience reaches it.

## Examples

- Outbound timeout sits strictly above the upstream's own generation ceiling
  (95s proxy vs 90s route) so a route-side timeout returns a clean relayed
  `timeout` rather than the proxy aborting first and reporting a network error.
  The window's upper bound is the platform connection ceiling — on a bare Railway
  domain (no Cloudflare) a >95s public stream survives; re-confirm if Cloudflare
  ever fronts the origin.
- Plain-string structured logging only in the route handler
  (`[seeker-proxy] event=… reason=…`), never `JSON.stringify` — see
  `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`.
- Never log the forwarded thread/conversation id (confidentiality of the
  unguessable id is the only cross-conversation barrier pre-auth).
