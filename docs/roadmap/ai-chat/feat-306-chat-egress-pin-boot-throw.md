---
id: "feat-306"
title: "Fail the deploy on a misconfigured Seeker egress pin"
owner: "jian wei"
priority: "P3"
status: "complete"
start_date: "2026-07-25"
duration: 1
depends_on:
  - "feat-305"
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-27 via [PR #1765](https://github.com/JesusFilm/forge/pull/1765)
(`feat(chat): fail the deploy on a misconfigured Seeker egress pin (feat-306)`)
and 2026-07-27 via [PR #PENDING-PR-B](https://github.com/JesusFilm/forge/pull/PENDING-PR-B)
(`docs(chat): arc-level fail-closed enforcement-point law, closing feat-304/305/306 (feat-306)`).

**What landed (PR 1).** `apps/chat/src/instrumentation.ts` flipped from
report-only to a throwing DEPLOY GATE: on a non-null `SeekerEgressProblem` in a
production build the hook logs the `[seeker-egress] event=misconfigured
reason=… effect=boot_refused_all_requests` enum line and then throws, so the
build fails its healthcheck and never promotes. The blanket `catch` became two
NARROW guards, which was the whole risk — a failed diagnostic
(`event=diagnostic_failed stage=import|call`) never throws and deliberately
fails OPEN, while the throw itself sits OUTSIDE both guarded regions so a
failing `requireSeekerEgressAllowlist()` read cannot discard an already-detected
problem down the fail-open path. The enforcing decision is SOURCED from that
policy function rather than an inlined `NODE_ENV` read, so a future policy change
cannot move the proxies and leave the gate behind. The request-path guard was
left completely alone: `hostAllowed`, `validateBaseUrl`, the `requireAllowlist`
third parameter, both config builders, and both proxies are untouched — the gate
is additive, and the proxies remain the actual security control. 645 tests
across 40 files, typecheck and lint green; the discriminating catch was
falsified before ship (a blanket `catch {}` turns the
misconfigured-production case red). The same PR swept the prose that asserted
the old posture — `apps/chat/CLAUDE.md`'s "Production egress pin" section, the
`instrumentation.ts` header, the `config/env.ts` JSDoc, and a dated note on the
SSE-proxy solutions doc — and added the arc's second worked instance to the
mocked-shape discipline doc.

**What landed (PR 2).** The arc-level solutions doc deliberately deferred
through feat-304 and feat-305:
[fail-closed-enforcement-point-follows-rollback-capability](../../solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md).
It carries the law (the enforcement point is a function of rollback capability,
not of threat severity — the SAME misconfiguration was correctly report-only in
feat-304 and correctly fatal in feat-306, with nothing about the threat or the
detecting code changed in between), the canonical boot-throw mechanism stamped
verified-by-hand, the `/api/health`-to-`prepare()` coupling and why both halves
are load-bearing and in tension, the production confirmation with its scope
caveats, and the scope limits and residual risks below. Three boundaries keep it
from being over-read: the law presumes a request-path control already contains
the residual risk (where nothing does, report-only is not an available answer),
the deploy gate is additive rather than a replacement, and a promotion gate
never licenses making the env var required. It also names `preDeployCommand` as
the deploy-failing alternative the arc did not take, and is honest that throwing
redistributes cost (cheaper on promotion, dearer on the un-probed restart path)
rather than removing it. Plus a root `CLAUDE.md` "Known Patterns" bullet
pointing at it, and this ticket's completion. No code changed in PR 2.

**Production verification.** The gating proof feat-305's Resolution named as
this ticket's job was run on the production chat service on 2026-07-27/28 by
temporarily setting `SEEKER_MASTRA_ALLOWED_HOSTS` to a non-matching value and
reverting. The hook threw at 21:18:34 UTC, the healthcheck started the same
second against `/api/health`, attempts #1–#6 through 21:19:05 all failed, and
the deployment ended at `1/1 replicas never became healthy!` with post-deploy
NOT STARTED — so the probe GATES promotion, it does not merely run. The build
itself still succeeded (Build OK at 8:49), confirming in production what had only
been shown locally: Next skips `register()` during `phase-production-build`, so
the boot gate never became a build gate. No observed user impact: 244
consecutive HTTP 200s from `https://chat.jesusfilm.ai/api/health` polled at a
~5s cadence from 21:09:35 to 21:31:02 UTC, with no non-200 in the failure window
(the poll sampled the health route only). On revert the healthcheck passed at
21:25:08 UTC and the deployment promoted with no gap in the poll record; a live
Seeker send and the history sidebar were then exercised end-to-end, confirming
the request-path pin genuinely restored rather than just a clean boot.
**Scope of that proof, stated honestly:** it establishes the PROMOTION gate
only, and nothing about the mechanism. Railway reports probe failures as
"service unavailable", which does not discriminate an HTTP 500 from a refused
connection — and chat's `restartPolicyType = "on_failure"` /
`restartPolicyMaxRetries = 3` means an exiting process would also produce
repeated boot-throw lines, so the log's shape does not discriminate either. The
listens-and-500s mechanism rests on the local `next@16.2.4` reproduction alone
(re-reproduced by hand 2026-07-27, which also observed two `Failed to prepare
server` lines from two requests against one still-running process). This is not
a Railway-confirmed 500.

**Compound docs.**
[fail-closed-enforcement-point-follows-rollback-capability](../../solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md)
(new, PR 2 — the arc law), and the "Empirical MECHANISM claim carried in prose,
with every test at a different layer" worked instance added to
[mocked-shape-vs-real-contract-discipline](../../solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
(PR 1 — a distinct, epistemic learning about the near-miss `dead port` claim;
the arc doc cross-links it rather than restating it).

**Residual risk / follow-ups.** (i) **No CI holds the HTTP-level 500.** Every
test that exercises the hook asserts on `register()`'s promise, while the gate's
arming depends on what the server answers over HTTP — a Next bump that changed
`prepare()`-rejection behavior would disarm the gate silently with the suite
green. The remedy is a `next build` + `next start` + `curl /api/health` smoke
(500 with the pin violated, 200 without); not ticketed. (ii) **The arming is a
property of the BUILD, not of the deployed environment's `NODE_ENV`** —
`next build` inlines `process.env.NODE_ENV` as the literal `"production"` and
`config/env.ts` reads it by direct member access, so
`requireSeekerEgressAllowlist()` compiles to a constant-true comparison. Both
layers are therefore armed in every production build (every deployed
environment, and a local `next build` + `next start`); an operator **cannot**
opt an environment into report-only by setting `NODE_ENV=staging`. Verified by
hand 2026-07-27 while writing PR 2: a `NODE_ENV=staging` build still emitted
`NODE_ENV: …("production")` into the server chunk, and the resulting server
500ed `/api/health` with the pin violated. The consequences that matter are that
there is **no staged rollout** — the allowlist must be provisioned in an
environment BEFORE the code lands there — and that a local production build
inherits full enforcement. **The inverted version of this claim — that a
`staging`/`prod` value disarms both layers — shipped in PR 1 in
`apps/chat/CLAUDE.md`'s "Production egress pin" section, and is CORRECTED in
PR 2, so `main` never carries the contradiction between that section and the new
arc doc.** Two
cases are outside the gate's coverage: an already-promoted deployment restarting
into the same throw (not re-probed; the process never exits so
`restartPolicyType` does not fire, and recovery is to revert the variable rather
than the deployment) and a first deploy in a fresh environment with no previous
deployment to fall back on. The whole net also depends on the service's
per-environment "Config-as-code Path" pointing at `apps/chat/railway.toml` —
unwired, there is no probe and the broken build promotes. Separately,
`apps/admin` still carries the same inert fail-open shape
(`MASTRA_CHAT_ALLOWED_HOSTS`, `.optional()`, no default) guarding egress of
`MASTRA_CHAT_API_KEY`; the feat-304 request-path pin applies directly, but the
feat-306 gate does **not** clear on inspection — admin's Config-as-code Path is
unconfirmed, its `preDeployCommand` migration means a refused promotion leaves
old code against a new schema, and the guarded relay is off by default
(`EXPERIENCE_AI_REMOTE_CHAT`). It still has no ticket.

**Unblocked.** None.

## Problem

feat-304 pinned chat's outbound Mastra host behind
`SEEKER_MASTRA_ALLOWED_HOSTS` and made an unset allowlist DENY in any production
build. Enforcement lives at the two proxies; `apps/chat/src/instrumentation.ts`
only **reports** a misconfiguration as a log line.

That reporting choice was forced: at the time, chat had no Railway healthcheck,
so a throwing `register()` — which rejects Next's `prepare()` and therefore
every request, with the rejection cached — would have been an unrecoverable
outage of surfaces that do not even use Mastra (anonymous stub chat, the page,
auth). Report-only kept the blast radius to the Seeker surface.

feat-305 added the healthcheck, which changes the calculus. With a healthcheck
gating promotion, a throw is no longer an outage — it is a **failed deploy**:
the misconfigured build never promotes, the previous working deployment keeps
serving, and the operator gets an unmissable signal instead of a log line
nobody reads.

Today's residual gap: a deploy that lands with the pin violated **succeeds**,
then silently breaks every Seeker send (`ssrf_blocked`) and the whole feat-241
history sidebar (502 `unavailable`) for real users until someone notices. This
ticket closes that by moving the failure to the deploy boundary.

## Entry Points — Read These First

1. `apps/chat/src/instrumentation.ts` — the hook to change. Note its current
   header explains the report-only rationale; that rationale is what this
   ticket supersedes.
2. `apps/chat/src/instrumentation.test.ts` — existing coverage, including the
   never-throw cases that this ticket deliberately inverts for one branch and
   preserves for the other.
3. `apps/chat/src/config/env.ts` — `describeSeekerEgressMisconfiguration()`
   returns the `SeekerEgressProblem` enum (`allowlist_unset | host_not_allowed`)
   or `null`. Unchanged by this ticket; it becomes the throw's condition rather
   than the log's.
4. `apps/chat/railway.toml` — confirm `healthcheckPath` is present (feat-305).
   **If it is absent, stop: the precondition for this ticket is not met.**
5. `apps/mastra/src/config/env.ts` — the sibling boot-throw guards
   (`JESUSFILM_RAG_ALLOWED_HOSTS`, `LANGFUSE_ALLOWED_HOSTS`). After this ticket
   chat converges on that pattern; read them for message shape and phrasing.

## Grep These

```bash
grep -rn "healthcheck" apps/chat/railway.toml          # precondition check
grep -rn "diagnostic_failed\|seeker-egress" apps/chat/src
grep -rn "never throw\|report-only\|only REPORTS" apps/chat/src apps/chat/CLAUDE.md
grep -rn "ALLOWED_HOSTS" apps/mastra/src/config/env.ts  # the pattern being joined
```

## What To Build

**1. Throw on a genuine misconfiguration.** When
`describeSeekerEgressMisconfiguration()` returns a non-null
`SeekerEgressProblem`, `register()` throws with a plain-string message naming
the var and the reason — so the deploy fails its healthcheck and never
promotes. Keep the existing `[seeker-egress] event=misconfigured reason=…` log
line **before** the throw: Next wraps the error, and the raw enum line is what
an operator greps for.

**2. Make the `try/catch` discriminating — this is the subtle part.** The
current blanket `catch` exists so a broken _diagnostic_ cannot take down the
server. A blanket catch now also swallows the intentional throw, defeating the
gate. The two cases must be separated:

- **The config is genuinely wrong** (a `SeekerEgressProblem` was returned) →
  THROW. This is the deploy gate.
- **The diagnostic machinery itself failed** (the dynamic `import` rejected, or
  `describeSeekerEgressMisconfiguration()` threw) → log
  `[seeker-egress] event=diagnostic_failed` and return normally. An unknown
  failure in a diagnostic is not evidence of a misconfiguration, and failing
  the deploy on it would be a self-inflicted outage.

The mechanical trap: a `throw` inside a `try` is caught by that `try`'s own
`catch`. Compute the problem inside the guarded region, then throw **outside**
it (or rethrow a sentinel the catch re-raises). Do not rely on error-message
matching to tell the two apart.

**3. Update the prose that describes the old posture.** At minimum
`apps/chat/src/instrumentation.ts`'s header and `apps/chat/CLAUDE.md`'s
"Production egress pin" section — both currently state the hook never throws
and explain why. Also revisit feat-304's `## Constraints` (`Do NOT throw from
register()`), which already anticipates this ticket as the condition under which
that constraint lifts.

**4. Leave the request-path guard completely alone.** `hostAllowed`,
`validateBaseUrl`, the `requireAllowlist` third parameter, both config builders,
and the wiring pins in `apps/chat/src/config/egress-pin-wiring.test.ts` are the
actual security control — what stands between the bearer and the wire at the
moment of egress. A boot check runs once at startup and cannot replace it. This
ticket adds a deploy gate on top; it removes nothing.

## Constraints

- **Precondition: `healthcheckPath` must be live in `apps/chat/railway.toml`
  AND its probe observed RUNNING against a real feat-305 deploy** (confirmable
  from the Railway build log). That the probe GATES — blocks promotion of a
  BROKEN deployment — cannot be observed before this ticket: under the
  report-only hook a misconfig leaves `/api/health` at 200, so nothing ever
  fails the probe. Gating is proven by the production env-var experiment AFTER
  this lands, not before it. A throwing `register()` behind an entirely absent
  or inert healthcheck would be the unrecoverable outage feat-304 avoided; a
  probe observed running is the precondition that closes that risk.
  **Observation of record:** the operator confirmed from a real feat-305 chat
  deploy's Railway build log that the healthcheck probe ran against
  `/api/health` and passed. Re-confirm the deployment record's `configFile`
  field reads `apps/chat/railway.toml` per environment before merging this
  ticket's code — an unwired "Config-as-code Path" means no probe at all.
- **Do not throw for a failed diagnostic.** Only a returned
  `SeekerEgressProblem` may fail the deploy.
- **Do not throw outside a production build.** `next dev` and the test runner
  keep today's behavior. Note `requireSeekerEgressAllowlist()` does NOT fully
  encode this on its own: only the `allowlist_unset` branch is production-only,
  while `host_not_allowed` fires in any environment (a set-but-mismatched
  allowlist — the documented local-dogfood footgun, or a malformed base URL).
  So the THROW must be gated on `requireSeekerEgressAllowlist()` explicitly;
  that is the same policy function, not a second environment check.
- **Do not log the caught error object** in the `diagnostic_failed` path — it
  can carry a module path or env-shaped fragment (the KTD7 no-PII rule).
- No change to the proxies, the guard, or the deny wires.

## Verification

```bash
pnpm --filter @forge/chat test
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat lint

# The BUILD must still succeed with the pin violated — Next skips register()
# during phase-production-build. This must not regress.
SEEKER_MASTRA_BASE_URL=https://mastra.internal pnpm --filter @forge/chat build

# The SERVER must now fail every request with the pin violated (the new
# behavior). NOT a dead port: `register()` throwing rejects Next's prepare()
# process-wide, so the server still LISTENS and stays up, re-throwing the hook
# once per request and answering 500 on EVERY route — /api/health included.
# That 500 (not a refused connection) is exactly what makes Railway's probe
# fail and the deployment never promote.
SEEKER_MASTRA_BASE_URL=https://mastra.internal pnpm --filter @forge/chat start &
#   expect in the log: [seeker-egress] event=misconfigured reason=allowlist_unset
#   effect=boot_refused_all_requests, then "Failed to prepare server"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3200/api/health   # expect: 500
curl -s -o /dev/null -w '%{http_code}\n' localhost:3200/             # expect: 500
pgrep -f 'next start' # expect: still alive — the process does NOT exit

# And must start cleanly once the pin is correct
SEEKER_MASTRA_BASE_URL=https://mastra.internal \
SEEKER_MASTRA_ALLOWED_HOSTS=mastra.internal pnpm --filter @forge/chat start &
curl -si localhost:3200/api/health | head -1        # expect: HTTP/1.1 200 OK
```

Tests must cover **both** sides of the discrimination, since collapsing them is
the whole risk:

- misconfigured production → `register()` REJECTS (inverting the existing
  never-throw case for this branch only);
- rejecting dynamic import → still RESOLVES, logs
  `diagnostic_failed stage=import`;
- throwing `describeSeekerEgressMisconfiguration()` → still RESOLVES, logs
  `diagnostic_failed stage=call`, and NEVER the caught error (sentinel test);
- throwing `requireSeekerEgressAllowlist()` with a problem already detected →
  still REJECTS (a failing policy read must not discard a known misconfiguration
  into the fail-open path);
- sound config → resolves silently;
- production with NO base URL (the boots-clean default deploy) → resolves
  silently — this is the guard whose regression would brick every unprovisioned
  environment;
- malformed base URL in production → REJECTS with `host_not_allowed` (the URL
  parse returns false, it does not throw — so it must not read as a diagnostic
  failure);
- non-production, nothing to report → resolves silently;
- non-production with the pin violated (`host_not_allowed`) → resolves and logs
  report-only (`effect=seeker_sends_and_history_refuse`), never throws;
- the enforcing decision is SOURCED from `requireSeekerEgressAllowlist()`, not
  an inlined `NODE_ENV` read — pinned by a mocked-policy pair (policy false under
  production NODE_ENV → no throw; policy true under development NODE_ENV →
  throw), so a future policy change cannot move the proxies and leave the deploy
  gate behind;
- `src/instrumentation.ts` still sits at a path Next recognizes as the hook —
  Next silently no-ops a MISSING hook, so a move or rename would disarm the gate
  in production while every other test stayed green.

**Falsify before shipping.** Replace the discriminating catch with a blanket
`catch {}` and confirm the misconfigured-production test goes red — that is the
one regression that would silently restore report-only behavior while looking
correct. Restore from a scratchpad copy verified by `sha256sum`, never
`git checkout` (the tree is uncommitted; git restores to HEAD and would wipe
the working change).

**Deploy note.** Once this ships, an environment missing
`SEEKER_MASTRA_ALLOWED_HOSTS` can no longer deploy chat at all. Confirm the var
is set in every environment that runs a production build — not only the one
named "production" — before merge.
