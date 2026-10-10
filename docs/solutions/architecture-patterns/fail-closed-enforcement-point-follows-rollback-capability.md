---
title: "Your fail-closed enforcement point is a function of your rollback capability — report-only without a deploy gate, boot-throw with one"
date: "2026-07-27"
category: "architecture-patterns"
module: "apps/chat (src/instrumentation.ts, src/app/api/health/route.ts, railway.toml, src/config/env.ts) — the feat-304 → feat-305 → feat-306 Seeker egress-pin arc"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
related_components:
  - "apps/chat/src/instrumentation.ts"
  - "apps/chat/src/app/api/health/route.ts"
  - "apps/chat/railway.toml"
  - "apps/chat/src/config/env.ts"
  - "apps/chat/src/lib/server/mastra-upstream.ts"
  - "apps/mastra/src/config/env.ts"
applies_when:
  - "Choosing whether a detected misconfiguration should throw at boot, fail the deploy, or only report — and the same threat could justify any of the three"
  - "A boot-time throw would take down surfaces that do not depend on the misconfigured thing (a stub path, a static page, auth)"
  - "The service has no healthcheck, no staging environment, and no automatic rollback, so a bad boot promotes and stays promoted"
  - "A healthcheck or promotion gate is added later and an earlier report-only enforcement decision becomes re-litigable"
  - "A Next.js instrumentation register() hook is the candidate enforcement point for env, egress, or startup validation"
tags:
  - "fail-closed"
  - "deploy-gate"
  - "healthcheck"
  - "railway"
  - "nextjs"
  - "instrumentation"
  - "egress-pin"
  - "rollback"
---

# Your fail-closed enforcement point is a function of your rollback capability

## Context

`apps/chat` egresses the `AI_CHAT_MASTRA_API_KEY` lane bearer — plus the user's
prompt text — to whatever host `SEEKER_MASTRA_BASE_URL` names. The control that
pins that host is the `SEEKER_MASTRA_ALLOWED_HOSTS` CSV allowlist.

Three tickets in a row touched that one control, and the interesting thing is
what they disagreed about:

| Ticket                                                                              | Shipped    | What it did                                                             | The boot hook's reaction to a violated pin |
| ----------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| [feat-304](../../roadmap/ai-chat/feat-304-chat-production-egress-pin.md) (PR #1731) | 2026-07-24 | Made the allowlist load-bearing: unset **denies** in a production build | **Report only** — a log line               |
| [feat-305](../../roadmap/ai-chat/feat-305-chat-healthcheck.md) (PR #1762)           | 2026-07-27 | Added `healthcheckPath = "/api/health"` to `apps/chat/railway.toml`     | Unchanged (comment-only diff)              |
| [feat-306](../../roadmap/ai-chat/feat-306-chat-egress-pin-boot-throw.md) (PR #1765) | 2026-07-27 | Flipped the hook to a **deploy gate**                                   | **Throws**                                 |

Between feat-304 and feat-306 the threat did not change. Neither did the code
that detects it: `SEEKER_MASTRA_ALLOWED_HOSTS`, `requireSeekerEgressAllowlist()`,
and `describeSeekerEgressMisconfiguration()` are the same across both, and
feat-306 touched neither the guard (`hostAllowed` / `validateBaseUrl` in
`apps/chat/src/lib/server/mastra-upstream.ts`) nor either proxy. The only thing
that moved is what `register()` does with the answer.

What made the same detection correctly report-only in one ticket and correctly
fatal in the next was a single line of platform config.

## The law

**Your fail-closed enforcement point is a function of your rollback capability,
not of how bad the misconfiguration is.**

Before choosing where a detected misconfiguration fails — a log line, a boot
throw, a failed deploy — ask what the platform will do with a bad boot. That
answer, not the severity of the threat, decides the enforcement point.

- **No promotion gate → report only.** With nothing to catch a bad boot, a
  throw converts a narrow, partial failure into a total outage with manual
  recovery — and it takes down surfaces that have nothing to do with the
  misconfiguration. In feat-304 that was chat's anonymous stub path, the page
  itself, and auth: none of them call Mastra, all of them would have gone down
  over a Seeker-only misconfiguration. Report-only kept the blast radius to the
  surface actually at risk, where the request-path guard already denies exactly
  the calls that would carry the bearer (`ssrf_blocked` frame / history 502).
- **A promotion gate exists → fail the deploy.** Once a healthcheck decides
  whether a build is promoted, the same throw is no longer an outage on that
  path. It is a failed deploy: the misconfigured build never promotes and the
  previous healthy deployment keeps serving.

Be honest about what that second bullet buys, because the cost does not vanish —
it **redistributes**. Throwing gets cheap on the _promotion_ path and gets
_more_ expensive on the un-probed _restart_ path: an already-promoted deployment
restarting into the same throw serves 500s until an operator intervenes, a
failure mode report-only never had. The arc judged that net-positive for chat
because restart-into-throw follows an operator's own service-variable edit, so
it is attributable and the recovery (revert the variable) is known. So the
decision rule needs one more input: **which of the two bad-boot paths dominates
for this service** — a service whose bad boots mostly come from restarts rather
than promotions inherits the new outage without the benefit.

Four corollaries, all earned in this arc:

1. **"Fail fast at boot" is not universally correct.** It is correct for a
   service that can catch a bad boot. `apps/mastra` throws at boot for its own
   egress host allowlists (`JESUSFILM_RAG_ALLOWED_HOSTS`,
   `LANGFUSE_ALLOWED_HOSTS` in `apps/mastra/src/config/env.ts`) — the same
   enforcement chat took three tickets to reach — and its `railway.toml` already
   carries a `healthcheckPath`. Chat looked like an inconsistency next to it; it
   was not. It was the same rule applied to a service with a different
   capability. Copying the sibling's posture without copying its healthcheck
   would have been the bug.
2. **Read the platform config before choosing the enforcement point.** In this
   arc the deciding fact was the presence or absence of one line in
   `apps/chat/railway.toml`. feat-304's ticket made "confirm for yourself there
   is **no** `healthcheckPath`" a numbered Entry Point, precisely because the
   decision hinged on it.
3. **If the capability is missing and you want the boot check, sequence it: add
   the capability, observe it working, then move the enforcement point.**
   feat-305 exists as its own ticket between the two for that reason, and
   feat-306's Constraints made "the probe observed running against a real
   feat-305 deploy" a hard precondition rather than an assumption.
4. **Report-only is a correct enforcement point, not an apology — but it must be
   ticketed forward or it becomes permanent by default.** feat-304's Resolution
   named its own upgrade path (feat-305, then feat-306, in that order) and
   deferred this doc until the arc could actually be written. The failure mode
   to avoid is a report-only guard whose rationale ("we have no healthcheck")
   quietly stops being true and nobody revisits it.

Three boundaries keep the law from being read too widely:

- **The law presumes the residual risk is already contained.** Report-only was
  cheap in feat-304 only because the request-path guard already denied exactly
  the calls that would carry the bearer — the misconfiguration could not reach
  the wire while the boot check merely logged. Where a misconfiguration has
  **no** such containment (an unset signing secret, a disabled authorization
  check, a build pointed at the wrong database), report-only is not an available
  answer, because the service would serve in an unsafe state rather than a
  degraded one. There the correct move is to acquire the rollback capability
  before shipping the feature at all — not to pick the cheaper enforcement
  point. The headline disclaims _severity_ as the input; it does not license
  shipping an uncontained failure.

- **The deploy gate is additive, never a replacement.** Request-path enforcement
  at the proxies is what stands between the bearer and the wire at the moment of
  egress. A boot check runs once at startup and cannot do that job. feat-306
  removed nothing.
- **"You may now fail the deploy" is not "you may now require the var."** Having
  a promotion gate does not license moving the enforcement into the zod schema.
  `SEEKER_MASTRA_ALLOWED_HOSTS` stayed `.optional()` through all three tickets,
  because a required-at-schema-load var bricks every environment that has not
  been provisioned yet — including ones whose code path never reads it (see
  [required-env-var-without-default-broke-railway-deploy](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md)).
  The enforcement point moved from a log line to a throw; it never moved into
  the schema, and the two laws only look like they collide.

One alternative worth naming, because this arc did not take it: **a throwing
`register()` is not the only way to fail a deploy.** Railway's
`preDeployCommand` fails a deployment on a non-zero exit — `apps/admin` already
uses it for `db:migrate:deploy` — and it does so without ever putting a
500-serving process in front of the probe, which sidesteps both the un-probed
restart outage and residual risk (i) (an exit code is trivially assertable in
CI; the HTTP-level 500 is not). The arc chose the `register()` throw because the
policy already lives in `apps/chat/src/config/env.ts` and a shell step would duplicate it, so
the two would drift. That is a real reason, but it is a trade — if you are
applying this law to a service where the policy is cheap to evaluate
out-of-process, the pre-deploy hook is the smaller-surface enforcement point.

## The mechanism: what a throwing `register()` actually does

This is the empirical claim the law's cost model rests on, so it is stated
exactly once, here, in the form that was verified:

- A throwing `register()` **rejects Next's `prepare()` process-wide.**
- The server **keeps listening** and returns **HTTP 500 on every route,
  `/api/health` included**, staying alive and **re-throwing once per request**.
- It is **not** a dead port and **not** a refused connection.
- feat-305's `healthcheckPath = "/api/health"` turns that 500 into a **failed
  deploy**: the probe gets non-2xx, so the build is never promoted and the
  previous deployment keeps serving.
- The gate covers **promotion only.** An already-promoted deployment restarting
  into the same throw is not re-probed, and rollback does not undo a
  service-variable edit.
- Outside a production build the hook stays **report-only**.

In every build, production included, the **request-path proxies are the actual
security control** — the boot check runs once at startup and never sees a
request.

Stamped **verified by hand** on `next@16.2.4`, non-standalone output, via
`next build` then `next start` with the pin violated (`curl` `/api/health` →
500, `pgrep` still finds the process). Independently re-reproduced 2026-07-27
while writing this doc, which also observed the per-request re-throw directly:
two `curl`s produced two `Failed to prepare server` lines from one still-running
process. **No CI assertion holds any of it** — see residual risk (i) below.
Re-verify on a Next major/minor bump, or if chat ever adopts
`output: "standalone"`.

An earlier in-session claim said the opposite — that the throw leaves a **dead
port** that never listens — and was wrong; an independent reproduction caught it
pre-merge. The near-miss and its lesson (a prose-carried mechanism claim whose
tests all sat at a different layer) are a distinct learning, documented as the
last worked instance in
[mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md).
Read it there; it is not restated here.

What matters for **this** law is narrower, and it is the reason the mechanism
belongs in this doc at all. The gate would have armed under either model — a
refused connection is non-2xx too — so the wrong claim never threatened the
healthcheck. What it did threaten is the **cost estimate on the un-rolled-back
side**, which is exactly this law's input: because the process keeps listening
and never exits, `restartPolicyType` (which only fires on a process that
_exits_) does not fire, and an already-promoted deployment in that state serves
500s to real users until an operator reverts the variable. A dead-port model
would have made that case look self-recovering, and a self-recovering worst case
would have argued for throwing much earlier in the arc than the platform could
actually support.

## The health route is coupled to `prepare()` — deliberately, in both directions

`apps/chat/src/app/api/health/route.ts` is the probe target, and it carries two
properties that are in tension. Both are load-bearing; its own file comment
records the coupling.

- **It must import nothing.** No env read, no Mastra call, no session decode, no
  gate resolution. That is what keeps a Mastra outage from becoming a chat
  rollback, and what lets chat's default-off boot (no Seeker config at all)
  answer 200.
- **It must not be insulated from a process-wide boot failure.** The probe gates
  feat-306 only because it shares `prepare()`'s fate. `/api/health` returns 500
  under a thrown `register()` because the process failed, not because of
  anything in the handler.

The trap is that the first property invites a "simplification" that breaks the
second. Serving `/api/health` from a sidecar, a separate process, or anything
else that outlives a failed `prepare()` would make it answer 200 while the app
is broken — silently disarming the deploy gate while every test stays green.
Shallow, but _in-process_: those are not the same requirement, and only one of
them is obvious from reading the route.

## Production confirmation

The operator ran the experiment on the production chat service on 2026-07-27/28
(Railway logs are NZST/UTC+12; UTC below), by temporarily setting
`SEEKER_MASTRA_ALLOWED_HOSTS` to a non-matching value, observing the resulting
deployment, and reverting.

Deliberately misconfiguring production is safe **only** under preconditions this
run happened to satisfy, so check them before repeating it on another service:
the change can affect a _promotion_ and nothing already serving; an independent
external poll of the public health URL runs across the whole window; and the
revert is a single variable edit needing no redeploy. A service where the same
misconfiguration can reach an already-promoted process — the uncovered case
below — fails the first precondition, and needs a non-production rehearsal
instead.

**Promotion refused.** At 21:18:34 UTC the instrumentation hook threw and the
deploy log carried it verbatim:

    Failed to prepare server Error: An error occurred while loading instrumentation hook: SEEKER_MASTRA_BASE_URL must use a host listed in SEEKER_MASTRA_ALLOWED_HOSTS for chat production (reason=host_not_allowed)

The healthcheck started the same second against `/api/health` with a 1m0s retry
window. Attempts #1–#6, from 21:18:34 to 21:19:05, all "failed with service
unavailable", ending in `1/1 replicas never became healthy!`. The pipeline read
Initialization OK / Build OK (8:49) / Deploy OK (0:33) / **Network > Healthcheck
FAILED** (0:31) / **Post-deploy NOT STARTED**, surfaced by Railway as
"Deployment failed during the network process".

Two things this establishes beyond what feat-305 could show:

- **The probe gates, it does not merely run.** Post-deploy never started; the
  pipeline halted at the healthcheck and the build was never promoted. Under the
  report-only hook this was unobservable — a misconfiguration left `/api/health`
  at 200, so nothing ever failed the probe.
- **The build still succeeds with the pin violated** (Build OK at 8:49),
  confirming in production what had only been shown locally: Next skips
  `register()` during `phase-production-build`, so the boot gate never became a
  build gate.

**No observed user impact.** 244 consecutive HTTP 200s from
`https://chat.jesusfilm.ai/api/health`, polled at a ~5-second cadence from
21:09:35 to 21:31:02 UTC — zero non-200 responses across the entire window,
including every sample inside the 21:18:34–21:19:05 failure window (21:18:34,
:40, :45, :50, :56, 21:19:01, :06 all 200). The previous deployment kept serving
throughout. Scope it precisely: the poll sampled `/api/health` only, so this is
evidence the serving deployment stayed up, not a measurement of page loads or
Seeker sends during the window.

**Clean recovery.** The variable was reverted; the healthcheck passed at
21:25:08 UTC and the deployment promoted, with no gap in the poll record. The
operator then exercised a live Seeker send and the history sidebar end-to-end
about a minute later — both worked, confirming the request-path pin at the
proxies is genuinely restored, not merely that the process booted.

### Scope of the proof

State this honestly; do not let the doc drift into claiming more than the logs
say.

- **This proves the promotion gate, and nothing about the mechanism.** Railway
  reports probe failures as "service unavailable", which does **not** by itself
  discriminate an HTTP 500 from a refused connection. Nor does anything else in
  the run: chat's `railway.toml` sets `restartPolicyType = "on_failure"` with
  `restartPolicyMaxRetries = 3`, so a process that _exited_ would also produce
  repeated boot-throw lines in the deploy log — the log's shape cannot separate
  a listening-and-re-throwing server from a dying-and-restarting one either.
  The listens-and-500s mechanism therefore rests on the **local reproduction
  alone**; the production run establishes that the deployment was refused, not
  which non-2xx condition refused it. **Do not write "Railway confirmed a
  500"** — the logs do not say that, and claiming a mechanism from
  non-discriminating evidence is precisely the failure the cross-linked
  prose-claim learning documents.
- **Only one branch of the law has production evidence.** The experiment
  exercised the throw-with-a-gate half. The report-only half was never tested in
  production — no bad-allowlist boot occurred under feat-304 — so "no promotion
  gate → report only" rests on reasoning about blast radius, not on an observed
  incident.
- **Two cases remain unexercised** and are not covered by this gate: an
  already-promoted deployment restarting into the same throw (not re-probed;
  recovery is to revert the variable, not the deployment), and a first deploy in
  a fresh environment with no previous deployment to fall back on.

## Scope limits and residual risks

**Scope limit — the gate covers promotion only,** with the two uncovered cases
named directly above. And the whole net depends on Railway's **per-environment
"Config-as-code Path"** actually pointing at `apps/chat/railway.toml`: unwired,
the file is silently ignored, there is no probe, and the broken build promotes.
`apps/chat/railway.toml`'s own header warning says so, and
`apps/admin/railway.toml` is the cautionary example it points at. Confirm it the
way feat-305 did — by seeing the healthcheck run in a chat deploy's Railway
build log, and by checking the deployment record's `configFile` field per
environment.

**Scope limit — a failed diagnostic fails OPEN, by construction.**
`instrumentation.ts` wraps the `@/config/env` import and the
`describeSeekerEgressMisconfiguration()` call in two narrow guards that log
`[seeker-egress] event=diagnostic_failed stage=import|call` and return
_without_ throwing. So there is a third way a misconfigured build promotes: the
gate never fires because the diagnostic itself broke. The narrowness is
deliberate — a broken diagnostic is not evidence of a misconfiguration, and
failing the deploy on it would be a self-inflicted outage — but it means that
enum line is an **alert**, not an info log, for any service adopting this
pattern. The request-path pin still holds in that state.

Residual risk (i) — **no CI holds the HTTP-level 500.** Every test that
exercises the hook asserts on `register()`'s promise; the gate's arming depends
on what the _server_ answers over HTTP, which nothing in the suite observes. A
Next upgrade that changed `prepare()`-rejection behavior would disarm the gate
silently, with the suite green. The remedy is a smoke that runs `next build`,
starts `next start`, and asserts `curl /api/health` is 500 with the pin violated
and 200 without. It is not ticketed.

Residual risk (ii) — **the arming is a property of the BUILD, not of the
deployed environment's `NODE_ENV`.** This one is easy to get backwards, so state
it precisely: `next build` replaces `process.env.NODE_ENV` with the literal
`"production"` in the server bundle, and `apps/chat/src/config/env.ts` reads it by direct
member access (`NODE_ENV: emptyToUndefined(process.env.NODE_ENV)`) — so
`requireSeekerEgressAllowlist()` compiles down to a constant-true comparison.
Both layers are therefore armed in **every** production build: every deployed
environment, and a local `next build` + `next start` too. An operator **cannot**
opt an environment into report-only by setting `NODE_ENV=staging`; only
`next dev` and the test runner stay fail-open. Verified by hand 2026-07-27:
building with `NODE_ENV=staging` still emitted `NODE_ENV: …("production")` into
the chunk, and the resulting server 500ed `/api/health` with the pin violated.

Two consequences follow, and they are the actual risks. First, there is **no
staged rollout** — you cannot land the code in a pre-production environment in
report-only mode first, so the allowlist must be provisioned in every
environment _before_ the code that requires it. Second, a developer running a
local production build inherits full enforcement, which is a footgun if they
expected `next dev` behavior. Note also that the sibling `apps/mastra` guard
this doc cites is a plain Node process with no build-time inlining, so its
`NODE_ENV` genuinely _is_ runtime-read — do not carry that intuition across.

## When to apply

- Any boot-time or module-load validation that could reasonably throw, and whose
  subject is a config value rather than a code invariant.
- A proposal to "just make it throw" against an existing report-only guard —
  check whether the rollback capability arrived first, and whether anyone
  observed it working.
- Adding a fail-fast startup guard to a service by analogy with a sibling
  service that already has one. Copy the sibling's healthcheck before copying
  its posture.
- Reviewing an environment-conditional guard on a deploy target with no staging
  environment, where production is the only place the production branch runs.

Two other places in this repo where the law bites — recorded as observations,
not as work assigned to those services:

- **`apps/admin` carries the same inert fail-open shape — and is the worked
  example of why the capability check is not a formality.** Its
  `MASTRA_CHAT_ALLOWED_HOSTS` is `.optional()` with no default and its
  `hostAllowed` takes no `requireAllowlist` argument, so unset trusts the
  operator-set base host while guarding egress of `MASTRA_CHAT_API_KEY`. Chat's
  answer to that shape was the feat-304 request-path pin, then the feat-306
  deploy gate; neither follows automatically for admin. The feat-306 half in
  particular does **not** clear on inspection, for three reasons, none of which
  the presence of a `healthcheckPath` line settles:
  1. **The probe is unconfirmed.** `apps/admin/railway.toml` is this doc's own
     cautionary example of a `railway.toml` Railway may not be reading; its
     header says so. It would first have to be established that the service's
     Config-as-code Path / the deployment record's `configFile` is wired, per
     environment, the way feat-305 established it for chat.
  2. **Rollback is not equivalent to chat's.** Admin runs
     `preDeployCommand = "pnpm --filter @forge/admin db:migrate:deploy"`, so the
     production database is already migrated by the time a healthcheck refuses
     promotion. "The previous deployment keeps serving" there means old code
     against a new schema — a materially worse fallback than chat's.
  3. **The blast radius is the largest in the repo** (web/mobile/tv's data
     layer plus the partner `/api/search` surface), and the guarded path is
     off by default — `EXPERIENCE_AI_REMOTE_CHAT` defaults to `"false"`. An
     unconditional gate would refuse deploys over a value no code path reads,
     so a gate there would have to be conditioned on the relay being enabled.

  None of this is a recommendation that admin change. There is no repo-wide
  convention here — and the law predicts there should not be: `apps/mastra`
  boot-throws, chat now does, admin does not, `apps/roadmap` cannot, because
  their rollback capabilities differ. This doc records only that the shape
  exists and what would have to be true before chat's answer transferred.

- **`apps/roadmap` is the one app that still could not afford a boot guard.** It
  is the only service under `apps/` with no `healthcheckPath` (chat was the
  other until feat-305; `infra/datadog-agent` also has none, but runs none of
  our application code). Any fail-fast startup check proposed there today is a
  feat-304-shaped decision, not a feat-306-shaped one.

## Related

- [feat-304](../../roadmap/ai-chat/feat-304-chat-production-egress-pin.md) /
  [feat-305](../../roadmap/ai-chat/feat-305-chat-healthcheck.md) /
  [feat-306](../../roadmap/ai-chat/feat-306-chat-egress-pin-boot-throw.md) — the
  three tickets this law is drawn from, in order.
- [mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — the arc's two test-discipline instances: feat-304's environment-conditional
  policy threaded into two config builders, and feat-306's prose-carried
  mechanism claim whose tests all sat at a different layer. Distinct learnings;
  this doc cross-links rather than restates them.
- [browser-sse-proxy-to-bearer-gated-internal-sse](./browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md)
  — the chat proxy pattern the egress pin guards; amended by both feat-304 and
  feat-305 as the posture changed underneath it.
- [required-env-var-without-default-broke-railway-deploy](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md)
  — the boundary law, not a contradiction: it forbids making the schema the
  enforcement point, which is what pushed this arc's enforcement into a policy
  function. A promotion gate lets you fail the deploy; it never licenses making
  the var required.
- [fail-closed-by-construction-feature-flag-gate](./fail-closed-by-construction-feature-flag-gate-20260708.md)
  — the sibling law, on a different axis, and not a contradiction either: it
  governs a **request-path** gate, where the rule is precisely _never throw_
  (wrap the whole flag path so a failure resolves to deny). This law is about a
  **boot-time** check, where throwing is exactly the point once a promotion gate
  exists. Same app, same "fail-closed" vocabulary, opposite prescriptions —
  because the enforcement points differ, which is the whole subject here.
- [langfuse-prompt-api-contract-and-sdk-rejection](../tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md)
  — the cross-app prior art: `apps/mastra` already ships the production
  boot-throw egress guard this arc converged on, and already had the healthcheck
  that makes it affordable.
- [railway-dashboard-override-shadows-railway-toml](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md)
  — the precondition behind scope limit (c): a per-service `railway.toml` that
  Railway is not actually reading. If that happens here, there is no probe and
  the broken build promotes.
- [nextjs-standalone-instrumentation-hidden-dynamic-import](../build-errors/nextjs-standalone-instrumentation-hidden-dynamic-import.md)
  — the same hook in another app, under `output: "standalone"`, where a
  runtime-only import vanished from the compiled instrumentation chunk. Read it
  before changing chat's build output, since the mechanism above is stamped
  non-standalone.
