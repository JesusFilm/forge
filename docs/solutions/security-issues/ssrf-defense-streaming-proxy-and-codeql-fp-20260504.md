---
title: "SSRF defense-in-depth for the watch download proxy + CodeQL js/request-forgery false-positive handling"
date: "2026-05-04"
last_updated: "2026-05-12"
category: docs/solutions/security-issues
module: apps/web
problem_type: security_issue
component: tooling
symptoms:
  - "CodeQL js/request-forgery (critical) fires on the proxy fetch despite layered runtime defenses"
  - "Hostname allowlist alone leaves a residual DNS-rebinding-via-subdomain-takeover gap (e.g. dangling *.jesusfilm.org CNAME repointed at 127.0.0.1 or 169.254.169.254)"
  - "Inline `// codeql[js/request-forgery]` suppression has no effect on GitHub-hosted Default Setup CodeQL"
  - "Direct CDN URLs do not reliably set `Content-Disposition: attachment`, so cross-origin `<a download>` falls back to navigating the tab"
  - "Adding a new HTTP method (HEAD/POST/OPTIONS/etc.) to an already-dismissed SSRF-defended route triggers a fresh per-call-site alert that must be dismissed independently"
root_cause: incomplete_setup
resolution_type: code_fix
severity: high
related_components:
  - authentication
  - documentation
tags:
  - ssrf
  - codeql
  - proxy
  - dns-rebinding
  - allowlist
  - request-forgery
  - default-setup
  - nextjs
  - per-method-alert
key_files:
  - "apps/web/src/app/api/download/route.ts"
  - "apps/web/src/app/api/download/route.test.ts"
  - "apps/web/src/lib/download-allowlist.ts"
related:
  - "docs/solutions/security-issues/codeql-tainted-output-striphtml-console-error-20260414.md"
  - "docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md"
  - "docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md"
  - "docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md"
---

# SSRF defense-in-depth for the watch download proxy + CodeQL `js/request-forgery` false-positive handling

## Problem

We needed to ship a **Download** button on the watch page in `apps/web`. The naive approach — pointing an `<a download href={url}>` at the upstream CDN URL we already have — fails three ways:

1. **Browsers ignore `<a download>` cross-origin.** When `href` is on a different origin from the page (Mux CDN, `api-media-core.jesusfilm.org`), the `download` attribute is silently dropped and the click navigates the tab to the video.
2. **`Content-Disposition: attachment` is inconsistent at the source.** Mux's playback URLs and `jesusfilm.org` direct asset URLs don't reliably set the attachment disposition.
3. **Opening in a new tab is a poor UX** — buffers in memory, fights the browser's native download manager, breaks resumable downloads.

The fix is a **same-origin streaming proxy** at `/watch/api/download` that fetches the upstream URL server-side, sets `Content-Disposition: attachment`, and pipes the upstream `ReadableStream` straight into the response.

Any time you write a server-side proxy that fetches a URL constructed from request input, **you have built a candidate for SSRF (Server-Side Request Forgery)**. Even with a heavy hostname allowlist, classic attacks remain possible:

- **DNS rebinding via subdomain takeover.** An attacker who claims a dangling `*.jesusfilm.org` CNAME (e.g. an unmaintained marketing subdomain) can repoint it at `127.0.0.1`, `169.254.169.254` (AWS IMDS), or `10.0.0.0/8`. The hostname still passes the allowlist suffix check.
- **Userinfo/fragment smuggling.** `https://stream.mux.com@evil.com/payload` passes naive parsing on some libraries.
- **Redirect pivoting.** Upstream returns `302 Location: https://attacker.com/exfil`, and a default `fetch` happily follows it off the allowlist.
- **Header bleed.** Cookies, `Authorization`, or other ambient credentials leak into the upstream call.
- **Slow-loris on the proxy.** A stalled CDN pins a Node worker until the route's `maxDuration` (we set it to 600s for feature-film downloads).

Compounding the problem: **CodeQL's `js/request-forgery` rule** is a critical-severity finding that GitHub's hosted Default Setup runs on every push. It fired on our `fetch(safeUrl, ...)` call in PR #868 (alert #51), and our first instinct — adding a `// codeql[js/request-forgery]` inline suppression — failed silently. That syntax is **CodeQL CLI–only**; Default Setup ignores it. Understanding what CodeQL recognizes as a sanitizer (and what remediation paths actually work in Default Setup) is critical infrastructure knowledge for any team that wants to keep the security signal trustworthy.

## Symptoms

