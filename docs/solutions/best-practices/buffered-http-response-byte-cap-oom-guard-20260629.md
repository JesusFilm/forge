---
title: "Byte-cap buffered HTTP response reads to guard against OOM in a shared Node process"
date: "2026-06-29"
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

2. **Count actual bytes; abort, don't just stop.** Don't trust `Content-Length` — it can be absent or spoofed. Sum `chunk.byteLength` as chunks arrive, and the instant `total > maxBytes` call `await reader.cancel()`. `cancel()` aborts the underlying socket so the upstream stops filling the heap; merely `break`ing out of the read loop would leave the socket draining.

3. **Map over-cap (and every failure) to `undefined`, riding the existing path.** `undefined` is the keystone. The success site already feeds `undefined` into `SearchResponseSchema.safeParse(...)` → `parse_error`; the error site already treats a non-object as "no reason" and falls through to status-based classification. Both bottom out at the agent's `unavailable` status. So over-cap needs **no new branch, no throw, no change to the result-union or tool-result shape.**

4. **Make the no-throw boundary structural, and never log the caught error.** The `catch` swallows silently and must NOT log — a `JSON.parse` `SyntaxError` can embed raw body fragments in its message, and logging it would leak the body (breaching `NO-THROW LEAK CONTROL`). Make the boundary robust to future edits: acquire the reader _inside_ the `try` (so a `getReader()` throw, e.g. a double-locked body, is swallowed), and guard `releaseLock()` in `finally` with its own `try/catch` (it throws if a read is still pending). Neither end can escape even if a later edit disturbs the current no-pending-read invariant.

5. **Size the default ceiling above a contract-derived legitimate payload.** Here a `topK=5` retrieval is five short passage chunks plus small citations; a very generous ~50 KB/passage upper bound is ~250 KB. The default is `2_097_152` (2 MiB) — ~8× headroom, still low-single-digit MB — so a valid retrieval is never wrongly rejected as `unavailable`.

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
