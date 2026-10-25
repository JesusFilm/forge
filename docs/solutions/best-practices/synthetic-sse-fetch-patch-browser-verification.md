---
title: "Synthetic-SSE fetch-patch browser verification for client-side chat UI changes"
date: "2026-07-20"
category: "best-practices"
module: "apps/chat"
problem_type: "best_practice"
component: "testing_framework"
severity: "medium"
applies_when:
  - "A client-side chat UI change (rendering, interaction, scroll, streaming state) needs real-browser verification with controlled multi-source Seeker replies"
  - "The live Seeker path is down or unprovisioned locally (config_missing sends) while the per-user seeker gate grants"
  - "Edge-shape fixtures (duplicate URLs, junk urls, non-https links, extreme snippet lengths) are needed that the real corpus won't produce on demand"
related_components:
  - "apps/chat/src/lib/chat-stub.ts"
  - "apps/chat/src/lib/sse.ts"
  - "apps/chat/src/lib/use-conversations.ts"
  - "apps/chat/src/components/chat/sources-list.tsx"
tags:
  - "chat"
  - "seeker"
  - "sse"
  - "fetch-patch"
  - "browser-verification"
  - "chrome-devtools-mcp"
  - "fixtures"
---

# Synthetic-SSE fetch-patch browser verification for chat client changes

## Context

Verified this session (2026-07-20) during feat-269 (sources presentation).
Merge state at time of writing: the feat-269 changes are uncommitted on branch
`feat/chat-sources-presentation`; no PR has been opened. All line references
below are against that tree.

The situation: a client-side change to how Seeker sources render needed
real-browser verification with realistic multi-source replies — several
sources, duplicate URLs, long snippets — but the live Seeker path was down
locally. Sends failed instantly with the `config_missing` signature (the
reason bucket the `/api/seeker` proxy emits when its Mastra base URL/bearer
are absent) while the per-user seeker gate itself logged `granted`
(session-observed). That exact signature is documented in
`apps/chat/CLAUDE.md`'s Development section ("Unset, sends get the
`config_missing` failure notice…") — recognize it from there rather than
re-deriving it from the proxy.

The key structural fact that makes a workaround possible: the client's entire
Seeker reply path is driven by one `fetch("/api/seeker", …)` call inside
`streamSeekerReply` (`apps/chat/src/lib/chat-stub.ts:119-133`), and everything
downstream of that call — SSE parsing, token streaming, terminal finalize,
conversation state, component render — is genuine client code. Substituting
only that one network leg with a synthetic SSE `Response` exercises the whole
real client stack against controlled data.

## Guidance

Precondition (described generically): a signed-in, gate-granted session on the
local dev server, so the page's `seekerEnabled` prop is true and `streamReply`
routes to the Seeker path at all — flag-off routes to the stub and never
fetches (`apps/chat/src/lib/chat-stub.ts:218-222`). To establish that session
from scratch, follow the local dogfood recipe in `apps/chat/CLAUDE.md`'s
Development section (`SEEKER_CHAT_ENABLED`, chat auth against a local
`apps/auth`, a verified email listed in `SEEKER_ALLOWED_EMAILS`):

```ts
export function streamReply(
  input: StreamReplyInput,
): Promise<StreamReplyResult> {
  return input.seekerEnabled ? streamSeekerReply(input) : streamStubReply(input)
}
```

The technique, exactly as executed:

**1. Patch `window.fetch` in-page, after load.** In the headless-Chromium page
driven via the chrome-devtools MCP, evaluate a script AFTER page load — the
patch lives in the page's JS context, so a reload (hard navigation) wipes it
and it must be re-evaluated. Keep
`const originalFetch = window.fetch.bind(window)` and replace `window.fetch`
with a function that intercepts ONLY
`url === "/api/seeker" && init.method === "POST"` and delegates everything
else untouched (Next.js dev-client fetches, HMR, other API calls keep
working). The string compare is safe for this caller because the client passes
a string URL (`chat-stub.ts:125`).