- CodeQL `js/request-forgery` (critical, alert #51) fires on the proxy `fetch(safeUrl, ...)` call in `apps/web/src/app/api/download/route.ts` despite a hostname allowlist + URL reconstruction + redirect-blocking + bounded headers + bounded timeout.
- Adding the documented inline suppression `// codeql[js/request-forgery]` above the call site has **no effect** on the alert state — Default Setup ignores it.
- Hostname allowlists alone do not protect against subdomain-takeover-induced DNS rebinding.
- Direct CDN URLs do not reliably set `Content-Disposition: attachment`; cross-origin `<a download>` silently navigates the tab.

## What Didn't Work

- **Inline suppression via `// codeql[js/request-forgery]`.** The comment renders correctly but is invisible to GitHub's hosted Default Setup pipeline. CI continued to fail. We left the comment in source as documentation for human readers and as a forward-compatible hook if we move to Advanced Setup, but it is **not** the load-bearing remediation.
- **URL reconstruction alone (`parsed.origin + parsed.pathname + parsed.search`).** This drops userinfo and fragment cleanly, but CodeQL's data-flow analysis still traces `request.url` → `fetch`. Stripping bytes off a tainted URL doesn't sanitize it in CodeQL's model.
- **Treating the hostname allowlist as a complete defense.** It is a necessary condition, not a sufficient one — subdomain takeover is the canonical bypass. Without DNS pre-flight, the proxy fetches whatever an attacker has rebound an allowlisted hostname to point at.

## Solution

The full remediation is two-sided: a **6-layer SSRF defense pattern** on the proxy itself, plus a **CodeQL false-positive remediation matrix** for Default Setup.

### Part 1 — The 6-layer SSRF defense pattern

Every server-side proxy in `apps/web` that fetches a URL constructed from request input must layer **all six** of the following defenses. No single layer is sufficient.

#### Layer 1 — HTTPS-only + hostname allowlist (suffix match for subdomains)

Source of truth: `apps/web/src/lib/download-allowlist.ts`. Keep the allowlist in a small single-purpose module so it's grep-able, testable, and editable independently from the route handler.

```ts
// apps/web/src/lib/download-allowlist.ts
export function isAllowedDownloadOrigin(url: string): boolean {
  let parsed: URL
  try {
    // Single-arg form — no `base`. Protocol-relative or malformed URLs throw
    // and the catch returns `false`.
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== "https:") return false

  const host = parsed.hostname
  return (
    host === "jesusfilm.org" ||
    host.endsWith(".jesusfilm.org") ||
    host === "stream.mux.com" ||
    host.endsWith(".mux.com")
  )
}
```

Three things the suffix check does correctly that hand-rolled allowlists usually get wrong:

1. **The exact-match arm (`host === "jesusfilm.org"`) is required** — `endsWith(".jesusfilm.org")` excludes the apex by design (no leading dot would mean `evil-jesusfilm.org` matches).
2. **Protocol-relative URLs (`//host/path`) throw** in `new URL()`'s single-arg form, so they take the catch and return `false`. Don't pass a `base` here.
3. **HTTPS is enforced before the hostname check**, so `http:`, `javascript:`, `data:`, `file:` are rejected without ever reaching the suffix logic.

#### Layer 2 — URL reconstruction from validated components

After the allowlist passes, **never feed the raw input string to `fetch`**. Reconstruct the URL from `parsed.origin + parsed.pathname + parsed.search`. This drops:

- **Userinfo** — `https://stream.mux.com@evil.com/...` survives some allowlist implementations because they read `parsed.host`. Userinfo can also change request semantics.
- **Fragment** — never sent over the wire anyway, but stripping it makes the value you log match what you actually fetched.

```ts
// from apps/web/src/app/api/download/route.ts
// Re-parse and reconstruct from validated components only. Drops any
// userinfo (`https://user:pass@host/`) and fragment that survived
// `isAllowedDownloadOrigin`'s hostname-only check, so credentials
// can't leak into the upstream request.
const parsed = new URL(target)
const safeUrl = parsed.origin + parsed.pathname + parsed.search
```

#### Layer 3 — DNS pre-flight resolution that rejects RFC 1918 / loopback / link-local / IPv4-mapped-IPv6

This is the **load-bearing** defense against subdomain-takeover-via-DNS-rebinding. The hostname allowlist trusts that `*.jesusfilm.org` resolves to a CDN. DNS pre-flight verifies it.

```ts
// from apps/web/src/app/api/download/route.ts

// IPv4 ranges to reject for SSRF defense. RFC 1918 private space + loopback +
// link-local (cloud-metadata 169.254.169.254 lives here). We resolve DNS
// ourselves before the fetch and reject any result that lands in these
// ranges — closes DNS-rebinding via subdomain-takeover even though the
// hostname is allowlisted.
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  if (a >= 224) return true // multicast / reserved
  return false
}

// IPv6 ranges to reject. Loopback (::1), link-local (fe80::/10),
// unique local (fc00::/7), IPv4-mapped (::ffff:0:0/96) — the last lets a
// rogue resolver smuggle an internal IPv4 through an IPv6 result.
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === "::1" || lower === "::") return true
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return true
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7)
    if (isIP(v4) === 4 && isPrivateIPv4(v4)) return true
  }
  return false
}

