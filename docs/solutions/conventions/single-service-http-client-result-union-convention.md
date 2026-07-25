---
title: "Single-service HTTP client convention in apps/mastra — typed no-throw result union, injectable fetch"
date: 2026-06-15
problem_type: convention
component: service_object
severity: medium
module: apps/mastra/src/services
applies_when:
  - Adding a new outbound HTTP client for a single upstream service in apps/mastra
  - Reviewing a service client for failure handling, timeout, redirect, or testability
  - Deciding whether to extract shared client helpers across services
tags:
  - http-client
  - typed-result-union
  - mastra
  - fetch
  - testability
  - copy-not-extract
  - leak-control
related_components:
  - apps/mastra/src/services/firecrawl-client.ts
  - apps/mastra/src/services/jesusfilm-rag-client.ts
  - apps/mastra/src/services/admin-search-eval-client.ts
related:
  - docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md
  - docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md
  - docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md
---

## Context

`apps/mastra` makes outbound HTTP calls to a few services. Two of them —
`firecrawl-client.ts` (external, retrying) and `jesusfilm-rag-client.ts`
(external, single-attempt, added in feat-199) — share a near-identical client
shape and byte-identical helpers, and that shared shape is the convention this
doc captures. A third, `admin-search-eval-client.ts`, is a **related but
deliberately divergent variant** for an internal same-trust admin service; it
shares the typed-union _idea_ but not the helper set (see "The admin variant"
below). Scope of this doc: bounded JSON request/response over `fetch`. Streaming,
binary, or SDK-mediated upstreams are out of scope and need their own pattern.

## Guidance

Write one self-contained client file per upstream service
(`<service>-client.ts`) that exposes a single async entry point taking a
**destructured options object** with an env-derived config default and an
injectable fetch (`{ input, config = getXConfig(), fetchImpl = fetch }`) and
returning a **typed discriminated result union** — never throwing on the request
path. The exact reason set and the `result` vs `results` payload key are
per-client; the union below is **illustrative, not a literal copy target**:

```ts
type ClientFailure = {
  ok: false
  // Per-client subset — NOT every client has every reason:
  //   firecrawl: + "invalid_response" (parsed body with success:false); no "timeout"
  //   jesusfilm-rag: + "timeout" (single-attempt); no "invalid_response"
  reason:
    | "config_missing"
    | "auth_failed"
    | "network_error"
    | "rate_limited"
    | "rejected"
    | "parse_error"
  retryable: boolean
  status?: number
  upstreamReason?: string
}
// Payload key is the client's choice: firecrawl returns { result }, rag { results }.
type ClientResult<T> = { ok: true; result: T } | ClientFailure
```

Shared load-bearing pieces (present in `firecrawl-client.ts` and
`jesusfilm-rag-client.ts`; the admin variant differs — see below):

- **`config_missing` short-circuit** before any fetch — unconfigured degrades,
  never throws. (Universal across all three clients.)
- **`failureForStatus(status)`** maps HTTP status to `reason` + `retryable`.
  In firecrawl/rag it is identical (401/403 -> `auth_failed`; 429 ->
  `rate_limited`; other 4xx -> `rejected`; 5xx -> `network_error`). Classify
  thrown fetch errors on the **typed surface** (`error.name === "TimeoutError"
| "AbortError"` -> `timeout`), never on the message string.
- **`endpoint(base, path)`** — trailing-slash-safe URL builder
  (`new URL(path, base.endsWith("/") ? base : base + "/")`).
- **`AbortSignal.timeout(ms)`** on the fetch, budget shorter than any upstream
  caller (see related outbound-timeout doc). (All three use this.)
- **Injectable `fetchImpl = fetch`** so tests drive a `vi.fn<typeof fetch>()`
  and assert the exact outgoing request. (Universal.)
- **Safe upstream-reason capping** (`safeReason`/`readUpstreamReason`) — cap
  provider-controlled text to a fixed length and keep it on the typed result.
- **Additive-tolerant response parse** — `.passthrough()` Zod that validates
  only the consumed fields, so a contract-legal new field is not a parse error.

### Per-service decisions that legitimately differ

