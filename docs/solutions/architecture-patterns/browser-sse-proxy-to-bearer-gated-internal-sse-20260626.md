---
title: "Browser-facing SSE proxy to a bearer-gated internal SSE service — parse-and-re-emit, classify HTTP status before the stream, one client parse path"
date: 2026-06-26
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
---

## Context

A browser surface (apps/chat) needs to stream answers from an internal,
bearer-gated SSE service (Mastra's `POST /forge-seeker`). The bearer must never
reach the browser, so a server-side route handler (`app/api/seeker/route.ts`)
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
  and bare `railway.internal` are all rejected. A bare `endsWith` is NOT yet a
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

Keep the host allowlist check after the scheme floor; an unset allowlist trusts
the operator-set host (admin parity; `redirect:"error"` still blocks off-host
hops), but the scheme floor applies regardless — including to
`*.railway.internal` hosts, which a configured allowlist still gates. As
defense-in-depth, prod should set the allowlist to the exact internal host —
"should" not "must" because Railway private networks are isolated per
project+environment, so an unset allowlist's worst-case http misconfig reaches
only a sibling service in the same environment; treat the allowlist as
REQUIRED if the environment ever hosts services outside this trust boundary.

**6. First terminal frame wins (both sides).** The proxy emits exactly one
terminal frame then closes; the client treats the first `result`/`error` as
authoritative and ignores later frames. This guards the route-timeout-vs-proxy-
timeout race when the two budgets are close (e.g. 90s route vs 95s proxy).

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