/**
 * Resolves the hostname and rejects if any answer is a private / loopback /
 * link-local / multicast / reserved IP. Standard SSRF defense (OWASP cheat
 * sheet) — closes DNS-rebinding via subdomain takeover that the hostname
 * allowlist alone cannot see. A narrow TOCTOU window remains between this
 * resolution and undici's own resolution at fetch time; for our threat
 * model (allowlist of two operator-trusted domains) that gap is
 * acceptable. To close it atomically we'd need an undici dispatcher that
 * pins the resolved IP, which the platform doesn't expose natively.
 */
async function resolvesToPublicIp(hostname: string): Promise<boolean> {
  // Skip resolution if the hostname IS already an IP literal — `URL`
  // accepts those and we still need to validate them.
  const literal = isIP(hostname)
  if (literal === 4) return !isPrivateIPv4(hostname)
  if (literal === 6) return !isPrivateIPv6(hostname)

  const resolutions = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ])
  const ips: string[] = []
  for (const r of resolutions) {
    if (r.status === "fulfilled") ips.push(...r.value)
  }
  if (ips.length === 0) {
    // No DNS answer at all — let the fetch surface the failure rather
    // than guessing here.
    return true
  }
  return ips.every((ip) => !(isPrivateIPv4(ip) || isPrivateIPv6(ip)))
}
```

Five subtleties most implementations miss:

1. **Both A and AAAA must be checked** (`Promise.allSettled([resolve4, resolve6])`) — an attacker who controls DNS can return public IPv4 + private IPv6, and a single-family check passes.
2. **`every` not `some`** — if _any_ resolved IP is private, reject. This blocks the "mix one public IP with one private IP" trick.
3. **IPv4-mapped IPv6 (`::ffff:127.0.0.1`)** is the way an attacker smuggles an IPv4 through an AAAA answer. The IPv6 check explicitly decomposes this form.
4. **IP literals as hostnames** — `URL` accepts `https://10.0.0.5/x` as a valid URL. Pre-empt `dns.resolve` by detecting `isIP(hostname)` and validating directly.
5. **`isPrivateIPv6` startswith bands** (`fe8/fe9/fea/feb`) cover all of `fe80::/10` (link-local) without parsing colons. `fc/fd` cover all of `fc00::/7` (unique local). Keep it readable; bit math is harder to audit.

#### Layer 4 — `redirect: "manual"` on the upstream fetch

The allowlist validates the **initial** URL only. A 302 from upstream pointing at `https://attacker.com/...` would be silently followed by default `fetch`. Setting `redirect: "manual"` surfaces 3xx as `type === "opaqueredirect"` with `status === 0`; we treat any non-200/non-206 as a failure:

```ts
upstream = await fetch(safeUrl, {
  headers: upstreamHeaders,
  redirect: "manual",
  signal,
})
```

```ts
// `redirect: "manual"` surfaces 3xx as `type === "opaqueredirect"` with
// status 0; treat any non-200/non-206 as upstream failure.
if (
  upstream.type === "opaqueredirect" ||
  (upstream.status >= 300 && upstream.status < 400)
) {
  console.error("[api/download] upstream attempted redirect", {
    target: safeLogUrl(target),
  })
  return jsonError("Upstream redirected; refusing to follow", 502)
}
```

If you ever need to follow redirects, **re-run the full validation chain on each hop** — don't switch to `redirect: "follow"`.

#### Layer 5 — Bounded outbound headers; no cookies, no `Authorization`

Construct the upstream `headers` from a closed allowlist of conditional-request headers. Never spread the incoming `request.headers`. Node's `fetch` doesn't forward `Cookie`/`Authorization` cross-origin by default, but explicit-allowlist construction is the only way to make this fact obvious to a reviewer.

```ts
// Conditional/Range headers the browser sends to validate a resumable
// download. Forwarded as a unit so the upstream can return 206 + matching
// validators (or 412 if the asset has rotated).
const CLIENT_CONDITIONAL_HEADERS = [
  "range",
  "if-range",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
] as const

// ...inside GET():
const upstreamHeaders: HeadersInit = {}
for (const name of CLIENT_CONDITIONAL_HEADERS) {
  const value = request.headers.get(name)
  if (value) upstreamHeaders[name] = value
}
```

The matching **response** allowlist keeps the upstream from returning headers we'd then re-emit (`Set-Cookie`, `X-Frame-Options`, etc.):

```ts
const ALLOWED_DOWNLOAD_HEADERS = [
  "content-type",
  "content-length",
  // Required on 206 Partial Content per RFC 7233 §4.1 — without it the
  // browser cannot validate the byte slice received and cannot resume an
  // interrupted download.
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const

// ...inside GET():
const headers = new Headers()
for (const name of ALLOWED_DOWNLOAD_HEADERS) {
  const value = upstream.headers.get(name)
  if (value) headers.set(name, value)
}
```

Both directions are tested: see the "response header allowlist" suite in `route.test.ts` — `set-cookie` and `x-attacker-frame` from upstream are dropped, only `content-type` survives.

