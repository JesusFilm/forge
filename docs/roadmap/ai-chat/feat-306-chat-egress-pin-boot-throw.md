---
id: "feat-306"
title: "Fail the deploy on a misconfigured Seeker egress pin"
owner: "jian wei"
priority: "P3"
status: "in-progress"
start_date: "2026-07-25"
duration: 1
depends_on:
  - "feat-305"
blocks: []
tags:
  - "web"
  - "infrastructure"
---

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
