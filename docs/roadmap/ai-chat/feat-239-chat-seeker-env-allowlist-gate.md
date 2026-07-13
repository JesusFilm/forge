---
id: "feat-239"
title: "Replace the chat seeker LaunchDarkly gate with an env-var email allowlist"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on:
  - "feat-233"
blocks:
  - "feat-236"
tags:
  - "web"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-08 via [PR #1498](https://github.com/JesusFilm/forge/pull/1498) (`feat(ai-chat): replace chat seeker LaunchDarkly gate with env-var email allowlist (feat-239)`).

**What landed.** The swap shipped exactly as scoped: membership moved to the `SEEKER_ALLOWED_EMAILS` env CSV (normalized both sides, fail-closed on unset/empty), outcomes collapsed to `granted | kill_switch | not_allowlisted | no_email`, and the feat-236 keep-list held — `booleanVariationDetail` + suite survive in `@forge/feature-flags` re-fixtured onto `watchPlayerMigration`, the `emailVerified` threading and kill switch untouched. An independent fresh-session review passed implementation, docs, and security with no blockers; its four findings (feat-233 supersession note, removal-recipe exemplar note, whitespace-only allowlist test, comment reflow) are in the PR. This ticket's ID coincidentally duplicates the platform lane's `feat-239` hotfix ticket that landed on main in parallel — acceptable per this lane's cross-lane-duplicate rule.

**Compound docs.** None new — the two feat-233 learnings were refreshed in place instead (exemplar-status notes on `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md` and `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`).

**Residual risk / follow-ups.** The flip itself remains operator work (What To Build step 6), including the carried-over `email_verified` trustworthiness blocker. Delist now costs a Railway env edit + redeploy; the 8h session-snapshot residual (R13) and the absent `/api/seeker` rate cap are unchanged pre-existing accepted risks. Phase-end removal stays [feat-236](feat-236-chat-remove-seeker-dogfood-gate.md), re-pointed at this mechanism.

**Unblocked.** [feat-236](feat-236-chat-remove-seeker-dogfood-gate.md)'s `depends_on` edge on this ticket is satisfied (it still awaits the phase-end decision and its step-0 rate cap).

## Amendment (2026-07-13)

The Constraints entry below stating that rule-based gating or widening
"requires session revocation + a membership gate first" is superseded on the
revocation half: feat-240 dropped the session-lease/revocation design by
decision (see the Decision Record in
[feat-240](feat-240-chat-sign-out-force-login.md)). The membership-gate
requirement stands unchanged; revocation is deliberately not required —
accepted for an 8h cookie whose only power is reading the holder's own
conversation history; revisit if the session gets longer or the cookie starts
gating more than that. The body below is the unmodified historical record.

## Problem

feat-233 gated the real seeker agent behind a per-user LaunchDarkly
individual-target flag; its production flip never happened (feat-233's
"Operational tail" is still pending). Owner decision (jian wei, 2026-07-08):
we are moving away from LaunchDarkly for this gate. The membership source
becomes a plain Railway env var — `SEEKER_ALLOWED_EMAILS`, a CSV of allowed
emails — keeping every other layer of the gate exactly as feat-233 shipped it
(kill switch, signed-in verified email, normalized-email keying, R15 outcome
logging, `gate_denied` framing, fail-closed default).

Operational consequences of the swap, recorded for whoever operates it: list
changes ride a Railway env edit + service restart instead of an instant
no-deploy LD flip; Railway's env history replaces the LD audit log of list
changes; the gate loses its only external runtime dependency, so
`ld_unavailable` ceases to exist (unset/empty allowlist = deny-all is the
whole failure model).

## Entry Points — Read These First

1. `apps/chat/src/lib/seeker-gate.ts` — the decision helper. The LD evaluation
   arm is replaced by an injectable `isEmailAllowed` membership check; the
   outcome union drops `not_targeted`/`ld_unavailable` for `not_allowlisted`.
2. `apps/chat/src/config/env.ts` — `SEEKER_ALLOWED_EMAILS` (optional zod
   string) + `isSeekerEmailAllowed()` (CSV parse, trim+lowercase both sides,
   fail-closed on unset/empty). `LAUNCHDARKLY_SDK_KEY` +
   `FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT` are gone.
3. `apps/chat/src/lib/feature-flags.ts` — DELETED (chat's LD client; the gate
   was its only consumer).
4. `packages/feature-flags/src/registry.ts` — the `chatSeekerDogfood` entry is
   gone; `booleanVariationDetail` and its suite STAY (shared infrastructure,
   feat-236 keep-list) re-fixtured onto `watchPlayerMigration`.
5. `apps/chat/src/app/api/seeker/route.ts` + `src/app/page.tsx` — call sites
   unchanged mechanically (same `resolveSeekerGate` signature and
   `SeekerGateDecision` shape); headers/comments re-worded.

## Grep These

- `SEEKER_ALLOWED_EMAILS|isSeekerEmailAllowed|not_allowlisted` — the new
  mechanism's full footprint.
- `chatSeekerDogfood|FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT|createChatFeatureFlagClient`
  — must be empty after this lands (LAUNCHDARKLY_SDK_KEY remains in apps/web,
  which keeps its own LD flags).
- `resolveSeekerGate|gate_denied` — the unchanged enforcement surface.

## What To Build

1. `apps/chat/src/config/env.ts`: drop the two LD vars; add
   `SEEKER_ALLOWED_EMAILS` (`.optional()`, empty-string → undefined) and
   `isSeekerEmailAllowed(email)` — CSV split, trim+lowercase entries AND
   input, empty entries filtered, unset/empty → false.
2. Rewrite `seeker-gate.ts`: same flow and signature; membership check
   replaces flag evaluation; logged outcomes become
   `granted | kill_switch | not_allowlisted | no_email` (log line format
   unchanged minus the `source=` suffix).
3. Delete `lib/feature-flags.ts` + test; drop `@forge/feature-flags` from
   `apps/chat/package.json` (+ lockfile regen).
4. `packages/feature-flags`: remove the `chatSeekerDogfood` registry entry;
   re-fixture the `booleanVariationDetail` suite onto `watchPlayerMigration`
   (the suite itself is keep-list — do NOT delete it).
5. Compile-forced cleanups: the route deny-matrix test loses the
   `not_targeted`/`ld_unavailable` cases; `.env.example`, `apps/chat/CLAUDE.md`,
   `CONCEPTS.md` "Seeker Dogfood Gate", `identity.ts`/`page.tsx`/`route.ts`
   comment amendments.
6. Operator work at flip time (not claimable from the merged PR): set
   `SEEKER_ALLOWED_EMAILS` on the Railway chat service alongside
   `SEEKER_CHAT_ENABLED=true` + the Mastra vars; archive the never-flipped
   `forge.chat.seekerDogfood` LD flag and disband the R16 targeting write
   group if they were provisioned; confirm `LAUNCHDARKLY_SDK_KEY` was never
   set on the chat service (feat-233's flip did not happen, so likely nothing
   to remove). The feat-233 pre-flip blocker carries over unchanged: confirm
   `email_verified` trustworthiness across apps/auth signup and migration
   paths BEFORE the flip (feat-233 plan, Open blockers).

## Constraints

- The feat-236 keep-list is binding here too: `booleanVariationDetail` (+
  suite) in `packages/feature-flags`, the `emailVerified` claim threading, and
  `SEEKER_CHAT_ENABLED` all survive.
- Fail-closed stays structural: unset/empty allowlist admits no one; no path
  where a parse problem grants seeker. No new required-at-boot env vars.
- Same audience boundary as feat-233 (R13): internal staff dogfooders only,
  named individuals only. Rule-based gating or widening still requires session
  revocation + a membership gate first — the env var does not change that.
- Delist latency: an env edit restarts the service (Railway redeploys on env
  change); within a running process the 8h session-cookie snapshot residual
  from feat-233 is unchanged.
- feat-236 (the removal recipe) must be re-pointed at this mechanism in the
  same change — its LD-specific delete list is stale otherwise.

## Verification

- `grep -rn "chatSeekerDogfood\|FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT\|createChatFeatureFlagClient" apps/chat packages/feature-flags` → empty.
- `grep -rn "LAUNCHDARKLY" apps/chat` → empty (web untouched).
- `pnpm --filter @forge/chat test|typecheck|lint` green;
  `pnpm --filter @forge/feature-flags test|typecheck|lint` green with the
  `booleanVariationDetail` suite intact.
- Gate matrix (unit): anonymous / kill switch off / no or unverified email /
  unlisted email / listed-but-raw-cased email → only the listed, verified,
  signed-in case grants; every deny still emits one `gate_denied` frame and
  the upstream fetch is never issued.
- Local walk: `.env.local` with `SEEKER_CHAT_ENABLED=true`, Mastra vars, chat
  auth configured, signed-in verified session, own email in
  `SEEKER_ALLOWED_EMAILS` → seeker replies; remove the email → stub on the
  next message (after restart).
