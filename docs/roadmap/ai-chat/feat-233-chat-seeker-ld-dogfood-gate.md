---
id: "feat-233"
title: "Chat seeker LaunchDarkly dogfood gate (per-user allowlist)"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-07-06"
duration: 3
depends_on:
  - "feat-231"
blocks:
  - "feat-236"
tags:
  - "web"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-08 via [PR #1488](https://github.com/JesusFilm/forge/pull/1488) (`feat(ai-chat): gate seeker behind per-user LaunchDarkly dogfood allowlist (feat-233)`).

**What landed.** A per-user LaunchDarkly gate composed on top of the existing `SEEKER_CHAT_ENABLED` kill switch, fail-closed by construction. `@forge/feature-flags` gained the `chatSeekerDogfood` registry entry and an outcome-preserving `booleanVariationDetail` returning `{ value, source }` so `ld_unavailable` is distinguishable from `not_targeted`; `reason.kind === "ERROR"` resolutions route to the fallback before the value check, and client construction is wrapped so the variant never throws — `booleanVariation` delegates through it with no behavior change for web. In `apps/chat`: the verified `email_verified` claim threads through the session cookie; a chat LD client ships with analytics events off (`sendEvents:false` + `diagnosticOptOut`) and the local override withheld from deployed builds (`localEnv` only under `NODE_ENV=development`); `resolveSeekerGate` (kill switch → verified email → LD individual-target flag keyed on the normalized email) emits the R15 `[seeker-gate]` log line carrying the opaque `sub`, never the email; it is enforced identically at `page.tsx` and on every `/api/seeker` request, a deny emitting one terminal `gate_denied` SSE frame the client maps to the stub. Both env vars are `.optional()` (boots clean); the flag's own dashboard configuration (zero targeting rules, restricted write access) is the one grant surface that stays operator-governed, by design.

**Operational tail (pending).** The code merges fail-closed — the dogfood _flip itself_ is operator work, not done here: the LaunchDarkly flag/SDK-key/targeting provisioning and the pre-prod, deployed, and gate-walk verification rows (Verification Contract rows 4–6) run at flip time per the plan's Rollout Runbook. Production serves stub to everyone until then.

**Compound docs.** `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md`, `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`.

**Residual risk / follow-ups.** Phase-end removal is tracked by [feat-236](feat-236-chat-remove-seeker-dogfood-gate.md) (rate-cap-first ordering + a binding keep-list). A per-caller rate/concurrency cap on `/api/seeker` remains the open prerequisite before the audience widens beyond the hand-picked roster; the 8h no-revocation session riding the gate is the plan's accepted residual (R13).

## Problem

Seeker is wired end-to-end (feat-205) and chat auth works locally and in production (feat-207/feat-229; prod clients feat-231), but stub-vs-seeker is the all-or-nothing `SEEKER_CHAT_ENABLED` env var, and `/api/seeker` has NO inbound auth gate — its own header names a real inbound gate a hard prerequisite "before the audience widens at all". Dogfooding seeker in production is that widening moment: without per-user gating, enabling seeker in prod exposes the agent and its LLM spend to the public internet. This ticket adds a LaunchDarkly boolean flag with individually-targeted emails, enforced server-side at the route on every request, so only hand-picked signed-in teammates reach the real agent; everyone else (signed-in untargeted, anonymous, direct curl) gets the stub.

Product requirements are pinned in `docs/plans/2026-07-03-002-feat-chat-seeker-ld-flag-plan.md` (requirements-only unified plan, R1–R17, twice doc-reviewed). Run `ce:plan` against that doc before implementation.

## Entry Points — Read These First

1. `docs/plans/2026-07-03-002-feat-chat-seeker-ld-flag-plan.md` — the Product Contract this ticket implements (gate matrix, key decisions, acceptance examples).
2. `apps/chat/src/app/api/seeker/route.ts` — the gate-order comment ("enable flag → config present → SSRF") and the accepted-risk header (route.ts:13-21) this ticket partially retires (inbound auth lands here; the rate cap stays open).
3. `apps/chat/src/auth/identity.ts` — `getChatIdentity()` and the DISPLAY-ONLY JSDoc contract that must be amended (plan R13); `ChatIdentity.email` is optional — no email means not targeted. Note: chat's id_token verifier (`apps/chat/src/auth/oauth-client.ts`) currently drops the `email_verified` claim apps/auth emits — the gate needs it threaded through (plan R4).
4. `packages/feature-flags/src/registry.ts` + `packages/feature-flags/src/launchdarkly.ts` — flag registry (keys are `forge.*`, `defaultValue`, `localOverrideEnv`) and the fallback chain (env override → defaultValues → flag.defaultValue) that makes fail-closed and local dev work.
5. `apps/web/src/lib/feature-flags.ts` — the only existing LaunchDarkly consumer; prior art for a per-app flag client (`import "server-only"`, optional SDK key, 0.25s timeout) — EXCEPT its `localEnv` wiring, which passes overrides in unconditionally. Chat must NOT copy that part: the seeker flag's override is withheld from the deployed client (plan R9, fail-closed decision).
6. `apps/chat/src/lib/chat-stub.ts` — `streamReply()` seeker/stub seam; `apps/chat/src/app/page.tsx` threads the `seekerEnabled` prop (force-dynamic, per-request).

## Grep These

- `SEEKER_CHAT_ENABLED` / `isSeekerChatEnabled` — every existing gate site that the flag composes with.
- `grep -rni 'gate authoriz' apps/chat/` — both identity-contract amendment sites for R13 (identity.ts + apps/chat/CLAUDE.md; the CLAUDE.md occurrence is lowercase and line-wrapped, so an uppercase literal misses it).
- `booleanVariation` / `localOverrideEnv` — flag evaluation + local fallback pattern.
- `LAUNCHDARKLY_SDK_KEY` — env wiring prior art (`apps/web/src/env.ts`, `z.string().optional()`).

## What To Build

1. Register a new boolean flag in `packages/feature-flags/src/registry.ts` (`forge.*` naming, `defaultValue: false`, a `localOverrideEnv` for local dev); the registry description carries the individual-targets-only boundary (plan R17).
2. Add `@forge/feature-flags` to `apps/chat` plus an optional `LAUNCHDARKLY_SDK_KEY` in `apps/chat/src/config/env.ts` (schema is all-optional zod — keep the "boots clean with none set" guarantee). Wire chat's flag client so the seeker flag's `localOverrideEnv` reaches `localEnv` only in local dev, never in deployed environments (plan R9).
3. One server-side decision helper: `SEEKER_CHAT_ENABLED` kill switch AND `getChatIdentity()` AND `booleanVariation` with an email-carrying context; anonymous, email-less, or unverified-email (`email_verified !== true`) identities short-circuit to stub without evaluating the flag. Normalize the email (trim, lowercase) before evaluation (plan R4/R14).
4. Enforce in `/api/seeker` on every request (extends the existing gate order); `page.tsx` derives `seekerEnabled` from the same helper so UI mode and enforcement agree.
5. Amend the identity.ts JSDoc + `apps/chat/CLAUDE.md` display-only warning per plan R13's bounded carve-out (individual targets only, internal staff dogfooders only; rule-based targeting, non-org targets, or reuse beyond seeker dogfooding still require revocation + membership gate first).
6. LaunchDarkly dashboard: create the flag, individually target dogfooder emails (entered lowercase; individual targets ONLY — zero rules, per plan R17); restrict the flag's targeting write access to the named engineering operator group, with the LD audit log as the record of list changes (plan R16); provision the prod SDK key on the chat Railway service (feat-231 is complete — prod sign-in is verified).
7. Log every gate decision for a signed-in user — grants AND denials — with a fixed non-PII outcome code (`granted | kill_switch | ld_unavailable | not_targeted | no_email`) in the existing `[seeker-proxy] event=...` plain-string format (plan R15). Grant lines double as seeker-vs-stub provenance for dogfood feedback, the per-user volume signal, and delist-propagation confirmation.

## Constraints

- Fail closed at the mechanism level: any LaunchDarkly failure (no key, timeout, non-boolean variation) resolves to stub, and chat's deployed wiring must WITHHOLD the seeker flag's `localOverrideEnv` from the client's local fallback (local-dev-only affordance) — a deliberate divergence from `apps/web/src/lib/feature-flags.ts`, which passes its overrides into `localEnv` unconditionally. Otherwise a leftover override converts LD failure into seeker-for-everyone. No path where an error grants seeker.
- Rollout ordering: production `SEEKER_CHAT_ENABLED` + Mastra vars stay unset until the gated build is live with its deny path verified, and are unset again before any rollback to a pre-gate build. The flip owner re-runs the exposure check in `docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md` (this feature supplies the inbound-auth prerequisite; the rate-cap deferral is the plan's documented owner decision, compensated by the R15 grant log).
- The production flip is additionally blocked on confirming `email_verified` trustworthiness across apps/auth signup and migration paths (plan Open blockers; email uniqueness is already confirmed via `@@unique([email])`).
- Keep `SEEKER_CHAT_ENABLED` as the composed coarse kill switch — do not retire it.
- No UI changes (no request-access flow, no which-agent badge). No rate/concurrency cap (stays a documented open prerequisite for wider audiences). No session revocation or membership-gate build.
- New env vars must be `.optional()` — required-at-boot vars brick Railway deploys for unprovisioned environments.
- Identity-only claims — the gate reads the existing session cookie; no new scopes, no auth-app changes.

## Verification

- Unit: gate matrix on the route — anonymous / signed-in untargeted / signed-in targeted / email-less or unverified-email identity / kill switch off / LD unavailable / seeker-granting override set in deployed mode → only the targeted signed-in case reaches the seeker upstream.
- Local: chat auth configured against local apps/auth + a signed-in email-bearing session + `localOverrideEnv` set → seeker on localhost with no LaunchDarkly account; without the signed-in session (or with the override unset) → stub.
- Pre-prod: exercise one real-LD evaluation locally (signed-in session + a real SDK key) so the email-matching contract is proven before the production flip; confirm the flag has zero targeting rules.
- Deployed (after feat-231): targeted teammate gets seeker; untargeted teammate, anonymous visitor, and a direct `curl` POST to `/api/seeker` all get stub/denial; removing the email target flips the next message to stub without a deploy (confirmed by the grant lines stopping); gate-decision log lines carry the outcome code for grants and denials.
- `pnpm --filter @forge/chat test` and `pnpm --filter @forge/chat typecheck` green.