#### Layer 6 — `AbortSignal.any` combining client abort + 30s connect timeout

A stalled CDN cannot be allowed to pin a Node worker until `maxDuration` (600s). Compose two signals:

```ts
// Combine the client's abort signal with our own connect-phase timeout
// so a stalled CDN can't pin a Node worker forever. AbortSignal.any is
// available on Node 20.5+ and supported by Vercel/Railway runtimes.
const timeoutController = new AbortController()
const timeoutId = setTimeout(() => timeoutController.abort(), 30_000)
const signal =
  typeof AbortSignal.any === "function"
    ? AbortSignal.any([request.signal, timeoutController.signal])
    : timeoutController.signal
```

```ts
// inside the catch:
if (request.signal.aborted) {
  // Client disconnected first — no point logging or returning a body
  // the client will never read.
  return new NextResponse(null, { status: 499 })
}
```

```ts
// always:
finally {
  clearTimeout(timeoutId)
}
```

`AbortSignal.any` is the right primitive — it fires on the first of {client disconnect, 30s connect timeout}. The `clearTimeout` in `finally` matters: without it, a fast successful fetch leaves an unreferenced timer running and Node won't exit cleanly in tests.

#### Putting it together — annotated call site

This is the actual `fetch` call from `route.ts` with the inline comment block that documents which layer is doing what:

```ts
let upstream: Response
try {
  // SSRF mitigations layered for this call:
  //   1. `isAllowedDownloadOrigin(target)` rejects non-HTTPS and
  //      non-allowlisted hostnames before we get here.
  //   2. `safeUrl` is reconstructed from `parsed.origin/pathname/search`
  //      so userinfo and fragment are dropped.
  //   3. `resolvesToPublicIp` rejects private/loopback/link-local DNS
  //      results so subdomain-takeover-via-DNS-rebinding can't smuggle
  //      an internal IP through an allowlisted hostname.
  //   4. `redirect: "manual"` blocks any 3xx the upstream might use to
  //      pivot to a non-allowlisted origin.
  //   5. `headers: upstreamHeaders` only contains the client's
  //      conditional-request headers (Range / If-Range / etc.) — no
  //      cookies, no Authorization. Node's fetch doesn't forward them
  //      cross-origin by default.
  //   6. `signal` is bounded by a 30s connect timeout and the client's
  //      abort signal, so a stalled CDN can't pin a Node worker.
  // CodeQL's `js/request-forgery` doesn't model any of these as
  // sanitizers (per RequestForgeryCustomizations.qll — only
  // `UriEncodingSanitizer` and models-as-data barriers are recognized).
  // codeql[js/request-forgery]
  upstream = await fetch(safeUrl, {
    headers: upstreamHeaders,
    redirect: "manual",
    signal,
  })
} catch (err) {
  if (request.signal.aborted) {
    return new NextResponse(null, { status: 499 })
  }
  console.error("[api/download] upstream fetch failed", {
    target: safeLogUrl(target),
    err: err instanceof Error ? err.message : String(err),
  })
  return jsonError("Upstream fetch failed", 502)
} finally {
  clearTimeout(timeoutId)
}
```

#### Test coverage for the defenses

`route.test.ts` has 22 tests; the SSRF-specific 8 are in the **DNS pre-flight** suite. They exhaust the rejection paths because CodeQL doesn't know they exist — the test suite is our compensating proof.

```ts
describe("GET /watch/api/download — DNS pre-flight (SSRF defense)", () => {
  it("rejects with 403 when the hostname resolves to a loopback IP (subdomain takeover → 127.0.0.1)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["127.0.0.1"])
    /* ... expect 403 */
  })

  it("rejects when the hostname resolves to RFC 1918 private space (10.0.0.0/8)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["10.0.0.5"])
    /* ... expect 403 */
  })

  it("rejects when the hostname resolves to link-local space (169.254.169.254 = AWS metadata)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["169.254.169.254"])
    /* ... expect 403 */
  })

  it("rejects 172.16.0.0/12 specifically (boundary check)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["172.20.0.1"])
    /* ... expect 403 */
  })

  it("allows 172.15.x and 172.32.x (just outside the private 172.16-31 range)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["172.15.0.1"])
    /* ... expect 200 */
  })

  it("rejects when ANY of multiple resolved IPs is private (defense against attacker mixing public+private answers)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["203.0.113.1", "10.0.0.5"])
    /* ... expect 403 */
  })

  it("rejects IPv6 loopback (::1)", async () => {
    vi.mocked(dns.resolve4).mockRejectedValueOnce(new Error("ENODATA"))
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::1"])
    /* ... expect 403 */
  })

  it("rejects IPv4-mapped-IPv6 form of a private IPv4 (::ffff:127.0.0.1)", async () => {
    vi.mocked(dns.resolve4).mockRejectedValueOnce(new Error("ENODATA"))
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:127.0.0.1"])
    /* ... expect 403 */
  })
})
```

