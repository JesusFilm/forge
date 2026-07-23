---
title: "Guard-then-use extraction — the shared use-half must pin the invariant the guard established"
date: "2026-07-22"
category: "best-practices"
problem_type: "best_practice"
module: "apps/chat"
component: "service_object"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/mastra"
applies_when:
  - "A refactor extracts a check-then-act (guard-then-use) pair into separate shared helpers that callers import independently"
  - "The act half attaches a credential or performs a privileged side effect the check half was supposed to gate"
  - 'A comment or calling convention ("run the guard first") is the only thing coupling the two extracted exports'
tags:
  - "refactoring"
  - "extraction"
  - "invariant"
  - "ssrf"
  - "shared-module"
  - "bearer"
  - "mastra"
  - "apps-chat"
---

# Guard-then-use extraction — the shared use-half must pin the invariant the guard established

Vocabulary: this doc calls the pair **check-then-act** and its second half the **act half**
(the "use" half named in the title's _guard-then-use_). One concept, two names — the
title/frontmatter carry the pattern-level alias; the body standardizes on _act half_.

## Context

When a **check-then-act** pair (validate a value, then do something privileged with
it) sits inline in one function, the check visibly guards the act — you can read the
two lines together and audit that the act only runs after the validation. Extracting
that pair into two separate shared helpers, so a fix lands once and future callers
reuse it, is normally a clean win. But the extraction quietly changes the contract:
the two halves are now independent exports coupled only by a _convention_ ("call the
guard before the act"). A future caller imports the act half and the convention does
not travel with it. If the act half can be handed an input that **violates an
invariant the guard was relied upon to establish**, the guard is no longer
load-bearing for that input — it validated a value the act half never re-checked.

This surfaced in `apps/chat` feat-282 PR 2 (ticket
`docs/roadmap/ai-chat/feat-282-chat-shared-mastra-transport.md`), which extracted the
two Mastra proxies' transport into a shared server-only module,
`apps/chat/src/lib/server/mastra-upstream.ts`. Before the extraction, the SSRF guard
(`hostAllowed`) and the outbound `fetch` sat adjacent in the seeker route file, so the
check visibly guarded the act. After it, `hostAllowed` and the fetch helper
(`postMastraUpstream`) became two separate exports with a "callers run `hostAllowed`
on the base BEFORE this" comment as the only coupling.

## Guidance

**When a refactor extracts a check-then-act pair into shared helpers, the ACT half
must carry — in code, not in a comment — whatever guarantee it needs about its own
inputs.** Future callers import the helper, not the pairing convention that made the
original call site safe. A doc comment saying "run the guard first" does not survive
the extraction; only code does.

**Boundary — this works cleanly only when the guarantee is cheaply re-derivable from
the act half's own inputs.** The origin pin below re-derives its answer in O(1) from
the `baseUrl` the helper already receives, without re-running the guard. When the
guard's verdict is async, expensive, or time-varying (an authorization/ACL check, a DB
ownership lookup, a rate-limit token), or depends on inputs the act half doesn't hold,
the act half usually cannot cheaply re-derive it — there "enforce, re-verify, or pin"
collapses to **"require a proof the check already ran"**: a validated witness or
branded type the guard mints and the act half demands, not a second call. Pick the
mechanism the invariant affords; the rule is that the guarantee lives in the act half's
type or code, never in a comment.

The worked instance is precise about _which_ invariant leaked. `postMastraUpstream`
builds its target URL with `new URL(request.path, request.baseUrl)`. WHATWG URL
resolution **discards the base's authority/origin** when `path` is absolute
(`"https://evil.example/x"`) or scheme-relative (`"//evil.example/x"`) — for the
scheme-relative case the base's _scheme_ is inherited and only the host/origin is
replaced, which is exactly why an **origin** comparison, not a string prefix check, is
the right guard. So a future caller could run `hostAllowed` on the base (check passes),
then hand the helper a hostile or mistaken `path`, and the helper would attach the
`Authorization` bearer and send it to an unvalidated host. The guard checked the base;
the request went elsewhere. This was **unreachable from the current callers** — the
seeker send path passes `"/forge-seeker"` and the history proxy passes
`"/forge-ai-chat-history-list"` or `"/forge-ai-chat-history-replay"`, all compile-time
root-relative constants, none client-influenced — so every wire-contract test stayed
green. It is a latent contract weakness in new shared infrastructure, not a live
vulnerability.

The fix is an **origin pin inside the act half**: construct the URL, compare its
`origin` against `new URL(request.baseUrl).origin`, and `throw` a `TypeError` _before_
the bearer is attached when they differ. Because the throw happens before `fetchImpl`
is called, the `Authorization` header — assembled in that same `fetch` init — is never
transmitted. Root-relative paths keep the base's origin and pass; absolute and
scheme-relative paths change the origin and are rejected. The pin re-derives the origin
from the helper's own `baseUrl` input; it does not re-run `hostAllowed` (it never
receives the allowlist), so it closes the **path-escapes-the-base** gap only — see
"Scope and limits" below for what it deliberately does _not_ close.

