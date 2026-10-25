---
title: WAF passthrough verification via prior art, not fresh probes
date: 2026-05-18
problem_type: best_practice
category: best-practices
component: development_workflow
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: low
tags:
  - cloudflare
  - waf
  - verification
  - debugging
  - shortcut
  - empirical
related:
  - docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md
  - docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md
---

# WAF passthrough verification via prior art, not fresh probes

## Problem

When adding a new authenticated endpoint behind Cloudflare's WAF
(or any edge proxy), an obvious gate is: "verify Cloudflare doesn't
strip the `Authorization` header before requests reach the origin".
The naïve verification approach is to set up a fresh probe — generate
a test bearer, deploy it to a staging env, curl from outside, tail
edge logs, confirm passthrough.

But sometimes the tools needed for that probe aren't accessible:

- The origin's log pipeline is filtering out the diagnostic signal
  (see `railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`).
- The staging env isn't wired up.
- The Cloudflare API access required to inspect WAF rules isn't
  available to the engineer.

You can spend hours setting up the probe. Or you can answer the
question via prior art in ~5 minutes.

## Symptoms

- Curl probes return 200 OK with real data, but you can't tell from
  the HTTP response alone whether the `Authorization` header reached
  the origin or was stripped at the edge (because the endpoint
  accepts both authed and anonymous in dual-accept mode).
- The discriminating signal lives in origin logs, and origin logs
  aren't accessible / aren't surfacing the relevant events.
- Time spent debugging the log pipeline starts to exceed the
  expected duration of the underlying verification.

## What didn't work

- **Fresh curl probes against the new endpoint.** Returned 200 OK
  but didn't discriminate header-arrived from header-stripped
  because the endpoint accepted both states (dual-accept mode).
- **Inspecting Railway's deploymentLogs query with various filters.**
  Boot-time stdout logs surfaced; runtime stdout from the route
  handler did NOT surface (separate root-cause documented in
  `railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`).
- **HttpLogs query.** Showed the GraphQL POST but not the REST GET
  for the same probe burst — Railway's edge log appears to filter
  GETs differently.

## Solution

**Ask: "is something with the same structural shape ALREADY working
in production?"**

If a different endpoint on the same domain has been authenticating
with `Authorization: Bearer ...` headers for weeks and observably
working, then Cloudflare passes that header through. The new
endpoint inherits the same passthrough by structural identity — same
domain, same path prefix (`/api/*`), same header name.

### Concrete shape

For the search-api-auth verification at admin.jesusfilm.org:

| Surface                                             | Header carried                                                                            | Observable behavior                                                                                                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **apps/web SSR → admin /api/graphql**               | `Authorization: Bearer <WEB_ADMIN_API_KEYS[0]>` (consumer-bearer for rate-limit identity) | Has been working since Plan 003 (~2026-05-13, ~3 weeks). Admin logs show `consumer:<bucketKey>` rate-limit identity firing — proves bearer is reaching admin's createContext.                                                               |
| **manager → admin /api/graphql (workflow trigger)** | `Authorization: Bearer <WORKFLOW_API_KEYS value>`                                         | Has been working since Plan 006 (~2026-04-29, ~6 weeks). `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` mutations firing successfully — admin's `isValidWorkflowBearer` requires the header to reach createContext. |

**Both surfaces use the same Cloudflare proxy, same domain
(`admin.jesusfilm.org`), same path prefix (`/api/*`), same header
name (`Authorization`).** The new search surface inherits identical
passthrough by structural identity.

**Verdict: WAF passes `Authorization` through to admin.jesusfilm.org/api/\*.
No fresh probe needed.**

## Why this works

The proof structure is:

1. Cloudflare's "strip Authorization" rule (if it existed) would be
   keyed on the **request URL pattern**, not on the endpoint's
   internal handler logic.
2. If the rule existed, EVERY request to that URL pattern would
   lose the header.
3. If even ONE existing surface in the URL pattern is observably
   using `Authorization` in production, the rule doesn't exist for
   that pattern.
4. Any new endpoint added under the same URL pattern inherits the
   same passthrough.

The shortcut requires:

- **Same URL prefix** as the production surface (e.g.,
  `admin.jesusfilm.org/api/*` covers both `/api/graphql` and
  `/api/search`).
- **Same proxy stack** (Cloudflare config is keyed at the hostname/
  path level, not per-endpoint).
- **Observable success of the existing surface** (not just "it
  exists" — must have empirical evidence it's working).

## Prevention / How to apply

**The general principle:** before setting up a fresh diagnostic
probe to verify infrastructure behavior, ask "is something with the
same shape already running successfully in production?" If yes,
you've got an existing empirical signal that may answer the question
without new instrumentation.

**Other places this shortcut applies:**

| Verification question                                          | Possible prior-art signal                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| Does Cloudflare strip / modify header X on path Y?             | Any existing endpoint on path Y that depends on X.         |
| Does the WAF rate-limit aggressively at burst N?               | Any existing endpoint that sustainably serves bursts at N. |
| Does the egress network reach external service Z?              | Any existing job that posts to Z and observably completes. |
| Does the env-var pipeline deliver UTF-8 / non-ASCII correctly? | Any existing env-var consumer that exercises that range.   |
| Does the DB driver handle vector(N) parameter binding?         | Any existing migration / write path that does the same.    |

**When the shortcut doesn't apply:**

- The new surface differs from prior-art in a load-bearing way
  (different path prefix, different transport, different header
  semantics). Then you need the fresh probe.
- The prior-art evidence is weak (the existing surface exists but
  you can't confirm it's actually exercising the behavior you're
  asking about). Then the shortcut becomes guesswork.
- The cost of being wrong is high (auth flip on a critical path
  where 401-cascade would page the team). Then a fresh probe is
  worth the time even if prior art suggests passthrough.

**How to make this shortcut available to your future self:**

1. **Document working production patterns** that depend on
   non-obvious infrastructure behavior. The next person verifying
   "does Cloudflare strip Authorization?" can grep your docs for
   "Authorization" to find prior art.
2. **Be explicit about the observable success signal.** "apps/web
   uses consumer-bearer" is weaker than "apps/web's consumer-bearer
   has been routing through Cloudflare → Railway since 2026-05-13
   and admin logs show `consumer:<bucketKey>` rate-limit identity
   firing — the header demonstrably arrives."
3. **Cite the prior-art in plan / brainstorm docs** for any new
   work that asks the same infrastructure question. Saves the next
   person from re-deriving it.

## Cross-references

- **Companion learning (the bug that forced this shortcut):**
  `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`
  — explains why fresh probes couldn't be verified via origin logs,
  forcing the shift to prior-art reasoning.
- **The auth surface this verified:**
  `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
- **Existing prior-art surfaces cited as evidence:**
  - `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`
    (apps/web SSR's consumer-bearer)
  - `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
    (manager → admin workflow-trigger pattern)
- **Plan:** `docs/plans/2026-05-17-002-feat-search-api-auth-plan.md`
  (Unit 5 — Cloudflare WAF passthrough verification).
- **PRs:** #968 (Phase 1 admin code), #970 (observability fix).