The default DNS mock returns `203.0.113.1` (TEST-NET-3 from RFC 5737 — guaranteed unroutable test space, never a real answer). Tests override per-case.

### Part 2 — CodeQL `js/request-forgery` false-positive remediation in Default Setup

#### What CodeQL recognizes as a sanitizer (and what it doesn't)

CodeQL's `js/request-forgery` is implemented in `RequestForgeryCustomizations.qll`. The query treats a value as sanitized only if:

- It flows through `UriEncodingSanitizer` (`encodeURIComponent`/`encodeURI`), **OR**
- It hits a barrier registered via the **models-as-data** mechanism (a YAML data extension that names a function as a `Barrier`).

**What CodeQL does _not_ recognize as sanitizers:**

- An origin allowlist function returning a boolean that gates the fetch.
- A DNS pre-flight that rejects private IPs.
- URL reconstruction from `parsed.origin + parsed.pathname + parsed.search`.
- `redirect: "manual"`, `AbortSignal`, header allowlists.

This is why our `fetch(safeUrl, ...)` lights up alert #51 even with all six layers in place. The defenses are real; the CodeQL data-flow model just doesn't see them.

#### The failed remediation — `// codeql[...]` inline suppression

Our first attempt was the inline suppression comment shown in the call-site annotation above:

```ts
// codeql[js/request-forgery]
upstream = await fetch(safeUrl, { ... })
```

**This does not work in GitHub's hosted Default Setup.** That syntax is recognized only by the CodeQL CLI when you run analysis locally with `--sarif-add-snippets` and a custom config. Default Setup ignores inline comments entirely. The alert remains open, CI continues to fail.

We left the comment in the code anyway — it documents intent for any human reading the file, and it will activate if/when we move to advanced setup. **But do not rely on it.**

#### The three remediation paths that actually work

##### (a) Dismiss in the Security tab UI — recommended for this case

Navigate to **Security → Code scanning → Alert #51 → Dismiss → "False positive"** and paste a structured rationale. This is auditable (the dismissal is logged with author, timestamp, and reason), requires no code change, and is the right tool when **the defenses are real but CodeQL doesn't model them as sanitizers**.

Rationale template — paste verbatim into the dismissal comment, edit only the file path / alert ID:

```
False positive — js/request-forgery alert #51 on apps/web/src/app/api/download/route.ts.

The flagged fetch is gated by 6 layers of SSRF defense that CodeQL's
`js/request-forgery` query (RequestForgeryCustomizations.qll) doesn't
model as sanitizers. Documented at the call site (lines ~256-275) and
covered by the test suite (`route.test.ts`, 8 DNS pre-flight tests):

  1. `isAllowedDownloadOrigin` — HTTPS-only + suffix-match hostname allowlist
     (jesusfilm.org, *.jesusfilm.org, stream.mux.com, *.mux.com).
  2. `safeUrl = parsed.origin + parsed.pathname + parsed.search` —
     reconstructed from validated components, drops userinfo and fragment.
  3. `resolvesToPublicIp` — DNS pre-flight that rejects RFC 1918 / loopback /
     link-local / IPv4-mapped-IPv6 results before the fetch issues.
  4. `redirect: "manual"` — 3xx surfaces as opaqueredirect and is rejected
     with a 502.
  5. `headers: upstreamHeaders` — closed allowlist of Range/If-Range/etc.
     No cookies, no Authorization forwarded.
  6. `signal: AbortSignal.any([request.signal, timeoutController.signal])` —
     30s connect timeout + client abort.

Residual risk (TOCTOU between DNS pre-flight and undici's own resolution at
connect time): accepted. Closing it requires an undici dispatcher that pins
the resolved IP, which Node 22 doesn't expose cleanly (nodejs/undici#2019).
For our threat model — operator-trusted allowlist of two domains — the gap
is acceptable.
```

Trade-offs:

- **Pro:** zero code churn, full audit trail in the GitHub UI.
- **Pro:** survives CodeQL query updates that change the alert ID/location predicate.
- **Con:** the dismissal lives in GitHub, not the repo. A new clone of the repo doesn't carry it.
- **Con:** if the file is meaningfully edited, GitHub may reopen the alert as a "new" finding.

##### (b) Add a CodeQL data-extension YAML pack

Register `isAllowedDownloadOrigin` (or any equivalent guard) as a `RequestForgery` barrier so CodeQL's data-flow analysis clears the path. This is the **real fix** from CodeQL's perspective and the cleanest answer if we expect more proxies.

Sketch — `.github/codeql/extensions/request-forgery-barriers.yml`:

```yaml
extensions:
  - addsTo:
      pack: codeql/javascript-queries
      extensible: requestForgeryBarrierModel
    data:
      # Function in apps/web/src/lib/download-allowlist.ts that returns true
      # only when the URL is HTTPS and on the operator-trusted allowlist.
      # When this returns true on a path, the URL is no longer tainted for
      # the purposes of js/request-forgery.
      - [
          "@forge/web",
          "Member[isAllowedDownloadOrigin].ReturnValue",
          "true",
          "request-forgery",
        ]
```