```ts
export function postMastraUpstream(
  fetchImpl: typeof fetch,
  request: MastraUpstreamRequest,
): Promise<Response> {
  const url = new URL(request.path, request.baseUrl)
  // Origin pin: an absolute or scheme-relative `path` would DISCARD the
  // hostAllowed-validated base and egress the bearer off-host — fail closed
  // before attaching it. Unreachable from callers passing literal paths.
  if (url.origin !== new URL(request.baseUrl).origin) {
    throw new TypeError("postMastraUpstream: path escapes the base origin")
  }
  return fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${request.apiKey}` /* … */ },
    body: JSON.stringify(request.body),
    redirect: "error",
    signal: request.signal,
  })
}
```

**Fail-closed and wire-safe.** Both proxies already call the transport inside
`try/catch`, so the `TypeError` reuses their _existing_ failure branch — no new outcome
enum, no new wire shape (the seeker send path returns an `error` frame with reason
`network_error`; the history proxies return a 502 with reason `unavailable`). It is
defense-in-depth alongside `redirect:"error"`: `redirect:"error"` blocks off-host
_hops after_ the request leaves, whereas the origin pin blocks the request from ever
being _constructed_ toward the wrong origin, before the credential is on it.

**Pin the enforcement with tests that assert the act never happens.** Two `it.each`
cases in `apps/chat/src/lib/server/mastra-upstream.test.ts` feed an absolute path and a
scheme-relative path, assert the helper throws a `TypeError`, and assert
`fetchImpl` was never called — the "the bearer never egressed" contract, not just
"a throw occurred."

### Scope and limits of the pin

The origin pin is a real instance of the rule, but a **partial** one — and naming its
limits is what keeps the doc honest and the reader safe:

- **It closes one invariant, not the primary one.** The pin enforces
  _path-resolves-within-the-base-origin_. It does **not** enforce the base-SSRF
  invariant `hostAllowed` establishes (the `https:` floor with its loopback /
  `*.railway.internal` carve-outs, plus the optional host allowlist). A future caller
  that skips `hostAllowed` and passes a self-consistent but hostile base
  (`baseUrl: "http://evil.example"`, `path: "/x"`) is **not** caught by the pin: base
  origin `=== ` base origin, so the comparison passes vacuously and the bearer egresses
  in cleartext. For the _higher-consequence_ half, the exact comment-coupling this doc
  warns against is still in force.
- **Why the base guard stays at the call site — by design.** Two concrete reasons, not
  an oversight. (1) The act half can't re-run `hostAllowed`: `MastraUpstreamRequest`
  carries `baseUrl` but not the allowlist CSV, so the helper lacks an input the check
  needs. (2) A base rejection maps onto each proxy's _own_ deny wire (the seeker route
  surfaces `ssrf_blocked`; the history proxies surface their KTD8 status), and those
  deny ladders stay per-proxy by design — folding the guard's enforcement into the
  shared helper would either collapse that precise deny into the generic failure (as
  the origin pin's throw itself does) or leak per-proxy wire knowledge into shared code.
- **The fully-realized form of the rule is a type, not a throw.** To make the
  base-validation unskippable _without_ moving the per-proxy deny wire, mint a branded
  / opaque `ValidatedBaseUrl` from `hostAllowed`'s success path and require it as the
  helper's input. Then a caller that never validated the base cannot even _construct_
  the call — a compile error, not a runtime one — while the false path still returns
  the per-proxy `ssrf_blocked` / status at the call site. That is the type-level
  version of "make it unrepresentable" (see When to Apply); the runtime throw is the
  pragmatic subset feat-282 shipped.
- **The throw trades observability for simplicity.** Reusing the transient failure
  branch means a future caller's _permanent_ contract bug (an absolute `path`) surfaces
  to the user as a flaky, retryable `network_error` / `502` with no distinguishing
  signal — retried forever, never diagnosed. If you take this pattern, add a one-line
  plain-string diagnostic log at the throw (an enum reason, and **no path or URL
  bytes** — a future caller's path may be attacker- or mistake-influenced, and the
  repo's proxy-logging discipline forbids logging forwarded ids or body fragments) so
  the coding mistake is diagnosable rather than an infinite retry.

> **Shipped 2026-07-22 (feat-294).** The branded-type fix this section names as "the
> fully-realized form of the rule" has landed. `apps/chat/src/lib/server/mastra-upstream.ts`
> now exports a `ValidatedBaseUrl` brand minted only by `validateBaseUrl` (the
> `hostAllowed` success path — the lone `as ValidatedBaseUrl` cast lives there), and
> `MastraUpstreamRequest.baseUrl` demands it, so a caller that skips the base guard is a
> **compile error**, not a convention. What deliberately did **not** change, exactly as
> this section prescribes: the origin pin stays (it guards the independent
> path-escapes-the-base invariant); `hostAllowed` and its SSRF matrix are untouched; and
> the base-SSRF guard stays a per-proxy caller obligation — each proxy still maps
> `validateBaseUrl`'s `null` onto its OWN deny wire (seeker `ssrf_blocked` frame; history
> 502 `unavailable`), so no per-proxy deny knowledge moved into shared code. The first
> two "Scope and limits" bullets (the vacuous-base gap and why the guard stays at the
> call site) describe the pre-feat-294 runtime-throw subset and remain the historical
> record of why the type was needed.

**Alternatives considered.** Two designs remove the footgun differently. A single fused
`guardedPostMastraUpstream` (check + act in one export, unseparable) was not taken
because the SSRF-deny wire mapping is per-proxy by design and belongs at the call site,
not in shared code. Composing the URL at the boundary — the act half receives an
already-validated `URL` object rather than `path` + `base` — removes the
`new URL(path, base)` discard _by construction_ and is the cleanest option where the
callers can own composition; the branded-type approach above is its type-level cousin.
The act-half origin pin was preferred here as the minimal in-place fix that preserves
the existing `path`-string call shape and per-proxy deny ladders.

## Why This Matters

The danger of this class is that it is **invisible in green tests and invisible to
most reviewers**. Ten in-process `ce-code-review` reviewers (correctness, security,
and adversarial among them, all on Opus) plus the author all missed it on feat-282
PR 2; it was the **cross-model adversarial pass** — Codex, a different model family
running in a separate process — that flagged it (P2, confidence 75), and an
independent validator empirically confirmed the WHATWG `new URL` base-discard
behavior before the fix was applied. (Those attributions are process history from that
session, not codebase facts.) A single model family, however many parallel reviewers,
shares blind spots; a genuinely independent second family is what caught a latent
contract weakness that no test exercised.

The subtle part is attributing the _original_ safety correctly. It is tempting to say
"adjacency enforced the same-origin invariant and extraction lost it" — but that is
false, and getting it wrong mis-scopes the rule. The pre-extraction inline code
composed `new URL(path, base)` too; an absolute `path` would have escaped the base and
egressed the bearer _even inline_, with `hostAllowed(base)` sitting one line above. The
path-escape invariant was never enforced by adjacency — the guard checks the base, not
the path. What actually kept both the inline and extracted forms safe is that `path`
was a compile-time constant at a single, audited call site. Adjacency bought
**visibility** (local auditability), not enforcement. Extraction's real change is to
turn one audited call site into shared infrastructure that many future callers reuse
behind a comment, so a safety that was only ever _incidental_ (literal paths) can no
longer be assumed — and must become enforced in code. Read the rule as "**a
credential-attaching helper that composes a target from caller-supplied parts must
guarantee its own inputs**," triggered by that shape, not by "extraction removed a
guarantee."

## When to Apply

- Any refactor that splits a check-then-act pair into separately-importable units —
  especially when the act half attaches a credential, writes to a privileged
  resource, or performs an outbound call. Ask: _what did the adjacent guard let this
  half assume about its inputs, and does this half still guarantee it on its own?_
- Whenever the only thing coupling two extracted exports is a comment or a naming
  convention. Convert the coupling into something the act half enforces on its own
  inputs — a runtime check it performs, or (stronger) a type it demands — so a new
  caller cannot skip it.
- **Prefer type-level unrepresentability over a runtime throw where the invariant
  affords it.** A runtime throw (like the origin pin) is fail-closed but not
  unrepresentable — the caller can still _construct and pass_ the bad input; it just
  fails when the code runs. A branded/witness type the guard mints (a validated `URL`,
  a `ValidatedBaseUrl`) makes the unsafe call a **compile error** the caller cannot
  write. That compile error makes the unsafe call unrepresentable _by accident_, not
  absolutely — a deliberate `as`-cast outside the mint (or an `any`-typed value) still
  forges the brand, so the real guarantee is the maintained single-cast invariant
  (reviewable, greppable, and mechanizable with a lint ban forbidding the cast outside
  the minting module), not cryptographic tamper-proofness. Reach for the type first;
  fall back to the runtime throw as the pragmatic
  option when a call-shape or per-caller-outcome constraint rules the type out (as it
  did here), and say which one you took and why. Either way, the current callers being
  safe today is not the bar; the bar is a future caller who imports the helper and
  never reads the comment.

## Examples

**Before (inline — the check visibly guards the act, but only the _base_ is checked):**

```ts
// seeker route file, pre-extraction
if (!hostAllowed(baseUrl, allowedHosts)) return fail("ssrf_blocked")
const res = await fetch(new URL(path, baseUrl), {
  headers: { authorization: `Bearer ${apiKey}` }, // safe here ONLY because path is a literal
})
```

**After extraction, without the pin (the trap):** `hostAllowed(base)` and
`postMastraUpstream({ path, baseUrl: base, apiKey })` are two exports. A caller that
validates `base` but passes an absolute `path` sends the bearer to the host in `path`,
not `base` — `hostAllowed` verified a value the fetch helper discarded.

**After extraction, with the pin (the fix):** `postMastraUpstream` re-derives the base
origin and throws before the fetch when the composed URL's origin differs, so the only
paths that reach `fetchImpl` are ones that resolve within the validated origin — while
the base-SSRF guarantee still rides on the caller's `hostAllowed` call (see "Scope and
limits").

## Related

- `docs/solutions/architecture-patterns/browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md`
  — the worked instance's home. Its feat-282 PR 2 relocation note names this origin pin
  as one of the transport mechanics moved into `mastra-upstream.ts`; this doc is the
  generalized pattern behind that one line.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home for "a refactor relocates risk to the new seam" (see its feat-262
  liveness-watchdog row and the two feat-282 rows). That doc is about **test
  blindness** — coverage that a move silently drops. This doc is its runtime sibling:
  the **runtime contract** of the extracted helper. Cross-reference, not a merge —
  a refactor can relocate risk into _either_ the test suite (that doc) or the helper's
  own guarantees (this one), and the two need separate fixes.
- Genus siblings — other "the act half must carry its own guarantee" runtime laws:
  `docs/solutions/best-practices/client-mirror-server-dedupe-per-id-contract-20260506.md`
  (a client must mirror a server-side dedupe key, stated in both halves' comments) and
  `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`
  (an extracted downstream call must own a timeout budget smaller than its caller's).
