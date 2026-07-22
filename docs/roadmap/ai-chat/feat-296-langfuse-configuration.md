---
id: "feat-296"
title: "Configure and provision Langfuse for managed seeker prompts"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-08-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "infrastructure"
  - "ai-pipeline"
---

## Problem

The Langfuse managed-prompt retrieval mechanism (helper + `LANGFUSE_*` env
group + production boot guard) ships in **PR #1621**
(`feat/langfuse-prompt-helper`) — **not yet on `main`**. It is deliberately
unwired: no agent consumes it, and every `LANGFUSE_*` var is unset in every
environment. Before feat-272 wires the seeker agent's system prompt to it, an
operator has to actually stand Langfuse up: decide hosting posture, create the
per-environment projects and key pairs, seed the smoke prompt, and set the env
vars.

That provisioning is an **operational precondition**, not code, so it needs its
own tracked ticket rather than living only as a paragraph inside feat-272. It is
also the ticket that carries the one genuinely dangerous step in the whole
arc — setting `LANGFUSE_BASE_URL` in production **without** a satisfying
`LANGFUSE_ALLOWED_HOSTS` is the single configuration that fails a production
boot. This ticket exists so that step is done in a **provably safe order**.

**Relationship to other tickets** (recorded here in prose — feat-272 is not on
`main`, so its frontmatter cannot be edited from this PR; wire the reciprocal
`depends_on` when #1621 lands):

- **Gates feat-272** (Seeker Langfuse-managed prompt integration, PR #1621).
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

This is the same receiver-first discipline the repo already uses for cross-app
keys: set the precondition before the trigger.

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

> All code paths below ship in **PR #1621** (`feat/langfuse-prompt-helper`) and
> are not on `main` yet — read them from that branch until it merges.

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
   (env-group all-optional), KTD8 (per-environment projects + protected
   `production` label), R9 (the fail-closed host guard), and Open Questions
   (hosting posture / ownership, still undecided).

## Grep These

- `assertLangfuseBaseUrlAllowedForProduction` — the production boot guard.
- `LANGFUSE_ALLOWED_HOSTS` — the allowlist the base URL is checked against.
- `config_missing` — the runtime short-circuit that serves the fallback.
- `getManagedPrompt` — the consumer surface feat-272 will wire.

## What To Build

This is a provisioning + configuration ticket — no application code. In rough
order:

1. **Decide hosting posture (Open Question — decide first).** Langfuse Cloud
   (choose region — **EU vs US**; keys and base URLs are region-bound) vs
   self-hosted. Assign an owner for the account and the ongoing key custody.
2. **Create per-environment Langfuse PROJECTS** (dev / staging / prod), each
   with its own public+secret key pair — **not** labels within one shared
   project (KTD8: a leaked dev key must not read tuned prod prompt text).
3. **Seed the smoke prompt** in the **dev** project so the opt-in smoke can run
   green (the test never self-seeds). Per the smoke test header: name
   `forge-mastra-smoke/text-prompt`, **text** type, two versions —
   version 1 label `production`, version 2 label `smoke` — with the exact
   sentinel bodies documented in that file's header.
4. **Set the env vars per environment, following the safe order above.** The
   effective-required set once you configure at all: `LANGFUSE_BASE_URL`,
   `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_ALLOWED_HOSTS`
   (the exact hostname). Optional knobs default sensibly and can stay unset:
   `LANGFUSE_PROMPT_DEFAULT_LABEL`, `LANGFUSE_TIMEOUT_MS`,
   `LANGFUSE_MAX_RESPONSE_BYTES`, `LANGFUSE_PROMPT_CACHE_TTL_MS`,
   `LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS`, `LANGFUSE_USER_AGENT`.
5. **Make `production` a protected (admin-only-mutation) label** in each project
   (KTD8). Full label-move governance is feat-272's access-control review — see
   Constraints.

## Constraints

- **Per-environment PROJECTS, never labels-within-one-project** (KTD8).
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

## Verification

- **Unconfigured stays green:** with all `LANGFUSE_*` unset, the production
  Mastra deploy boots and `getManagedPrompt` serves `source: "fallback"`
  (already pinned by the #1621 test suite). Nothing to do beyond confirming the
  deploy is green.
- **Configured smoke passes:** against the dev project, the opt-in real-
  credential smoke runs green —
  `LANGFUSE_PROMPT_SMOKE_TEST=1 LANGFUSE_BASE_URL=… LANGFUSE_PUBLIC_KEY=…
LANGFUSE_SECRET_KEY=… pnpm --filter @forge/mastra test langfuse-prompt-client.smoke`.
- **Guard sanity in production:** base URL `https://` + hostname present in
  `LANGFUSE_ALLOWED_HOSTS` → boots; a mismatch (http, wrong host, port, or
  allowlist unset) → the deploy **fails its healthcheck** and the previous
  deployment keeps serving. Confirm via a staging service before prod.
