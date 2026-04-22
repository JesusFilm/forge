---
title: "Next.js Server Action + LLM structured output with defense-in-depth validation"
category: best-practices
date: 2026-04-21
problem_type: best_practice
component: service_object
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: medium
module: apps/web
tags:
  - nextjs
  - server-action
  - openrouter
  - llm
  - json-schema
  - zod
  - structured-output
  - use-sync-external-store
  - pubsub-bus
  - client-components
  - retry-policy
  - rate-limiting
  - apollo
  - http-timeout
  - demo-search
related_prs:
  - 809
related_issues:
  - 812
---

# Next.js Server Action + LLM structured output with defense-in-depth validation

## Problem

The codebase had no canonical pattern for a **public, untrusted-output LLM call inside a Next.js 16 Server Action** — one that safely turns a user query plus server data into a typed, validated, render-ready React tree. Prior LLM wiring (`apps/cms/src/lib/openrouter.ts`) was built for server-to-server embedding / indexing jobs using the OpenAI SDK; it did not address public cost-DoS, schema enforcement, slug-allowlist safety, or client-side orchestration of a pending state across disconnected buttons. PR #809 introduced all of those concerns in one surface (`/demo-search`), and the ce:review + fix commit `740ce41` hardened the pattern. This doc codifies it so the next "LLM produces a UI fragment" feature can copy the shape rather than re-derive it.

## Symptoms this pattern addresses

- **Cost-DoS on a public Server Action** — anonymous users can spam the button and burn OpenRouter spend in minutes.
- **Silent schema drift** between the runtime Zod validator and the upstream provider's JSON-schema contract.
- **Slug / reference hallucination** — strict JSON schema cannot express "must be a member of this runtime-provided set."
- **Infinite render loop** when a `useSyncExternalStore` `getSnapshot` returns a fresh object each call.
- **Stuck "Composing…" state** when the component unmounts mid-transition (route change, parent re-key) and never flips the shared pending flag off.
- **Stale `isPending` closure** when two event sources race to trigger generation within the same render tick.
- **PII / internal-error leakage** from raw `Error.message` surfaced to the client.
- **Transport errors never retried** when retry logic only branches on HTTP 5xx and ignores `AbortSignal.timeout`, DNS, `ECONNRESET`.

## What didn't work

Intermediate approaches during PR #809 + ce:review hardening that failed and were replaced:

- **Fresh `getStats()` objects on every read** — initial metrics store returned a fresh `{ count, p50Ms, p95Ms, totalEmbeddingCostUsd }` literal each call. `useSyncExternalStore` compares snapshots with `Object.is`, so every render saw a "new" snapshot → infinite re-render loop → page crashed into the error boundary with "Maximum update depth exceeded."
- **Zod `min(1)` vs JSON schema `minItems: 3`** on `theme-carousel.videoSlugs`. Schema-strict models complied with the upstream `minItems: 3`; Zod's lower bound permitted degraded outputs that diverged from the contract. Intermittent `SCHEMA_MISMATCH` under load.
- **Retry only on HTTP 5xx** — an OpenRouter connection reset or `AbortSignal.timeout` surfaced as a thrown fetch error, skipped the retry branch entirely, and bubbled a raw `TypeError: fetch failed` to the action's catch-all.
- **`useEffect(() => setGeneratePending(isPending), [isPending])` without cleanup** — if the client component unmounted while a transition was in-flight (route change, parent re-key), the bus stayed `pending: true` forever and every subscriber (the shortcut button on the hero) showed a permanent spinner.
- **Raw error messages in `USER_MESSAGES`** — initial copy leaked internal detail publicly (`"Ask Nisal to wire OPENROUTER_API_KEY on the web service"`), exposing both a team member's name and the exact env var name to unauthenticated visitors. Closed record keyed off typed codes is the fix.
- **Enter-to-submit without flushing the debounce** — typing a new query and pressing Enter before the 300 ms `router.replace` fired caused the generator to run against the previous SSR's query + results. The debounce must be cancelled and the navigation forced synchronously before the submit.