**2. Return a synthetic SSE `Response`.** The intercepted call returns
`new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })`
where `stream` is a `ReadableStream` whose `start(controller)` enqueues
TextEncoder-encoded SSE frames: N `token_delta` frames (`{ text: chunk }`)
spaced ~15-25ms apart via `setTimeout` (session-measured spacing — simulates
streaming so the UI's streaming pulse renders), then one `result` frame
(`{ text, grounded, sources }`) and `controller.close()`. Bytes, not strings —
the parser does `decoder.decode(value, { stream: true })`
(`apps/chat/src/lib/sse.ts:28`).

Frame wire format per the chat-local SSE contract — `encodeSseFrame`
(`apps/chat/src/lib/sse.ts:61-63`) is the canonical encoding:

```ts
/** Encode one SSE frame (one `event:` + one JSON `data:` line + blank line). */
export function encodeSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
```

The parser splits frames on `\n\n` and reads `event:` / `data:` lines with a
`.trim()` after the prefix (`sse.ts:30-39`), so `event: name` and
`event:name` both parse; frames with no `data:` line or non-JSON data are
silently skipped (`sse.ts:40-46`).

Status matters: the client classifies before parsing — a 400 short-circuits to
`invalid_request` and any other non-ok / body-less response to `network_error`
(`chat-stub.ts:144-149`); a stream that ends without a terminal frame yields
`parse_error` — or `cancelled` when the caller's signal aborted
(`chat-stub.ts:209-213`). Those are also your debugging
signatures when the patch itself misbehaves.

**3. Fixture sources must mirror the REAL wire shape the client sanitizer
accepts.** `toSources` is the defensive projection
(`apps/chat/src/lib/chat-stub.ts:64-82`), quoted from the tree:

```ts
// Defensive projection of the (untrusted) wire sources into typed shape. The
// render layer additionally enforces the https-only link + text-only guards.
function toSources(value: unknown): SeekerSource[] {
  if (!Array.isArray(value)) return []
  const out: SeekerSource[] = []
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue
    const s = raw as Record<string, unknown>
    if (typeof s.sourceName !== "string" || typeof s.url !== "string") continue
    out.push({
      sourceName: s.sourceName,
      title: typeof s.title === "string" ? s.title : null,
      url: s.url,
      score: typeof s.score === "number" ? s.score : 0,
      snippet: typeof s.snippet === "string" ? s.snippet : "",
    })
  }
  return out
}
```

So each source object needs `sourceName` (string, required), `url` (string,
required), `title` (string|null), `score` (number, else defaults 0), `snippet`
(string, else defaults "") — matching `SeekerSource` in
`apps/chat/src/lib/conversations.ts:8-14`. The trap: `toSources` drops
malformed entries silently (`continue`), so a wrong-shaped fixture yields an
EMPTY sources array and the browser shows the explicit "No sources cited"
state — the test silently verifies the wrong thing unless you notice the
count. Copy the shape from the sanitizer's source, not from memory.

Two adjacent contract details worth knowing: the terminal `result.text` wins
over the accumulated token text when it is a string
(`chat-stub.ts:176`), so make `result.text` equal the concatenation of your
chunks unless you are deliberately exercising the override; and the first
terminal frame wins — later frames are ignored (`chat-stub.ts:157`).

**4. Drive the UI normally** (composer send). The reply flows through the
genuine client path: `streamSeekerReply`'s fetch → `readSseStream` parse
(`chat-stub.ts:154`, `sse.ts:17-58`) → first-terminal-wins finalize →
`useConversations` state → real component render in real Chromium. Only the
server leg (route handler, Mastra) is substituted.

## Why This Matters

This is the cheapest path to full-fidelity client verification when the
upstream is unavailable — and, independently, the ONLY practical way to feed
the UI adversarial-shaped data on demand. feat-269 used fixtures with
duplicate URLs, junk urls, non-https entries, and long snippets
(session-observed) — shapes the real corpus rarely produces when you want
them, but which the render layer's dedupe/link-guard/line-clamp behavior
exists to handle.

Being honest about the evidence class is the other half of the value:

- **What this evidence IS:** full verification of client-side
  rendering/interaction/scroll behavior with controlled data. Everything from
  the fetch return value onward is production code running in a real browser.
- **What it is NOT:** evidence for the proxy route, the seeker gate,
  SSRF/timeout handling, or wire-contract changes. In particular, changing the
  frame contract while testing against your own fixture is the classic
  producer-consumer self-confirmation trap: you author both halves, so
  agreement proves nothing about the real producer (see
  `docs/solutions/best-practices/producer-consumer-report-file-contract-pattern-20260506.md`
  and the mocked-shape META doc
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`).
  The fixture here proves the CLIENT contract only because its shape is copied
  from the real parser's and sanitizer's source
  (`sse.ts:30-47`, `chat-stub.ts:66-82`, `chat-stub.ts:158-198`), which the
  real proxy also feeds. If the change under test touches the frame contract
  itself, verify against the real producer instead.

## When to Apply

- Client-side chat UI changes (message rendering, sources presentation,
  streaming pulse, scroll behavior) that need real-browser proof with
  realistic Seeker replies.
- The local send path fails with `config_missing` (documented in
  `apps/chat/CLAUDE.md` Development) while the gate grants — i.e. the client
  takes the Seeker path but the upstream is unprovisioned.
- Edge-shape fixtures are needed (duplicates, malformed urls, extreme
  lengths) that the live corpus won't produce on demand.
- Do NOT use it as evidence for server-side changes (`/api/seeker` route,
  history proxies, gate logic) or for any change to the SSE frame contract —
  those need the real producer on the wire.
- Do NOT use it as evidence for changes to `sse.ts` parsing/buffering either:
  the skeleton enqueues one whole frame per chunk, so cross-read reassembly
  (buffer accumulation, streamed decode, partial-tail handling) is
  structurally unexercised — no frame ever splits across reads. Those changes
  need split-frame fixtures (frames cut mid-frame across enqueues) or the
  real producer.

## Examples

Concrete evaluate_script skeleton (trimmed but runnable in shape), executed in
the headless-Chromium page after load — re-run after any reload:

```js
;() => {
  // CLIENT-side evidence ONLY — this substitutes the server leg (/api/seeker
  // route, gate, Mastra); see When to Apply before citing it as verification.
  const originalFetch = window.fetch.bind(window)
  const enc = new TextEncoder()
  const frame = (event, data) =>
    enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  // Shape mirrors toSources (apps/chat/src/lib/chat-stub.ts:66-82):
  // sourceName + url are required strings; malformed entries drop silently.
  const sources = [
    {
      sourceName: "JESUS Film",
      title: "The Beatitudes",
      url: "https://example.org/a",
      score: 0.92,
      snippet: "Blessed are the poor in spirit…",
    },
    {
      sourceName: "JESUS Film",
      title: "Same URL again",
      url: "https://example.org/a",
      score: 0.88,
      snippet: "Exercises dedupe-by-URL.",
    },
    {
      sourceName: "Junk",
      title: null,
      url: "not-a-url",
      score: 0.5,
      snippet: "Exercises the render layer's https-only link guard.",
    },
  ]
  const chunks = ["Jesus taught ", "that the poor in spirit ", "are blessed."]

  window.fetch = (url, init) => {
    if (url !== "/api/seeker" || init?.method !== "POST") {
      return originalFetch(url, init)
    }
    const stream = new ReadableStream({
      start(controller) {
        let t = 0
        for (const text of chunks) {
          t += 20 // ~15-25ms apart so the streaming pulse renders
          // One WHOLE frame per enqueue — never exercises cross-read
          // reassembly in sse.ts (see When to Apply).
          setTimeout(
            () => controller.enqueue(frame("token_delta", { text })),
            t,
          )
        }
        setTimeout(() => {
          controller.enqueue(
            frame("result", { text: chunks.join(""), grounded: true, sources }),
          )
          controller.close()
        }, t + 20)
      },
    })
    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    )
  }
  return "patched"
}
```

Then send a message through the composer and assert on the rendered result
(screenshots / a11y snapshot). To exercise the failure paths, swap the
terminal frame for `frame("error", { reason: "unavailable" })` — reasons
outside `REPLY_FAILURE_REASONS` coerce to `generation_failed`
(`chat-stub.ts:58-62`), and `gate_denied` degrades to the stub unless the hook
withheld the fallback (`chat-stub.ts:183-198`).

## Related Issues

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home: this technique is a worked instance of "mocked fixtures
  prove branch shape, not producer contract".
- `docs/solutions/best-practices/producer-consumer-report-file-contract-pattern-20260506.md`
  — the self-confirmation trap this evidence class must not fall into.
- `apps/chat/CLAUDE.md` — Development section (the `config_missing` signature;
  the gate mechanics), "Mastra Connection (Seeker, feat-205)" (the real
  producer this fixture stands in for).
- feat-269 (sources presentation) — the verified-in-session origin; uncommitted
  on `feat/chat-sources-presentation` at time of writing, PR not yet opened.
- `docs/solutions/developer-experience/chat-mastra-gated-stack-local-smoke-recipes.md`
  — the live-stack alternative: real local Mastra + seeded memory. Prefer it
  when the backend IS available; this doc is the zero-backend fallback.
- `docs/solutions/best-practices/deterministic-mastra-sse-route-testing-stub-model-budget-seam-20260625.md`
  — the server-side sibling: deterministic SSE testing of the Mastra route
  itself (the leg this technique deliberately substitutes).
- `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md`
  — same-session sibling: the feat-269 UI traps this technique helped verify.