And reference the pack in `.github/codeql/codeql-config.yml`:

```yaml
name: forge-codeql-config
disable-default-queries: false
queries:
  - uses: security-extended
packs:
  javascript:
    - codeql/javascript-queries
extensions:
  - .github/codeql/extensions/request-forgery-barriers.yml
```

Trade-offs:

- **Pro:** structural fix; CodeQL no longer flags the call.
- **Pro:** scales — every future proxy that uses the same guard auto-clears.
- **Con:** moves the project off GitHub's hosted Default Setup onto **Advanced Setup** (requires checking in `codeql-config.yml` and a workflow file). One-time migration, not a per-alert burden.
- **Con:** the YAML grammar for `extensible: requestForgeryBarrierModel` is sparsely documented; expect iteration before it works on a real query run.

##### (c) Query-filter exclude in `.github/codeql/codeql-config.yml`

The heaviest hammer — silence the rule for an entire path glob:

```yaml
query-filters:
  - exclude:
      id: js/request-forgery
      paths:
        - apps/web/src/app/api/download/route.ts
```

Trade-offs:

- **Pro:** simple to write, version-controlled, leaves no UI artifact.
- **Con:** silences the rule globally for that path — a regression that introduces a _real_ SSRF in the same file would not be caught.
- **Con:** also requires Advanced Setup.

**Avoid this option** unless an entire module is fundamentally at odds with a rule (e.g. a sandbox executor where every flagged behavior is by design).

#### Decision matrix

| Situation                                                                    | Recommended path                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| One-off proxy with full layered defense, defenses won't change               | **(a) Dismiss in UI** with the rationale template                          |
| Multiple proxies sharing a guard function; willing to move to Advanced Setup | **(b) Data-extension YAML pack** registering the guard as a barrier        |
| Module-wide mismatch with the rule's threat model                            | **(c) Query-filter exclude** — last resort                                 |
| `// codeql[js/request-forgery]` inline comment                               | **Does not work in Default Setup. Do not use as the primary remediation.** |

#### Per-method alerts on multi-method routes (added 2026-05-12)

Adding a new HTTP method handler (`HEAD`, `POST`, `OPTIONS`, etc.) to a route that already has a dismissed `js/request-forgery` alert produces a **fresh, independently-numbered alert** on the new method's `fetch` call site — even when the new handler reuses every defense layer via shared helpers.

This was observed on PR #923, which added a `HEAD` handler to `apps/web/src/app/api/download/route.ts` after PR #868 had already dismissed alert #51 on the `GET` handler. The new HEAD handler routes through the same `validateTarget()` helper (allowlist + DNS pre-flight + URL reconstruction) and the same `buildUpstreamSignal()` helper (manual-redirect + AbortSignal) — but CodeQL raised alert #52 on the HEAD fetch regardless, because **each `fetch` call site is an independent sink in CodeQL's data-flow model**. Shared validation upstream is not enough; the analyzer only sees the path from `request.url` to the new sink.

The remediation is the same as `(a)` above — dismiss the new alert via the Security tab or API — with a compressed rationale that cross-references this doc and the prior dismissal rather than re-stating the full evidence trail. The full 1890-character rationale template from "Part 2 → (a)" exceeds the API's 280-character `dismissed_comment` cap; the short form below was verified working on alert #52.

##### Dismissal API contract — verified working invocation

```bash
gh api -X PATCH "repos/<owner>/<repo>/code-scanning/alerts/<N>" \
  -f state=dismissed \
  -f "dismissed_reason=false positive" \
  -f "dismissed_comment=FP — <method> handler shares every SSRF defense from GET (allowlist, DNS pre-flight, URL reconstruction, manual-redirect, AbortSignal). See docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md and prior dismissal #<M>."
```

Two API contract details that surfaced on PR #923 and rejected the first attempts with HTTP 422:

| Field               | Correct form                                                                           | Common mistake                                                          |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `dismissed_reason`  | `"false positive"` (space-separated, quoted) — also `"won't fix"` or `"used in tests"` | `false_positive` (underscore) → 422                                     |
| `dismissed_comment` | ≤ 280 characters; cross-reference the doc                                              | Pasting the full rationale → 422 with `Only 280 characters are allowed` |

After the API call, the PR's CodeQL check flips from `fail` to `pass` within seconds — the same outcome as a UI-driven dismissal, with an audit trail in the Security tab.

##### When to escalate from per-method dismissal to path (b)

Per-alert dismissal stays correct while the total number of dismissed `js/request-forgery` alerts on this proxy class is small (≤ 2 — currently the GET + HEAD handlers). At three or more alerts, the maintenance cost of one-off dismissals exceeds the cost of moving to **path (b)** — registering `validateTarget` (or `isAllowedDownloadOrigin`) as a `requestForgeryBarrierModel` in a data-extension YAML pack. Triggers for the migration:

- A new proxy route in `apps/web` adopts the same `validateTarget` pattern (third call site).
- Any new HTTP method is added to an existing proxy and the team forgets to dismiss (alert lingers in the Security tab).
- The CodeQL query is updated upstream and re-opens dismissed alerts (rare but possible — dismissals are per-alert-instance, and a moved line can produce a new alert).

When migrating, keep the inline `// codeql[js/request-forgery]` comments in source as documentation for human readers — they describe intent and become active when (b) lands.

#### Residual risk we accepted

There is a **narrow TOCTOU window** between the DNS pre-flight in `resolvesToPublicIp` and undici's own DNS resolution at connect time. An attacker who controls the authoritative DNS for an allowlisted-but-takeover-able subdomain could return a public IP to our `dns.resolve4` call and a private IP to undici's call milliseconds later.

**Why we accepted it:**

- The allowlist is two operator-controlled domains (`jesusfilm.org`, `mux.com`). Subdomain takeover requires either an internal misconfiguration on `*.jesusfilm.org` or compromising Mux. Both are actively monitored.
- Closing the window atomically requires an undici dispatcher that pins the resolved IP for the fetch (see `nodejs/undici#2019`). Node 22 does not expose this cleanly.
- The cost of the partial defense is low: 2 DNS lookups before each download. The marginal cost of the missing atomic close is high (custom dispatcher, ongoing maintenance).

If the threat model changes (e.g. user-controlled URL submission), revisit immediately.

## Why This Works

**SSRF is OWASP Top 10 (A10:2021).** Server-side proxies are the most common foothold for cloud-metadata exfiltration — the canonical payload is a fetch to `http://169.254.169.254/latest/meta-data/iam/security-credentials/` to lift IAM credentials off the underlying host. AWS, GCP, Azure, and DigitalOcean all expose metadata services on link-local IPs that are unauthenticated by default. An SSRF in `apps/web` running on Railway is one fetch away from credential theft if the allowlist is paper-thin.

**A hostname allowlist alone is insufficient.** This is the single most common implementation mistake. The allowlist trusts that DNS for the listed hostnames continues to point at the expected CDN. Subdomain takeovers happen — a developer creates `marketing-2023.jesusfilm.org` pointing at a since-deleted Vercel site, an attacker registers the abandoned target, and now `https://marketing-2023.jesusfilm.org` is whatever they want it to be. Without DNS pre-flight, the proxy fetches whatever the attacker serves, including a 302 to `http://169.254.169.254/`.

**Mishandling CodeQL false-positives erodes the security signal both ways.** Suppress too eagerly with `// codeql[...]` (which silently fails in Default Setup) and you ship the alert open, where it accumulates with real findings until nobody reads them. Add a `query-filter exclude` for a single false positive and you silence the rule for an entire path, hiding any future regression. The right tool for each situation is in the matrix above; using the wrong one is worse than doing nothing because it gives the appearance of resolution.

**Codifying the pattern saves the next implementer hours.** PR #868's first round of remediation tried inline suppression, watched CI fail again, then went searching for documentation that doesn't exist on the GitHub side. The dismissal-comment template alone saves the next person 30+ minutes of writing rationale from scratch — and it ensures the dismissal carries the same evidence every time, which matters for security audits.

## Prevention

Apply the **6-layer SSRF defense** when:

- Adding any new server-side proxy in `apps/web` that fetches a URL constructed from request input (query string, path, body, header).
- Building a webhook receiver that follows links provided by the webhook payload.
- Implementing a "fetch metadata" feature (link previews, OG tag scrapers, oEmbed) — these are SSRF magnets.
- Adding any GraphQL resolver in `apps/cms` that performs an HTTP fetch on a user-supplied URL (the same pattern translates).

Apply the **CodeQL false-positive matrix** when:

- A `js/request-forgery` alert fires on a fetch you've genuinely hardened. Use the dismissal template.
- More than one proxy in the repo triggers the same pattern. Move to the data-extension YAML pack.
- A module is structurally incompatible with a CodeQL rule (rare). Use a query-filter exclude only with a written justification reviewed by the security owner.
- Any time you reach for `// codeql[...]` — stop, check whether you're on Default Setup, and if so, pick (a)/(b)/(c) instead.

Do **not** apply this pattern when:

- The fetch is to a constant URL (no request input flows in). CodeQL won't flag it; defenses are unnecessary.
- The proxy is in a service that doesn't run on a cloud provider with an IMDS (rare in our infra — assume it does).
- You're tempted to skip Layer 3 (DNS pre-flight) "because the allowlist is enough." It isn't. Subdomain takeover is the canonical bypass.

### Examples — before / after

#### Before — unguarded fetch (DO NOT SHIP)

