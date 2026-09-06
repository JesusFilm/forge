---
id: "feat-440"
title: "Host allowlist for the gateway chat base URL"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-09-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-09-02 via [PR #2115](https://github.com/JesusFilm/forge/pull/2115) (`feat(mastra): host allowlist for the gateway chat base URL (feat-440)`).

**What landed.** The boot assert shipped as primary enforcement exactly as briefed, with the optional runtime defense-in-depth kept at `buildSeekerGatewayModelEntry()` AND mirrored as a construction-free rung in the title-repair gate ladder (the ladder never calls the builder, so it needed its own check to keep the counted-skip contract — plus an enum-only `gateway_base_url_not_allowed` log line disambiguating the reused `gateway_unconfigured` skip from a missing key). Review added one hardening beyond the brief: the gateway fetch now pins `redirect: "error"`, so the allowlist governs the actual destination rather than only the configured URL. Zero Railway edits were needed; the paired-edit rule (base URL change to a non-default host requires the allowlist in the same edit) is documented in the env table.

**Residual risk / follow-ups.** The experience-side gateway clients (`providers.ts`, `default-chat-agent.ts`, `specialized-agents.ts`, `memory.ts`) predate the redirect pin and still follow redirects with the same chat key — pre-existing, bounded by the boot assert on the configured URL, recorded in the redirect pin's code comment; no ticket filed (owner decision). The runtime re-check applies in every environment, so a non-allowlisted or http local gateway override degrades to the Gemma-only chain (documented in `apps/mastra/CLAUDE.md`).

## Problem

`AI_GATEWAY_CHAT_BASE_URL` accepts any URL (`z.string().url().optional()` in
`apps/mastra/src/config/env.ts`) with no host allowlist and no https
requirement, unlike the embeddings surface, which validates its base URL
against `AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS` (default
`ai-gateway.jesusfilm.org`). A typo'd or tampered env value would silently
redirect everything the chat gateway client sends — seeker answers, the
experience draft/chat agents' turns, and since feat-405 also per-turn thread
titles plus the nightly title-repair sweep's batches of conversation content
(special-category data) — to whatever server the URL names, with the bearer
key attached.

Pre-existing feat-237 posture, surfaced by the feat-405 security review; the
exposure is misconfiguration/insider-shaped (it requires env-write access),
not remote.

## Entry Points — Read These First

1. `apps/mastra/src/config/env.ts` — the sibling egress guards to mirror:
   `assertJesusfilmRagBaseUrlAllowedForProduction()` (called from
   `assertMastraRuntimeEnv`) and the `AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS`
   schema entry + production guard. All four existing egress guards in this
   app (embeddings, RAG, Langfuse, admin-agent-tools) BOOT-THROW on a
   set-but-disallowed URL in production; that posture is established and
   healthcheck-backed.
2. `apps/mastra/src/mastra/seeker-model-list.ts` —
   `buildSeekerGatewayModelEntry()`, the seeker-side choke point constructing
   the gateway client with `env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL`
   (seeker chain, titling default, title-repair sweep, follow-ups generator).
3. `apps/mastra/src/mastra/providers.ts` — `createJesusFilmProvider()`, the
   experience draft/chat agents' consumer of the SAME base URL. Both
   consumers must be covered.
4. `apps/mastra/src/mastra/gateway-constants.ts` —
   `DEFAULT_AI_GATEWAY_CHAT_BASE_URL` (the value the default list must cover).

## Grep These

- `AI_GATEWAY_CHAT_BASE_URL` — every read site (seeker-model-list,
  providers.ts, tests)
- `assertJesusfilmRagBaseUrlAllowedForProduction` — the boot-guard idiom to
  mirror (https + host-in-list, production-only, fires only when armed)
- `AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS` — the sibling allowlist schema shape

## What To Build

Add `AI_GATEWAY_CHAT_ALLOWED_HOSTS` (`z.string().optional()`, CSV, runtime
default `ai-gateway.jesusfilm.org`).

**Primary enforcement: a production boot assert**, mirroring
`assertJesusfilmRagBaseUrlAllowedForProduction` — it fires only when the
gateway chat path is armed (`AI_GATEWAY_CHAT_API_KEY` set), and validates the
EFFECTIVE URL (`env.AI_GATEWAY_CHAT_BASE_URL ?? DEFAULT_AI_GATEWAY_CHAT_BASE_URL`)
for https + host-in-list, throwing at boot on a violation. The boot assert
covers BOTH consumers (seeker-model-list and providers.ts) at one choke
point, which is part of why it is primary; mastra's boot-throw posture is
established and healthcheck-backed, and every sibling egress guard already
behaves this way.

**Optional defense-in-depth:** the runtime check at
`buildSeekerGatewayModelEntry()` MAY additionally be kept — a violation there
returns `null`, which existing consumers treat as their counted degrade
(`gateway_unconfigured` skip for the sweep; the free-Gemma chain for the
seeker/titling), accompanied by one enum-only log line. It is not the primary
enforcement.

## Constraints

- No new required-at-boot env var; the runtime default must cover the current
  production value with zero Railway edits. (The allowlist var itself stays
  `.optional()` — the boot assert fires on a SET-but-disallowed effective URL
  while armed, which is the sibling guards' exact posture; the opt-in
  `.optional()` law governs absent vars and is not a reason to avoid the
  assert.)
- If the runtime defense-in-depth check is kept, its degrade to the free-Gemma
  chain is acceptable ONLY with the enum-only log line — never a SILENT
  fallback to the free pool. (In production the boot assert prevents that
  state from being reachable at all; the runtime check matters for
  non-production and for drift between boot and runtime env.)
- Cover both consumers; do not scatter per-caller checks beyond the one boot
  assert plus the optional single runtime choke point.
- `apps/admin`'s mirrored gateway code is OUT of scope (owner decision).

## Verification

- Boot-assert tests mirroring the RAG guard's suite: armed + allowed host →
  boots; armed + unlisted host → throws; armed + http → throws; unarmed →
  never fires; unset list → default host allowed. These cover both consumers
  by construction (one assert, one effective URL).
- If the runtime check is kept: `buildSeekerGatewayModelEntry()` unit tests
  (unlisted host → null + one enum log; sweep gate reports the counted skip
  with zero pool/model activity).
- `pnpm --filter @forge/mastra test && pnpm --filter @forge/mastra build`.