## Solution

### 1. Generator primitive: typed errors + discriminated-union return + raw fetch

Raw `fetch` over the OpenAI SDK for one call site — no streaming, no embeddings, no function calling means the SDK is pure bundle weight. Comment rationale in the file explicitly:

```ts
// The CMS side uses the openai SDK (apps/cms/src/lib/openrouter.ts); this
// side uses raw fetch. Single call site + zero need for streaming / embeddings
// means pulling in the SDK buys nothing but bundle weight.
```

Errors are a closed union, not strings:

```ts
export type ExperienceGeneratorErrorCode =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "SCHEMA_MISMATCH"
  | "NO_VALID_SECTIONS"

export class ExperienceGeneratorError extends Error {
  code: ExperienceGeneratorErrorCode
  constructor(code: ExperienceGeneratorErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = "ExperienceGeneratorError"
  }
}
```

Call sites match on `instanceof ExperienceGeneratorError` + switch on `code`; the Server Action maps that code to a public string (see §4).

### 2. Dual schema (Zod + JSON) with explicit alignment

OpenRouter gets a `response_format: { type: "json_schema", json_schema }` so the provider _enforces_ structure. Zod then re-validates on receipt because provider enforcement is best-effort and occasionally degrades under load. **Both schemas must agree at every boundary**, including array bounds:

```ts
const ThemeCarouselSection = z.object({
  type: z.literal("theme-carousel"),
  theme: z.string(),
  // Mirrors the OpenRouter JSON schema (minItems: 3, maxItems: 5) so the
  // Zod boundary and the wire contract stay in lockstep. The slug-safety
  // filter below may still drop individual slugs — we allow the carousel
  // to survive with as few as 1 kept slug since the UI renders gracefully.
  videoSlugs: z.array(z.string()).min(3).max(5),
  caption: z.string(),
})

export const ExperienceSchema = z.object({
  title: z.string().min(1),
  intro: z.string().min(1),
  // Must match OpenRouter JSON schema's minItems: 2, maxItems: 3.
  sections: z.array(ExperienceSection).min(2).max(3),
})
```

Retry/timeout/jitter live in one helper, unifying three distinct failure classes:

```ts
async function fetchWithRetry(
  apiKey: string,
  body: unknown,
): Promise<Response> {
  let firstAttemptError: unknown
  let firstResponse: Response | undefined
  try {
    firstResponse = await postToOpenRouter(apiKey, body)
    if (firstResponse.status < 500 && firstResponse.status !== 429) {
      return firstResponse
    }
  } catch (err) {
    firstAttemptError = err
  }
  const backoff =
    firstResponse?.status === 429
      ? (parseRetryAfter(firstResponse.headers.get("retry-after")) ??
        jitteredBackoffMs())
      : jitteredBackoffMs()
  await new Promise((resolve) => setTimeout(resolve, backoff))
  try {
    return await postToOpenRouter(apiKey, body)
  } catch (err) {
    throw new ExperienceGeneratorError(
      "UPSTREAM_ERROR",
      err instanceof Error
        ? err.message
        : firstAttemptError instanceof Error
          ? firstAttemptError.message
          : "Network error",
    )
  }
}
```

Timeouts are **per-request** (`AbortSignal.timeout(15_000)`), not across the whole retry — so a slow first attempt doesn't eat the second attempt's budget.

### 3. Slug-safety post-filter — the layer JSON schema cannot express

The system prompt tells the model "every `videoSlug` MUST come from the provided candidate list," but prompt discipline is not a safety boundary. After Zod passes, every slug is re-checked against the runtime-provided allowlist, and sections that reference invented slugs are dropped:

```ts
function filterToAllowedSlugs(
  experience: Experience,
  allowed: Set<string>,
): Experience | null {
  const kept: ExperienceSectionNode[] = []
  for (const section of experience.sections) {
    if (section.type === "spotlight") {
      if (allowed.has(section.videoSlug)) kept.push(section)
      continue
    }
    if (section.type === "theme-carousel") {
      const filtered = section.videoSlugs.filter((slug) => allowed.has(slug))
      if (filtered.length >= 1) {
        kept.push({ ...section, videoSlugs: filtered.slice(0, 5) })
      }
      continue
    }
    kept.push(section) // bible-verse — no slugs to filter
  }
  if (kept.length === 0) return null
  return { ...experience, sections: kept }
}
```

Two subtle calls: (a) if _all_ sections get dropped the generator throws `NO_VALID_SECTIONS` instead of returning a hollow experience; (b) a carousel survives with as few as 1 kept slug because the renderer handles degraded cards gracefully — prefer a short carousel over a dropped section.

### 4. Server Action boundary: typed codes → sanitized public strings

```ts
const USER_MESSAGES: Record<ExperienceGeneratorErrorCode, string> = {
  NOT_CONFIGURED: "AI generation is temporarily unavailable.",
  UPSTREAM_ERROR:
    "The AI generation service is unavailable right now. Give it a moment and try again.",
  SCHEMA_MISMATCH:
    "Couldn't parse the generated response. Try again — the model usually recovers on a second pass.",
  NO_VALID_SECTIONS:
    "The model couldn't find enough in-catalog videos for this query. Try a broader query or different phrasing.",
}

export async function generateExperienceAction(input: {
  query: string
  results: CompactResult[]
}): Promise<GenerateExperienceResult> {
  try {
    const { experience, latencyMs } = await generateExperience(
      input.query,
      input.results,
    )
    return { ok: true, experience, latencyMs }
  } catch (err) {
    if (err instanceof ExperienceGeneratorError) {
      return { ok: false, code: err.code, message: USER_MESSAGES[err.code] }
    }
    // Unknown error — log server-side so it's grep-able in Railway instead
    // of collapsing invisibly to a generic user message.
    console.error("[generateExperienceAction] unexpected error", err)
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      message: USER_MESSAGES.UPSTREAM_ERROR,
    }
  }
}
```

The discriminated-union return (`{ ok: true, ... } | { ok: false, code, message }`) means the client exhaustively handles both paths without ever touching a raw `Error`. Unknown errors are logged server-side so they're grep-able in Railway logs rather than collapsing invisibly.

### 5. Client orchestration: useTransition + module bus + sync guard + unmount cleanup

Two buttons trigger the same Server Action (hero shortcut + section button), plus Enter-key on the search input. They need **one** pending signal, enforced synchronously, cleaned up on unmount:

```tsx
function run() {
  // Synchronous guard via the shared bus — isPending is closure-captured
  // and can be stale between two rapid requestGenerate() calls (shortcut
  // button + Enter key). getGeneratePending() reads the latest value.
  if (getGeneratePending()) return
  setGeneratePending(true)
  const compact = results.slice(0, MAX_RESULTS_FOR_PROMPT).map((r) => ({
    slug: r.slug,
    title: r.title ?? r.slug,
    snippet: r.snippet ?? "",
  }))
  startTransition(async () => {
    const outcome = await generateExperienceAction({ query, results: compact })
    if (outcome.ok)
      setState({
        status: "success",
        experience: outcome.experience,
        latencyMs: outcome.latencyMs,
      })
    else
      setState({
        status: "error",
        code: outcome.code,
        message: outcome.message,
      })
  })
}
useEffect(() => {
  runRef.current = run
})
useEffect(() => subscribeToGenerateRequests(() => runRef.current()), [])

useEffect(() => {
  setGeneratePending(isPending)
  // Guarantee the shared bus never stays stuck at "Composing…" if this
  // component unmounts while a transition is in flight (route change,
  // parent re-key, etc.).
  return () => {
    setGeneratePending(false)
  }
}, [isPending])
```