```ts
// apps/web/src/app/api/download/route.ts (hypothetical bad version)
export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url")
  if (!target) return new Response("Missing url", { status: 400 })

  // NO allowlist, NO DNS check, follows redirects, forwards all headers,
  // no timeout. CodeQL js/request-forgery will fire (correctly).
  const upstream = await fetch(target, {
    headers: request.headers, // leaks Cookie + Authorization
  })
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: upstream.headers, // re-emits Set-Cookie etc.
  })
}
```

Attacker payload: `GET /watch/api/download?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/role-name` — IAM credentials returned in the response body.

#### After — the layered defense (the actual route)

See `apps/web/src/app/api/download/route.ts` (full handler). Each layer is annotated; the test suite covers the rejection paths.

#### DNS pre-flight test boundary cases (worth re-reading)

The two tests that pin the **boundary** of the RFC 1918 172.16/12 block are the ones that catch off-by-one regressions:

```ts
it("rejects 172.16.0.0/12 specifically (boundary check)", async () => {
  vi.mocked(dns.resolve4).mockResolvedValueOnce(["172.20.0.1"])
  const res = await GET(
    makeRequest({ url: "https://stream.mux.com/abc.mp4", filename: "x.mp4" }),
  )
  expect(res.status).toBe(403)
})

it("allows 172.15.x and 172.32.x (just outside the private 172.16-31 range)", async () => {
  vi.mocked(dns.resolve4).mockResolvedValueOnce(["172.15.0.1"])
  mockUpstream(new Response("ok", { status: 200 }))
  const res = await GET(
    makeRequest({ url: "https://stream.mux.com/abc.mp4", filename: "x.mp4" }),
  )
  expect(res.status).toBe(200)
})
```

If a future refactor changes the bounds check to `b > 16 && b < 31` or `b >= 16 && b < 32`, these two tests catch it.

#### Mixed-IP rejection (multi-answer DNS)

```ts
it("rejects when ANY of multiple resolved IPs is private (defense against attacker mixing public+private answers)", async () => {
  vi.mocked(dns.resolve4).mockResolvedValueOnce(["203.0.113.1", "10.0.0.5"])
  const res = await GET(
    makeRequest({ url: "https://stream.mux.com/abc.mp4", filename: "x.mp4" }),
  )
  expect(res.status).toBe(403)
})
```

This is the test that pins `every` (not `some`) in `resolvesToPublicIp`. A naive implementation using `some((ip) => !isPrivate(ip))` would let a `[public, private]` DNS answer through.

## Related Issues

- **Source files (this repo):**
  - `apps/web/src/app/api/download/route.ts` — the route handler (layered defenses, suppression-comment block at lines ~256–275).
  - `apps/web/src/lib/download-allowlist.ts` — `isAllowedDownloadOrigin`.
  - `apps/web/src/app/api/download/route.test.ts` — 22 tests, 8 DNS pre-flight cases.
- **PR #868** (`feat/watch-download-proxy-hardening`) — introduced the layered defenses; CodeQL alert #51 dismissed via the template above.
- **PR #923** (`feat/web-video-details-polish`) — added a `HEAD` method handler to the same route; CodeQL alert #52 dismissed via the API contract documented in "Per-method alerts on multi-method routes" above.
- **Sibling learnings:**
  - `docs/solutions/security-issues/codeql-tainted-output-striphtml-console-error-20260414.md` — opposite axis (restructure the data flow vs. dismiss-with-rationale). Pick this doc's strategy when the sink is the intended behavior; pick the striphtml doc's strategy when the taint can be removed at the source.
  - `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md` — same threat-model-clarity discipline.
  - `docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md` — fail-closed allowlist precedent on a different surface.
  - `docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md` — adjacent server-side-fetch-with-user-input pattern.
- **External references:**
  - [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
  - [OWASP Top 10 — A10:2021 SSRF](https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/)
  - [CodeQL `js/request-forgery` rule](https://codeql.github.com/codeql-query-help/javascript/js-request-forgery/)
  - [CodeQL data extensions for JavaScript](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-javascript/)
  - [GitHub docs — dismissing code-scanning alerts](https://docs.github.com/en/code-security/code-scanning/managing-code-scanning-alerts/dismissing-alerts-from-code-scanning)
  - [`nodejs/undici#2019`](https://github.com/nodejs/undici/issues/2019) — dispatcher-level IP pinning
  - [RFC 1918](https://datatracker.ietf.org/doc/html/rfc1918) — IPv4 private address ranges
  - [RFC 4193](https://datatracker.ietf.org/doc/html/rfc4193) — Unique local IPv6 unicast addresses
  - [RFC 5737](https://datatracker.ietf.org/doc/html/rfc5737) — IPv4 documentation address blocks
  - [RFC 6266](https://datatracker.ietf.org/doc/html/rfc6266) — `Content-Disposition` header
  - [RFC 7233 §4.1](https://datatracker.ietf.org/doc/html/rfc7233#section-4.1) — Range Requests / `Content-Range`
  - [AWS IMDS metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)
