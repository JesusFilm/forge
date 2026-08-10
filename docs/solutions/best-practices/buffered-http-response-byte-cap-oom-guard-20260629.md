---
title: "Byte-cap buffered HTTP response reads to guard against OOM in a shared Node process"
date: "2026-06-29"
last_updated: "2026-08-10"
category: "best-practices"
problem_type: "best_practice"
module: "apps/mastra"
component: "service_object"
resolution_type: "code_fix"
severity: "high"
tags:
  - "http-client"
  - "oom-guard"
  - "readable-stream"
  - "byte-cap"
  - "no-throw-contract"
  - "mastra"
  - "rag"
  - "env-optional"
applies_when:
  - "A single-attempt HTTP client buffers a full upstream response body before parsing"
  - "The upstream is trusted but not guaranteed to return a bounded payload (misbehaving, not necessarily hostile)"
  - "The consuming process is shared and cannot absorb arbitrary heap growth (e.g. a Node process running every Mastra agent/workflow)"
  - "The client already has a graceful no-throw failure path (returns undefined / parse_error / unavailable) that an over-cap result can ride"
---

# Byte-cap buffered HTTP response reads to guard against OOM in a shared Node process

## Context

A single-attempt HTTP client buffers the _whole_ upstream response into the heap before any application-level slicing can run. The canonical shape is:

```ts
const body = await response.json().catch(() => undefined)
```

`response.json()` reads the entire body into memory and only then hands you a parsed object. Any client-side bound you apply afterward — `results.slice(0, topK)`, a per-field length cap, a Zod parse — runs _after_ the bytes are already resident. That is exactly backwards for OOM protection: the protection must happen _during_ the read, not after it.

This bit `apps/mastra/src/services/jesusfilm-rag-client.ts` (feat-202). The Mastra runtime is a **single shared Node process** running every agent and workflow. The RAG retrieval client made two such buffered reads — the success body and, on a non-2xx, the error body in `readUpstreamReason`. A misbehaving (not necessarily hostile) upstream returning a multi-GB body — or even a fast, large body that arrives inside the request timeout — could OOM that shared process and take down every co-tenant agent.

The key framing the team settled on: **this risk is independent of exposure level.** The RAG upstream is a trusted, host-allowlisted, bearer-authed first-party service, and the seeker is Studio-only behind a network boundary. None of that helps — a trusted upstream can still be _buggy_. A buffered read with no byte ceiling is a latent OOM regardless of who sits on the other end. So this is defense-in-depth, not incident response, and the same gap exists in any outbound buffering HTTP client (the sibling `firecrawl-client.ts` has the identical shape at two sites).

The other half of the lesson is _how the fix degrades_. The client already had a typed, no-throw failure union (`{ ok: false, reason, retryable, ... }`) and a documented `NO-THROW LEAK CONTROL` contract: nothing on the request path may throw — or log — an error whose message could embed the query, the bearer, or raw body fragments. The byte-cap had to slot into that contract without adding a throw, a new error branch, or a log statement.

## Guidance

When an outbound HTTP client buffers a response body it does not control the size of, replace the buffered read with a **streamed, byte-counted read that aborts past a ceiling** and degrades over-cap into the client's _existing_ graceful-failure path. Do not add a new error branch, and do not throw.

The concrete shape, as shipped in `readJsonBodyCapped(response, maxBytes)`:

```ts
async function readJsonBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const stream = response.body
  if (!stream) return undefined // null body (e.g. new Response(null)) → graceful
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader() // acquired INSIDE try — a getReader() throw is swallowed
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength // count ACTUAL bytes — never trust Content-Length
      if (total > maxBytes) {
        await reader.cancel() // ABORT the socket so it stops filling the heap
        return undefined // → rides the existing graceful path
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    return undefined // swallow SILENTLY — never log (SyntaxError embeds body fragments)
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // releaseLock() throws if a read is pending — cleanup must never escape
    }
  }
}
```

Then both ingress sites swap their old expression for the helper:

```ts
// BEFORE (both sites):
const body = await response.json().catch(() => undefined)

// AFTER — success body:
const body = await readJsonBodyCapped(response, config.maxResponseBytes)
const parsed = SearchResponseSchema.safeParse(body) // undefined → parse_error, unchanged

// AFTER — error body (readUpstreamReason):
const body = await readJsonBodyCapped(response, config.maxResponseBytes)
if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
```

The seven rules that make this correct:

1. **Apply at every buffering read, including the error path.** A multi-GB _error_ body OOMs identically to a success body. `readUpstreamReason` goes through the same helper.

   **Corollary — a library holding its own client to the same upstream is a buffering read you cannot see (2026-08-10).** "Every buffering read" is an audit of call sites you wrote; it does not surface a fetch performed inside a dependency. Admin's mobile JWT verifier capped its own JWKS read while `createRemoteJWKSet` (jose) fetched the **same URL** through its own client during `jwtVerify`, buffering with a bare `response.json()` bounded only by `AbortSignal.timeout` — time, not bytes.

   What makes this worse than half-covered is **which path is hot**. The derived-alg cache holds for 10 minutes, so in steady state the capped read is not consulted at all while jose's uncapped one keeps firing, and a caller minting tokens with random `kid`s re-triggers jose's read every 30s without ever touching the capped path. The guard covered the cold path and left the hot one open.

   Two questions settle it. **Who else fetches this?** — grep the URL builder, not the guard; here `jwksUrl()` had two callers and one was capped. **Which path is hot?** — compare the caches; a guard on the cold path is close to no guard. Prefer the library's own injection seam (jose's `customFetch`, an `agent`, an `httpClient` option) so both reads share one ceiling by construction. If there is no seam, that asymmetry is itself a finding — record it rather than leaving the guard reading as complete.

   Worked instance: `apps/admin/src/auth/mobile-user-token.ts` (PR #1876, open at time of writing). Three independent review lenses filed it separately; detection required reading the dependency's source, because nothing in admin's own code says the second fetch exists.

2. **Count actual bytes; abort, don't just stop.** Don't trust `Content-Length` — it can be absent or spoofed. Sum `chunk.byteLength` as chunks arrive, and the instant `total > maxBytes` call `await reader.cancel()`. `cancel()` aborts the underlying socket so the upstream stops filling the heap; merely `break`ing out of the read loop would leave the socket draining.

3. **Map over-cap (and every failure) to `undefined`, riding the existing path.** `undefined` is the keystone. The success site already feeds `undefined` into `SearchResponseSchema.safeParse(...)` → `parse_error`; the error site already treats a non-object as "no reason" and falls through to status-based classification. Both bottom out at the agent's `unavailable` status. So over-cap needs **no new branch, no throw, no change to the result-union or tool-result shape.**

4. **Make the no-throw boundary structural, and never log the caught error.** The `catch` swallows silently and must NOT log — a `JSON.parse` `SyntaxError` can embed raw body fragments in its message, and logging it would leak the body (breaching `NO-THROW LEAK CONTROL`). Make the boundary robust to future edits: acquire the reader _inside_ the `try` (so a `getReader()` throw, e.g. a double-locked body, is swallowed), and guard `releaseLock()` in `finally` with its own `try/catch` (it throws if a read is still pending). Neither end can escape even if a later edit disturbs the current no-pending-read invariant.

5. **Size the default ceiling above a contract-derived legitimate payload.** Here a `topK=5` retrieval is five short passage chunks plus small citations; a very generous ~50 KB/passage upper bound is ~250 KB. The default is `2_097_152` (2 MiB) — ~8× headroom for this byte-denominated contract — so a valid retrieval is never wrongly rejected as `unavailable`. (The right magnitude comes from the contract, not from a universal low-MB rule: the char-denominated contract in the corollary below legitimately derives 8 MiB.)

   **Sizing corollary — when the contract is denominated in characters (feat-241, 2026-07-14).** A JS text cap (`String.slice(0, N)`, `.length`) counts **UTF-16 code units**, and one unit inflates to up to **3 UTF-8 bytes** on the wire (CJK/Devanagari and most non-Latin BMP scripts; astral characters are 2 units → 4 bytes = 2 B/unit, never worse). "Contract-derived" must therefore run the explicit chain **`char cap × 3 B/unit × item count + envelope`** — the intuitive ~1 byte/char undersizes ~3× for exactly the non-Latin scripts, and because over-cap rides the graceful `unavailable` path (rule 3), the result is a _deterministic, retry-proof false outage_ for CJK/Devanagari users while Latin users see a working feature: a quiet i18n regression, not a crash. Worked instance: mastra's `AI_CHAT_HISTORY_TEXT_CAP_CHARS = 8_192` (`apps/mastra/src/mastra/ai-chat-history-route.ts:64`, unit stated at the declaration) feeds chat's `HISTORY_THREAD_MAX_RESPONSE_BYTES` (`apps/chat/src/app/api/history/history-proxy.ts:58`) — initially sized 4 MiB from 1 B/char thinking (a confident-looking derivation comment, wrong by exactly the unit factor), corrected in feat-241's pre-push Tier-2 review to 8 MiB via 8,192 × 3 B ≈ 24 kB/message × 200 messages ≈ 4.8 MB + JSON envelope.

   Three rules ride the corollary: **state every text cap's unit at its declaration and write the derivation chain into the byte cap's comment** (both halves, per the client-mirror-server-dedupe comment discipline, so the contract survives either side being refactored alone); **assume 1 B/char only for ASCII-by-construction content** (ids, enum literals — never user text in an i18n product); and **give the byte-capped read at least one near-cap fixture in a 3-byte script** (`"あ".repeat(CAP)`) — an ASCII `"x".repeat(CAP)` fixture sits at ⅓ of the worst-case payload and is structurally blind to undersizing. The unit boundary also applies beyond HTTP reads (char-capped text into byte-limited storage, log-line budgets, queue payload caps; cross-language pairs count differently — Python `len(str)` counts code points, Go `len(string)` counts bytes, Postgres `varchar(n)` counts characters). And don't "fix" undersizing by lowering the char cap: the char cap is the product contract, the byte cap is the guard sized around it — truncating non-Latin messages to ⅓ the effective length of English ones would itself be the i18n regression.

   **Measurement corollary — a budget must be MEASURED, not COMPUTED (feat-329, 2026-08-05).** The sizing corollary above tells you how to derive a budget; this one tells you how to _test_ it. A worst-case budget asserted as a **computation over the same named constants that define it** is tautological with respect to anything it forgot. It can only ever catch a bound somebody **raised**; it can never catch a **field nobody counted**. The assertion that closes that gap **serializes a maximal payload and measures its real byte length**.

   Worked instance: feat-329 added optional per-message `sources`/`video` to the same replay wire the sizing corollary sizes. Its first derivation counted only each source's `snippet` — while `sourceName`, `title`, `url`, and the video's `title` crossed the wire **uncapped**, because nothing upstream bounds them (the RAG tool truncates only a passage's `text`; admin truncates neither a video title nor a source label). The computed assertion was green throughout. Review found it (five independent reviewers, pre-merge) — itself the signal for how invisible this shape is to ordinary review. The consequence is not a degraded render: over-cap → the capped read returns `undefined` → the proxy answers 502 → replay lands in `failed` → the client's R22 rule then **blocks every send into that conversation**. The thread becomes permanently unreadable _and_ unusable — the graceful-failure path (rule 3) is graceful for one request, not for a thread you can never open again.

   The fix is both halves: bound every variable-length field the projection emits **and** replace the tautological assertion with a measuring one.

   ```ts
   // Tautological: recomputes the expression that defines the constant.
   expect(WORST_CASE).toBe(
     LIMIT * (TEXT_CAP * 3 + MAX_SOURCES * SNIPPET_CAP * 3 + VIDEO),
   )

   // Measuring: an uncounted field fails HERE instead of shipping.
   const bytes = Buffer.byteLength(JSON.stringify({ messages }), "utf8")
   expect(bytes).toBeLessThan(CONSUMER_CAP)
   ```

   Falsification that evidences it (`apps/mastra/src/mastra/ai-chat-history-replay-attachments.test.ts`): removing the cap on **one display string** (`sourceName`) makes the measuring test report **12,062,894 B against the 8,388,608 B cap**, while the computed-derivation test stays green. Count the **JSON envelope** too (key names, quotes, commas, braces — per message and per array item); the measured assertion is what makes forgetting it fail loudly.

   **Caveat that rides with it — a measuring assertion is only as strong as its fixture is maximal.** It goes red only when the uncounted field's contribution exceeds the slack between the measured payload and the budget. Measured on feat-329's own fixture: un-capping `sourceName` or a source `title` (5 per message) blows the cap at 12,062,894 B, but un-capping the **video** `title` (1 per message) lands at 7,416,494 B and stays **green** — that field is held by a direct per-field cap assertion instead. So drive every capped field from a maximal source, and pair the measurement with a per-field cap test; neither alone is complete.

   **Truncate what is read, drop what is followed.** When enforcing the per-field bounds, the failure modes are not symmetric. Truncating a _display_ string (a label, a title, a snippet) degrades gracefully — the reader sees a shortened label. Truncating a **URL** does not: the cut value still parses as `https:` and renders a live-looking link to a 404, which is the dead-caption-link failure the same arc had already refused elsewhere (`apps/mastra/src/mastra/seeker-video-gates.ts` carries the production census behind that decision). So bound URLs by **dropping the whole record**, not by slicing, and filter the drops _before_ any "first N items" slice so a droppable item never costs a good one its slot. feat-329 lands at 128 UTF-16 units for display strings and a 192-unit **drop** bound for URLs; the five real citation URLs observed in a live browser run maxed at 61 characters, so the bound is far from real traffic.

   **Honest residual, worth stating wherever this budget is documented:** 3 B/unit is the **UTF-8** worst case, not the **JSON** one. `JSON.stringify` expands control characters and lone surrogates to 6 B/unit (`\u00XX` escapes), so a pathological all-control-character transcript still exceeds a budget derived at 3 B/unit. That predates feat-329 (it is a property of the feat-241 text cap that dominates the sum) and is documented at the constant rather than fixed — but do not let a measured-and-green budget read as a proof it cannot be exceeded.

6. **Make the knob `.optional()` with a runtime fallback — never required-at-boot.** The cap is opt-in scaffolding; it must not brick a Railway deploy in an unprovisioned env. Per the repo's optional-env-var discipline (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`):

   ```ts
   // schema:
   JESUSFILM_RAG_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().max(16_777_216).optional(),
   // accessor:
   maxResponseBytes:
     env.JESUSFILM_RAG_MAX_RESPONSE_BYTES ?? DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES,
   ```

   This keeps the var out of the boot-time `missing` list in `assertMastraRuntimeEnv` while always handing the client a concrete `number`, so the config type stays non-optional.

   **And bound it with a sane `.max()` — a knob that governs a safety control must not be able to silently disable that control.** A bare `.optional()` (no ceiling) fails _open_: an over-range operator typo like `"99999999999"` sets a ~93 GB cap that quietly defeats the OOM guard while every test stays green and every boot succeeds — the worst kind of silent regression on a safety mechanism. A `.max()` makes it fail _loud_ instead: the value is rejected at env-load with a parse error naming the var, so the misconfig surfaces on the failed deploy rather than as a heap exhaustion weeks later. This is a general rule for any env knob that bounds a resource-safety limit (size caps, concurrency caps, retry ceilings), not just this one — pair the `.optional()`/fallback (so _unset_ still boots) with a `.max()` (so an _out-of-range set value_ fails fast). Size the ceiling generously above any legitimate override but below where the limit stops protecting: here `.max(16_777_216)` (16 MiB) is 8× the 2 MiB default — ample headroom for a real passage-size increase, while bounding the ~2× transient peak per in-flight read so even the widest sanctioned config stays survivable on the shared process. (Mirrors the sibling `JESUSFILM_RAG_TIMEOUT_MS.max(30_000)`.)

7. **Test the abort _mechanism_, not just the return value (mocked-shape-vs-real-contract).** A test that only asserts `reason === "parse_error"` would still pass if a regression deleted `reader.cancel()` and left a bare `return undefined` — silently reopening the OOM vector this work exists to close. The load-bearing test builds a real `ReadableStream` whose `cancel()` sets an observable flag and asserts the flag fired:

   ```ts
   it("aborts the stream on over-cap — proves reader.cancel() fires", async () => {
     let cancelled = false
     const oneKib = new Uint8Array(1024)
     const stream = new ReadableStream<Uint8Array>({
       pull(controller) {
         controller.enqueue(oneKib)
       }, // would emit unboundedly if fully drained
       cancel() {
         cancelled = true
       },
     })
     const fetchImpl = vi.fn<typeof fetch>(() =>
       Promise.resolve(
         new Response(stream, {
           status: 200,
           headers: { "content-type": "application/json" },
         }),
       ),
     )
     const result = await searchJesusfilmRag({
       query: "x",
       config: { ...testConfig, maxResponseBytes: 4_096 },
       fetchImpl,
     })
     expect(cancelled).toBe(true) // the mechanism, not just the outcome
     expect(result).toEqual({
       ok: false,
       reason: "parse_error",
       retryable: false,
       status: 200,
     })
   })
   ```

   Cover **both** read sites with this assertion independently (a second test pins the error path so it fails if the error read is ever split into a separate uncapped helper), plus the boundary (exactly-at-cap parses; one byte over → `parse_error`), null-body, and multi-chunk reassembly (the `merged.set(chunk, offset)` offset loop is never exercised by single-chunk fixtures).

## Why This Matters

- **The buffer-then-slice ordering is the trap.** Every post-parse bound — `.slice`, length caps, schema validation — runs after the bytes are already in the heap. For OOM protection the bound must be enforced _during_ the read. `cancel()` (abort the socket), not `break` (stop reading a still-draining socket), is the part that actually stops the heap from filling.
- **Trusted upstream is not a defense.** The risk is buggy-upstream, not hostile-upstream; a first-party, bearer-authed, host-allowlisted service can still emit a runaway body. Anyone reasoning "it's internal, so it's fine" will skip this cap and leave the OOM in place.
- **Degrading into an existing path beats adding a branch.** Because over-cap → `undefined` → the already-tested `parse_error → unavailable` path, the change has zero blast radius on the result-union contract, the tool-result shape, or callers. No new failure reason to document, propagate, or test end-to-end.
- **The leak-control coupling is non-obvious.** The obvious instinct on a swallowed error is to log it "for observability." Here that logs raw body fragments embedded in a `JSON.parse` SyntaxError — a real leak. The silent-swallow is a deliberate security control, and the structural reader acquire/release (inside `try` / guarded `finally`) keeps the no-throw boundary intact under future edits rather than relying on today's timing.
- **The abort test is the regression's only tripwire.** A result-shape-only test passes whether or not `cancel()` exists. The flag-asserting test is the single thing that fails when someone "simplifies" the loop and removes the abort — exactly the kind of silent-reopen the mocked-shape-vs-real-contract discipline exists to catch.

## When to Apply

Apply to **any outbound HTTP client that buffers a response body whose size it does not control** — `response.json()`, `response.text()`, `response.arrayBuffer()`, or an SDK that buffers internally — especially when:

- The client runs in a **shared/long-lived process** (a multi-tenant agent runtime, a server with many concurrent requests) where one OOM takes down co-tenants.
- The upstream is a separate service (even a trusted first-party one) whose body size you cannot guarantee.
- The client already has a **typed graceful-failure path** an over-cap read can degrade into — the cheapest possible integration.
- A **library in the same process talks to that same upstream** — an SDK you hand a base URL, a JWKS/OIDC client, a telemetry exporter. Check its injection seam before treating your own cap as complete.

The immediate sibling is `apps/mastra/src/services/firecrawl-client.ts`, which has the identical uncapped read at two sites; feat-202 consciously left it to its owners, but it is the same fix.

**Don't bother** when the body size is bounded by contract and small (a fixed-shape health check, a status enum), when you genuinely need the whole body and there is no sane ceiling (then fix it with backpressure/streaming downstream instead), or in a short-lived single-shot process where an OOM only kills the one job that caused it. And keep the helper **local** unless you have a real second consumer — extracting a shared HTTP utility was explicitly out of scope here to avoid touching unrelated clients.

## Examples

**Before — both ingress sites buffer the whole body:**

```ts
// success body
const body = await response.json().catch(() => undefined)
const parsed = SearchResponseSchema.safeParse(body)

// error body (readUpstreamReason)
const body = await response.json().catch(() => undefined)
if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
```

**After — both go through the streamed byte-capped helper** (full helper in the Guidance section). The downstream handling at each site is unchanged — only the read expression swaps, and `undefined` rides the existing `parse_error` / "no reason" paths to `unavailable`.

**Env knob — `.optional()` + runtime fallback, never in the boot `missing` list:**

```ts
// apps/mastra/src/config/env.ts
const DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES = 2_097_152  // 2 MiB, ~8× a generous topK=5 payload

JESUSFILM_RAG_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().max(16_777_216).optional(),

export function getJesusfilmRagConfig(): JesusfilmRagConfig {
  return {
    // ...
    maxResponseBytes:
      env.JESUSFILM_RAG_MAX_RESPONSE_BYTES ?? DEFAULT_JESUSFILM_RAG_MAX_RESPONSE_BYTES,
  }
}
```

**Error-path byte-bound — proves the error read is capped too, with no `upstreamReason` leak:**

```ts
it("byte-bounds the error path too: over-cap error body yields no upstreamReason", async () => {
  const big = JSON.stringify({ error: "x".repeat(5_000) })
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(big, {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  const result = await searchJesusfilmRag({
    query: "x",
    config: { ...testConfig, maxResponseBytes: 64 },
    fetchImpl,
  })
  expect(result).toEqual({
    ok: false,
    reason: "rejected",
    retryable: false,
    status: 400,
  })
  if (!result.ok) expect(result.upstreamReason).toBeUndefined() // capped read → undefined → no reason
})
```

**Boundary — exactly-at-cap parses, one byte over fails:**

```ts
const body = JSON.stringify({ results: [] })
const byteLength = new TextEncoder().encode(body).byteLength
// maxResponseBytes: byteLength      → { ok: true, results: [] }
// maxResponseBytes: byteLength - 1  → { ok: false, reason: "parse_error", status: 200 }
```

The full set of tests in `jesusfilm-rag-client.test.ts` covers: success-body over-cap (real over-cap, not a mocked branch), the abort-flag assertion on both the success and error paths, error-path over-cap with no `upstreamReason`, under-cap transparency (the existing happy-path fixtures double as regression guards), null-body, the boundary, and multi-chunk reassembly through the offset loop.

## Related learnings

- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — the **time-axis** sibling. Same threat class (upstream misbehavior exhausts a shared process) on the orthogonal axis: that doc bounds _how long_ an outbound call may take (`Promise.race` / `AbortSignal.timeout`); this one bounds _how many bytes_ its response may buffer. Reach for both together on any outbound call in a shared runtime.
- `docs/solutions/best-practices/settle-orphaned-companion-promise-streaming-early-exit-20260625.md` — sibling in the "streaming-handler resource cleanup" family: both `getReader()` + early-exit + a structural no-throw boundary, guarding different hazards (orphaned rejected promise vs OOM/lock-leak).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META home for the rule behind rule 7 (test the abort mechanism, not the return shape). The same work also verified the seeker agent's `defaultOptions.maxSteps` floor against the **vendored `@mastra/core` compiled dist** (not the `.d.ts`), a worked instance recorded there.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — the optional-env-var discipline behind rule 6.
- `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md` (rule 2) — the other application family of the same encoding seam behind rule 5's sizing corollary: "UTF-8 byte length ≠ UTF-16 code-unit length" guards `timingSafeEqual`'s equal-length precondition there; here it sizes byte caps derived from char-denominated contracts. Same root fact, two failure directions.
- `docs/solutions/best-practices/client-mirror-server-dedupe-per-id-contract-20260506.md` — the both-halves-comment discipline the sizing corollary applies to the unit-conversion chain (producer's char cap and consumer's byte cap each document the contract).