Three things to notice:

1. **`runRef` pattern** — the subscription is set up once on mount, but `run` captures fresh `query` / `results` every render. The ref lets the one-shot subscriber always call the latest closure.
2. **Synchronous guard beats `isPending`** — two trigger sources firing in the same tick both see `isPending === false` (React hasn't flushed), both fire. The module-level `getGeneratePending()` sees the mutation immediately because it's a plain boolean, not React state.
3. **Auto-scroll on success** uses a 50 ms `setTimeout` so layout (images / fonts) settles before `scrollIntoView`; the timer is cleared on cleanup to avoid scrolling after unmount.

The parent page passes `key={query}` to force a full remount per new query — stale state reset without bespoke effects.

### 6. Module-mutable store with cached snapshot for useSyncExternalStore

```ts
// Cached snapshot so getStats() returns a stable reference across reads when
// nothing has changed. This matters for React's useSyncExternalStore, which
// does Object.is on the snapshot — returning a fresh object every render
// triggers an infinite re-render loop.
let cachedStats: DemoSearchStats | null = null
function invalidateCache() {
  cachedStats = null
}

export function recordQuery(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return
  hydrate()
  samples.push(durationMs)
  invalidateCache()
  persist()
  listeners.forEach((listener) => listener())
}

export function getStats(): DemoSearchStats {
  hydrate()
  if (cachedStats !== null) return cachedStats
  if (samples.length === 0) {
    cachedStats = {
      count: 0,
      p50Ms: null,
      p95Ms: null,
      totalEmbeddingCostUsd: 0,
    }
    return cachedStats
  }
  const sorted = [...samples].sort((a, b) => a - b)
  cachedStats = {
    count: samples.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    totalEmbeddingCostUsd: samples.length * EMBEDDING_COST_USD_PER_QUERY,
  }
  return cachedStats
}
```

The bus at `demo-generate-bus.ts` is the smaller sibling — two `Set<() => void>` and a boolean, with `setGeneratePending` short-circuiting identity updates (`if (pending === next) return`) so subscribers only wake for real transitions.

## Why this works

- **Cached snapshot + explicit invalidation** is the canonical `useSyncExternalStore` contract. The hook is designed for mutable external state, but it assumes `getSnapshot` is pure-by-equality when the state hasn't changed. Compute once, memoize, invalidate on write. Anything else is an unbounded render loop.
- **Strict JSON schema alone is not enough.** Even `strict: true` provider schemas don't express "membership in a runtime set," can't enforce scripture canonicity, and occasionally degrade under load. Zod at the boundary catches _this_ response; the slug filter enforces _our_ runtime invariant; dual validation survives drift in either direction.
- **Server Actions are API-surface-level concerns**, not just RPC convenience. Anyone with DevTools can POST arbitrary payloads at them, and every uncaught error message is public. A Server Action that wraps an LLM call needs the same discipline as a REST endpoint: typed errors, sanitized messages, rate control, server-side logging of unknowns.
- **Synchronous guards beat effect-driven ones** when two event sources race inside a single render tick. `useTransition`'s `isPending` is closure-captured state that only flips after React flushes — fine for single-source triggers, catastrophic for shared triggers. A module-level boolean sees mutations immediately.
- **Per-attempt timeouts, not per-operation**, keep the retry budget honest. One slow attempt hitting a 15 s timeout followed by a 15 s retry is a 30 s user-facing wait — that's worth it for a resilient generation; but a single 30 s wall would make the user think the app is frozen.

## Prevention

Concrete rules for anyone reaching for this pattern again:

1. **Whenever you expose a `useSyncExternalStore` store, cache the snapshot.** Add a `let cached: T | null = null` + `invalidateCache()` on every write. If snapshots depend on derived computation (sort, percentile), compute them inside the cache guard — not in `getSnapshot`.
2. **Never ship a typed wrapper with two unaligned schemas.** If the upstream provider accepts a JSON schema, keep it and your Zod schema in one file; comment cross-references at every bound (`minItems`, `maxItems`, `required`). When the schema grows past ~2 section types, reach for `zod-to-json-schema` to derive one from the other — manual alignment is a time bomb.
3. **LLM Server Actions must have a closed `USER_MESSAGES` record.** Every typed error code gets a hand-written string. Unknown errors log server-side and collapse to the most conservative code. Never interpolate `err.message` into anything the client renders.
4. **LLM responses that reference runtime IDs need a post-validation allowlist filter**, even with strict JSON schemas. Prompt discipline is advisory; filters are enforcement.
5. **Retry on all three classes (5xx / 429 / transport) in one helper.** Transport errors throw; HTTP errors resolve with a status. A helper that only branches on status will silently skip retries for the former. Honor `Retry-After` on 429 (cap at ≤30 s).
6. **Any effect that writes to a shared bus returns a cleanup that resets it.** `useEffect(() => { setShared(x); return () => setShared(initial) }, [x])` — or you _will_ leave the UI stuck on a route transition.
7. **Rate-limit public Server Actions that call paid APIs.** A Server Action is an unauthenticated API surface. Without a WAF rate-limit or per-IP token bucket, a single bad actor can burn the upstream budget. For `/demo-search` this is tracked as a follow-up in #812.
8. **Shared `OPENROUTER_API_KEY` rotation** _(auto memory [claude])_: `@forge/web` now joins `@forge/cms` and `@forge/manager` as consumers of the same key. Any rotation must update all three Railway services in the same deploy window, or one service silently degrades.
9. **Know when NOT to use this pattern.** Simple CRUD actions with no untrusted output (no user-visible strings from an LLM, no third-party-hallucinated identifiers) don't need dual validation, allowlist filters, or discriminated-union returns — the overhead is ~150 lines of boilerplate per action. Reach for this pattern when: (a) an LLM call is exposed to anonymous traffic, (b) the response references runtime-only identifiers, or (c) the response renders directly as UI. A background job or server-to-server call can use the simpler `apps/cms/src/lib/openrouter.ts` SDK wrapper.

## Source files

- `apps/web/src/lib/experience-generator.ts` — core generator (Zod + JSON schema + retry/timeout/jitter + slug-safety filter + typed errors)
- `apps/web/src/app/demo-search/actions.ts` — Server Action boundary with sanitized `USER_MESSAGES`
- `apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx` — client orchestration (useTransition + bus + auto-scroll + unmount cleanup)
- `apps/web/src/components/demo-search/GenerateShortcutButton.tsx` — bus subscriber via `useSyncExternalStore`
- `apps/web/src/components/demo-search/GeneratedSections.tsx` — discriminated-union section renderers
- `apps/web/src/lib/demo-generate-bus.ts` — module-level pub/sub for trigger + pending
- `apps/web/src/lib/demo-search-metrics.ts` — cached-snapshot store for `useSyncExternalStore`

Related prior art: `apps/cms/src/lib/openrouter.ts` (server-to-server SDK variant — explicitly different shape for different constraints).

## Related learnings

- [Hybrid Semantic Search API (producer side)](./hybrid-semantic-search-api-strapi-v5-pgvector.md)
- [Silent OpenRouter key degradation](../runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md)
- [Zod errors must not echo user input](../security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md)
- [Typed-error discriminated unions + allSettled](./parallel-workflow-error-robustness-20260420.md)
- [Strapi v5 GraphQLError extensions + retryAfterSeconds contract](../integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md)

## References

- PR #809 — `feat/demo-search-showcase`
- Fix commit `740ce41` — ce:review hardening pass
- Issue #812 — follow-up tracking (rate-limiting, env validation, shared-prop audit, agent-callable surface, JSDOM testing harness)