Do not force-converge these — match the upstream's posture:

- **Retry vs single-attempt.** Firecrawl retries with backoff; rag is
  single-attempt; admin is mixed — its `postJson`/`requestJson` helpers are
  single-attempt, but `callAdminEvalSearch` and `callAdminCandidateList` retry
  up to 3 attempts with backoff. `retryable` stays on the union for type
  parity/logging even when no caller retries. Single-attempt clients add a
  `"timeout"` reason (classified from the abort); retry clients fold timeouts
  into `network_error`.
- **`redirect: "error"` is the safe default — omitting it needs justification.**
  rag sets it so a redirect can't re-send the bearer to an unvetted host (a
  rejected redirect surfaces as `network_error`, since its error name is neither
  `TimeoutError` nor `AbortError`). Firecrawl **omits** it and relies on the
  production boot-time host allowlist (`assertFirecrawlApiUrlAllowedForProduction`)
  to constrain the first hop — acceptable only because that guard exists. A new
  credentialed client should set `redirect: "error"` unless it documents an
  equivalent control.
- **`invalid_response`** (firecrawl) for a parsed-but-`success:false` body.

### The admin variant (`admin-search-eval-client.ts`)

It is **not** a third copy of the helper set — calling it one would mislead.
It shares the typed no-throw union, `config_missing`, its own `failureForStatus`,
and `AbortSignal.timeout`, but it deliberately differs because the upstream is an
internal, same-trust admin service whose URL/bearer are **caller-supplied** (not
an env-derived `getXConfig()` default):

- No `endpoint()` (builds `new URL(url)` inline), no `safeReason`/length cap, no
  `redirect: "error"`, no `"timeout"` reason.
- Field is `adminReason` (not `upstreamReason`); a named `readAdminReason`
  exists (reads `.error` only, **uncapped**), but `postJson`/`requestJson`
  duplicate its extraction logic inline rather than calling it.
- Treats only `401` (not `403`) as `auth_failed`.

Treat admin as the internal-service exception, not the template.

## Note: the shared helpers are currently duplicated, not extracted

This is a **descriptive observation, not a rule to enforce.** The
genuinely-shared helpers live in two files — `firecrawl-client.ts` and
`jesusfilm-rag-client.ts`: `safeReason` and `readUpstreamReason` are
byte-identical; `endpoint` is functionally identical (bodies match — only the
parameter name differs, `apiUrl` vs `baseUrl`); `failureForStatus` matches modulo
its return-type name. The admin variant does not have these helpers, so this is
duplication across _two_ consumers — and, importantly, the two are one lineage
(`jesusfilm-rag-client.ts` was copied from `firecrawl-client.ts`), not two
independent designs that happened to converge. The helpers are tiny, pure, and
frozen (no churn since firecrawl), so a second copy currently costs little.

> **Count correction (2026-07-22).** The "two consumers" figure above is stale,
> and the drift differs per helper — re-derive it from the code rather than
> re-reading this paragraph:
>
> | Helper               | Files on `main`                                                                                                                   |
> | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
> | `endpoint`           | **4** — `jesusfilm-rag-client.ts:107`, `firecrawl-client.ts:162`, `admin-agent-tools-client.ts:48`, `youtube-search-client.ts:74` |
> | `safeReason`         | 2 — firecrawl, jesusfilm-rag                                                                                                      |
> | `readUpstreamReason` | 2 — firecrawl, jesusfilm-rag                                                                                                      |
>
> So the "third consumer" trigger below has **already fired for `endpoint`** and
> went unobserved for at least two PRs, because each new client recited this
> paragraph instead of counting. A fifth `endpoint` copy is pending in PR #1621.
> See `docs/solutions/workflow-issues/deferred-verification-belongs-in-consuming-ticket-entry-conditions.md`.

We deliberately did **not** add "keep in sync" breadcrumb comments to the copies.
A prose comment with no test behind it is the weakest form of coupling and tends
to rot — it asserts an invariant it cannot enforce. If these helpers ever need to
stay identical _under change_, the honest fix is one of:

- **Extract** the pure, divergence-free helpers (`endpoint`, `safeReason`,
  `readUpstreamReason`) into a shared `apps/mastra/src/services/http-client-util.ts`
  — they know nothing about retry, redirect, or status, so sharing them couples
  nothing. This deletes the drift problem outright.
- **Bind** them with a parity test if they must stay separate for some reason —
  enforcement a comment can't provide.

`failureForStatus` and the request/retry loop stay per-file regardless — those
genuinely diverge (firecrawl's `invalid_response` + retry; admin's 401-only).

**When extraction is worth it:** the next time a change must touch all copies
(change-amplification is the real cost of duplication), or when a third consumer
needs the helper. Until then, two frozen copies of a six-line pure helper is an
accepted, low-cost state — just don't mistake it for a convention others must
replicate.

## Why This Matters

The typed no-throw union is not just ergonomics — it is a **leak control**. The
no-throw _shape_ is applied across all three clients; the _capping_ half of the
control (`safeReason`) is present in firecrawl/rag and is a known gap in admin
(see below). The seeker agent's containment posture forbids ever logging the
bearer, query, or raw response body; a client that threw an error embedding that
text would risk surfacing it in Mastra's telemetry traces. The union keeps failure detail on a typed value
that the tool layer maps to a safe, enum-only log line.

Two security points a future client author must carry forward:

- **`upstreamReason` is both a leakage risk and a log-injection vector.** It is
  provider-controlled text; the length cap bounds size but does **not** neutralize
  injection — it can still contain spaces or `=` and corrupt a `key=value`
  plain-string log line. Never interpolate it into a structured log, regardless
  of the cap. (The admin variant's `adminReason` is _uncapped_, so it carries the
  same injection risk with no size bound at all — strictly more dangerous if
  logged. If it is ever logged, cap it and treat it as untrusted first — tracked
  as a follow-up.)
- **The host allowlist is a production-only boot guard.** `assert*AllowedForProduction`
  runs inside `assertMastraRuntimeEnv()` only when `NODE_ENV === "production"`;
  in dev/CI a mis-set base URL is **not** rejected. So for rag, `redirect: "error"`
  is the _only_ SSRF mitigation active in non-production (firecrawl, which omits
  it, has none outside production) — another reason `redirect: "error"` is the
  safe default. The injectable `fetchImpl` is what makes every failure branch
  unit-testable without network, and `.passthrough()` stops a legal additive
  contract change from becoming a silent total outage.

## When to Apply

- Any new bounded-JSON outbound HTTP client in `apps/mastra` → start from
  `firecrawl-client.ts` (retry) or `jesusfilm-rag-client.ts` (single-attempt),
  not from scratch. Use the admin variant only for internal same-trust services
  with caller-supplied connection details.
- In review: flag a client that throws on the request path, swallows
  `config_missing`, classifies fetch errors by message string, isn't
  `fetchImpl`-injectable, omits `redirect: "error"` for a credentialed external
  host without a documented allowlist control, or logs an uncapped/raw upstream
  reason.

## Examples

feat-199's `jesusfilm-rag-client.ts` is the single-attempt reference:
`searchJesusfilmRag({ query, config = getJesusfilmRagConfig(), fetchImpl = fetch })`
short-circuits `config_missing` (with a `detail` naming which half of the
URL/key pair is absent), sends lowercase headers + `redirect: "error"` +
`AbortSignal.timeout`, parses the envelope with `.passthrough()` validating only
`score`/`text`/`citation.{sourceName, title, url}`, and returns
`{ ok: true, results } | { ok: false, reason, retryable, ... }`. Every union
branch has a test where only that branch can match (mocked-shape-vs-real-contract
discipline — see related doc).

## Related Issues

- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — the timeout-budget rule these clients follow.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — per-branch test discipline for the union.
- `docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md` — SSRF prior art. Mastra clients with always-on endpoints retain boot-time host allowlists; optional discovery clients instead validate HTTPS immediately before the request and reject redirects so their configuration cannot block service startup. Also the dismissible CodeQL `js/request-forgery` FP on env-derived fetch URLs.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — why config is `.optional()` with a runtime `config_missing` short-circuit.
- `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md` — the plain-string `event=` logging the tool layer uses for these failures.
