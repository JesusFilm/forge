---
id: "feat-296"
title: "Configure and provision Langfuse for managed seeker prompts"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-07-27"
duration: 1
depends_on: []
blocks:
  - "feat-272"
tags:
  - "infrastructure"
  - "ai-pipeline"
---

## Problem

The Langfuse managed-prompt retrieval mechanism (helper + `LANGFUSE_*` env
group + production boot guard) **shipped in
[#1621](https://github.com/JesusFilm/forge/pull/1621) and is now on `main`**. It
is deliberately
unwired: no agent consumes it, and every `LANGFUSE_*` var is unset in every
environment. Before feat-272 wires the seeker agent's system prompt to it, an
operator has to actually stand Langfuse up: create the project and key pairs,
seed the smoke prompt, and set the env vars.

> **Topology decision (2026-07-28).** The plan's KTD8 mandated one Langfuse
> project **per environment**. That is reversed — provisioning uses **ONE
> project, `forge-mastra`, with labels `production` and `development`
> distinguishing environments**, in the **same Langfuse organisation** as
> `JesusFilm/core`'s Journeys project. KTD8's premises did not hold here:
> `apps/mastra` has exactly one deployed environment (no staging or preview
> Mastra service; Railway PR environments inherit from stage, which has no
> Mastra service), the same small set of people holds every key so separating keys
> separates nothing, and the org's own production Langfuse deployment is
> already single-project-with-labels. The cost KTD8 never weighed: prompt
> versions and labels are project-scoped with no cross-project copy, so
> per-environment projects turn promotion into manual re-authoring with forked
> version numbering. KTD8's **governance half survives at full strength** —
> `production` stays a protected, admin-only label, and the label-move review
> in feat-272 matters _more_ now, because the label move is the entire release
> mechanism. Supersession notes are recorded beside KTD8 in the plan and beside
> Ruling 1 in
> `docs/solutions/tooling-decisions/langfuse-prompt-api-contract-and-sdk-rejection.md`.
>
> **Same-org caveat — record it, because it is a snapshot.** Co-tenancy with
> Journeys is acceptable because every member of that Langfuse organisation is
> currently a developer. Absent project-scoped RBAC, org roles span all
> projects, so anyone in the org gets dashboard read _and write_ (label moves,
> key creation) over the seeker prompts. If the roster later admits
> non-developers, revisit — either project-scoped roles or a forge-only
> organisation.

That provisioning is an **operational precondition**, not code, so it gets its
own tracked ticket — the fuller checklist that feat-272's short **Operational
precondition** note defers to, rather than duplicating it. It is
also the ticket that carries the one genuinely dangerous step in the whole
arc — setting `LANGFUSE_BASE_URL` in production **without** a satisfying
`LANGFUSE_ALLOWED_HOSTS` is the single configuration that fails a production
boot. This ticket exists so that step is done in a **provably safe order**.

**Relationship to other tickets** (the intra-lane edge is wired in frontmatter:
this ticket `blocks` feat-272, and feat-272 `depends_on` feat-296):

- **Gates feat-272** (Seeker Langfuse-managed prompt integration).
  feat-272 must not enable production consumption until this provisioning is
  done and its access-control review has passed.
- **Sibling of feat-279** (Studio-editable prompt block — `blocked` by a
  `@mastra/editor` peer incompatibility). Langfuse is the external
  prompt-management path that does not depend on the Mastra Editor.

## Fallback safety — an unconfigured environment cannot break

The core safety property, confirmed against the PR #1621 code, and the reason
this ticket is low-risk: **you can wire and deploy feat-272 with zero
`LANGFUSE_*` vars set and nothing breaks.** The tuned prompt simply is not live
yet — the agent runs on its compiled-in fallback (the inline
`SEEKER_SYSTEM_PROMPT`).

- **Boot:** `assertLangfuseBaseUrlAllowedForProduction()` returns on its first
  line (`if (!env.LANGFUSE_BASE_URL) return`) when no base URL is set, and is
  only reached at all under `NODE_ENV === "production"`. Fully unset → the guard
  never fires.
- **Runtime:** with the base URL or either key absent, `fetchLangfusePrompt`
  short-circuits to `config_missing` (no throw, no reject), and
  `getManagedPrompt` returns `{ text: <fallback>, source: "fallback", reason:
"config_missing" }`. Prompt retrieval is never a boot dependency and never a
  chat-turn dependency.

**The one unsafe state — and the only thing this ticket must get right — is a
_partial / incorrect production_ config**, specifically `LANGFUSE_BASE_URL` set
without a satisfying `LANGFUSE_ALLOWED_HOSTS` (or a non-`https` URL, or a
hostname-format mismatch). That throws at boot. Because `apps/mastra/railway.toml`
has a `/health` healthcheck with `restartPolicyType = "ON_FAILURE"`, a boot
throw surfaces as a **failed deployment — the previous deployment keeps
serving** — not a live outage. (Caveat: this healthcheck safety net only holds
if the Railway service's Config-as-code Path points at `apps/mastra/railway.toml`;
otherwise the dashboard config is canonical — verify before relying on it.)

## Safe env-variable rollout procedure (do this exactly)

The boot guard has **exactly one trigger**: `LANGFUSE_BASE_URL`. Every other
`LANGFUSE_*` var is inert on its own — no combination of them can throw. So the
rollout is safe as long as the base URL is the **last** var you set, regardless
of how Railway batches variable edits into a deploy:

1. **Set everything EXCEPT `LANGFUSE_BASE_URL` first** — `LANGFUSE_ALLOWED_HOSTS`,
   `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and any optional knobs. Apply /
   redeploy as many times as you like; none of these can arm the guard.
2. **Set `LANGFUSE_BASE_URL` LAST, on its own.** By the time it lands, the
   allowlist already satisfies the guard, so no intermediate state is ever
   "guard armed but unsatisfied."

This is the same precondition-before-trigger principle behind the repo's
cross-app key rollouts — set the precondition before the trigger (here, ordering
one service's own env vars rather than a two-service receiver/caller handoff).

### The gotcha that bricks a boot while looking correct

`LANGFUSE_ALLOWED_HOSTS` is matched as `allowedHosts.has(new URL(baseUrl).hostname)`
— an **exact hostname**, nothing else:

- ✅ `cloud.langfuse.com`
- ❌ `https://cloud.langfuse.com` — scheme included → no match → boot throws
- ❌ `cloud.langfuse.com:443` — `.hostname` strips the port, so a port in the
  allowlist never matches
- The base URL itself must be `https://` (the guard requires it in production).
- The guard keys on `NODE_ENV === "production"`, **not** the Railway
  environment's name — a staging service running `NODE_ENV=production` is
  guarded too.

## Entry Points — Read These First

> All code paths below shipped in
> [#1621](https://github.com/JesusFilm/forge/pull/1621) and are on `main` — read
> them there.

1. `apps/mastra/src/config/env.ts` — the `LANGFUSE_*` group, `getLangfuseConfig()`
   (the cooldown-≤-TTL clamp), and `assertLangfuseBaseUrlAllowedForProduction`
   (the one boot throw). Confirm no `LANGFUSE_*` var is ever pushed into the
   production `missing` list.
2. `apps/mastra/src/services/langfuse-prompt-client.ts` — the `config_missing`
   short-circuit and the `source: "fallback"` provenance that make an
   unconfigured environment safe.
3. `apps/mastra/railway.toml` — the `/health` healthcheck + `ON_FAILURE`
   restart policy that turns a bad boot into a failed deploy, not an outage.
4. `apps/mastra/CLAUDE.md` — the `LANGFUSE_*` rows in the Environment table
   (per-var posture and defaults).
5. `apps/mastra/src/services/langfuse-prompt-client.smoke.test.ts` — the
   one-time smoke-seeding convention (below).
6. `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` — KTD5
   (env-group all-optional), R9 (the fail-closed host guard), and KTD8 **with
   its 2026-07-28 supersession note**: the per-environment-projects half is
   reversed (see the topology decision above); the protected-`production`-label
   half stands. The Open Questions entry on hosting posture is answered by the
   same-org decision above — Langfuse Cloud, same organisation and therefore
   same region as Journeys.

## Grep These

- `assertLangfuseBaseUrlAllowedForProduction` — the production boot guard.
- `LANGFUSE_ALLOWED_HOSTS` — the allowlist the base URL is checked against.
- `config_missing` — the runtime short-circuit that serves the fallback.
- `getManagedPrompt` — the consumer surface feat-272 will wire.

## What To Build

This is a provisioning + configuration ticket — no application code. In rough
order:

1. **Confirm the account and region.** Langfuse Cloud, the same organisation
   as Journeys. Read the region off that organisation (EU and US are separate
   deployments with separate hosts; keys are region-bound) and derive
   `LANGFUSE_BASE_URL` plus the exact-hostname `LANGFUSE_ALLOWED_HOSTS` value
   from it. Record the region here once seen. Assign an owner for ongoing key
   custody.
2. **Create ONE Langfuse project, `forge-mastra`**, in that organisation.
   Environments are distinguished by **labels on prompt versions**
   (`production` / `development`), not by projects — see the topology decision
   above. Each additional agent later becomes another prompt name inside this
   project, never another project.
3. **Create TWO key pairs in that project** — one for Railway, one for local
   dev. Same project, same access; the point is that a leaked local key is
   revoked in one action without rotating the production credential, and that
   the two are distinguishable in any audit log. Do **not** copy the Railway
   key onto laptops.
4. **Seed the smoke prompt** in `forge-mastra` so the opt-in smoke can run
   green (the test never self-seeds). Per the smoke test header: name
   `forge-mastra-smoke/text-prompt`, **text** type, two versions —
   version 1 label `production`, version 2 label `smoke` — with the exact
   sentinel bodies documented in that file's header. The distinctive name
   keeps it clear of the real prompts, and the smoke then exercises the same
   project production reads from.
5. **Set the env vars, following the safe order above.** The
   effective-required set once you configure at all: `LANGFUSE_BASE_URL`,
   `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_ALLOWED_HOSTS`
   (the exact hostname). Optional knobs default sensibly and can stay unset:
   `LANGFUSE_PROMPT_DEFAULT_LABEL`, `LANGFUSE_TIMEOUT_MS`,
   `LANGFUSE_MAX_RESPONSE_BYTES`, `LANGFUSE_PROMPT_CACHE_TTL_MS`,
   `LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS`, `LANGFUSE_USER_AGENT`.
   Railway (production) leaves `LANGFUSE_PROMPT_DEFAULT_LABEL` unset — it falls
   through to `production`. A local `.env` sets it to `development` to track
   the dev-labelled version. Local dev may also leave the whole group unset
   entirely: unconfigured serves the compiled-in fallback, which is the full
   working prompt.
6. **Verify the tier, then make `production` a protected (admin-only-mutation)
   label.** Protected labels may be a paid-tier feature — check before
   promising the control. If the tier does not offer it, say so plainly here
   and carry label-move discipline into feat-272's access-control review
   instead of claiming a control that does not exist. Note that on a project
   with a small admin set a protected label is thin protection anyway (any
   admin can move it); the review is what carries the weight.

## Constraints

- **ONE project (`forge-mastra`), labels distinguish environments.** Do not
  create a second project per environment — that is the reversed KTD8 mandate
  (see the topology decision above), and it would make promotion a manual
  re-authoring across projects. Additional agents are additional **prompt
  names** in this project.
- **Two key pairs inside that one project** — Railway and local dev — and
  never the Railway key copied onto a laptop.
- **Never set `LANGFUSE_BASE_URL` in production before `LANGFUSE_ALLOWED_HOSTS`
  is set to the exact hostname** — that is the one boot-throwing state.
- **Do not move any `LANGFUSE_*` var into a required / no-default schema slot.**
  The all-optional posture IS the Railway-brick guard
  (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`);
  keep it.
- **Scope is provisioning + safe env rollout only.** Label-move governance —
  who may re-point `production` to a new version, since that becomes an
  unreviewed production behavior change — belongs to feat-272's access-control
  review (folded into the ai-chat guardrail release gate). Do not enable
  production consumption before that review passes.
- **Do not enable Langfuse tracing as part of this ticket.** Nothing sends
  traces today and the prompt helper cannot — it only reads. Traces would land
  in this same project and carry real conversation content, which is a
  deliberate decision tracked separately in
  `docs/roadmap/ai-chat/feat-321-langfuse-tracing.md`.

## Verify in the Langfuse dashboard — do not assume

None of this is visible from the repo. Record what you find here as you go.

- **Region** of the shared organisation → derives `LANGFUSE_BASE_URL` and the
  exact `LANGFUSE_ALLOWED_HOSTS` hostname.
- **Whether protected labels exist on the tier** — step 6 depends on it.
- **The organisation's member roster**, to confirm the all-developers
  assumption the same-org decision rests on.
- **That multiple key pairs per project are supported**, plus the revocation
  flow — step 3 depends on it.
- **Whether scoped or read-only API keys have shipped** since the plan's
  2026-07 research (Langfuse discussions #1692). If so, several risk statements
  in the plan and the SDK-rejection solutions doc need re-deriving.

## Verification

- **Unconfigured stays green:** with all `LANGFUSE_*` unset, the production
  Mastra deploy boots and `getManagedPrompt` serves `source: "fallback"`
  (already pinned by the #1621 test suite). Nothing to do beyond confirming the
  deploy is green.
- **Configured smoke passes:** against the `forge-mastra` project using the
  local-dev key pair, the opt-in real-credential smoke runs green —
  `LANGFUSE_PROMPT_SMOKE_TEST=1 LANGFUSE_BASE_URL=… LANGFUSE_PUBLIC_KEY=…
LANGFUSE_SECRET_KEY=… pnpm --filter @forge/mastra test -- langfuse-prompt-client.smoke`.
- **Guard sanity in production:** base URL `https://` + hostname present in
  `LANGFUSE_ALLOWED_HOSTS` → boots; a mismatch (http, wrong host, port, or
  allowlist unset) → the deploy **fails its healthcheck** and the previous
  deployment keeps serving. Note there is **no staging Mastra service to
  rehearse on** — production is the only deployed environment — so the
  base-URL-last ordering above is the whole safety margin. Get the hostname
  exactly right before the final variable lands.
