---
id: "feat-548"
title: "Qualify ChatGPT and Codex through the full review loop"
owner: "tataihono"
priority: "P1"
status: "blocked"
readiness: "ready-for-agent"
start_date: "2026-09-23"
duration: 3
depends_on: ["feat-547"]
blocks: []
tags: ["manager", "ai-pipeline"]
---

## Problem

Prove the complete experience in each supported client and publish an actionable onboarding and release checklist tied to observed behavior.

## What To Build

Approved acceptance criteria:

- [ ] For both ChatGPT and Codex, record exact client/version, connection/auth steps, environment, and grants; demonstrate discovery/create/edit/render/inspection/handoff/revision.
- [ ] Each client resumes after a disconnect, handles an expired media capability, and reconciles an intervening human edit without duplicate effects.
- [x] Demonstrate approved-existing-voice narration and correction/reuse behavior with disclosed fake versus real provider evidence; obtain explicit authorization before any paid qualification.
- [x] Record output-ready, evidence-ready, inspection-complete, and repair timings separately with short duration, cut count, network/worker conditions, and warm/cold state.
- [ ] Prove humans can review and approve the intended exact result while agents remain unable to approve or publish. Publishing a real public video is not required for qualification.
- [ ] Document supported inspection modalities for each client; do not replace real-client proof with a generic JSON-RPC probe.
- [x] Run scope-appropriate formatting, tests, type/build/schema drift checks, code review, and changed-UI load verification. Capture durable implementation learnings.
- [x] Prepare normal PR-to-main deployment, required OAuth/configuration/migration steps, renderer release requirements if changed, rollback and smoke checks. No local-code production shortcut.
- [x] Keep acceptance incomplete if a required client is unavailable; record the exact remaining step without claiming both clients work.

## Verification

Test boundary:

Two real-client end-to-end runs plus repository checks and review; explicit release evidence.

Read actual package scripts before running targeted Vitest/DB tests, typechecks, lint and formatting. Use only guarded loopback databases and fake paid providers. Regenerate Admin SDL and admin-graphql together if Pothos changes. Record real-client evidence separately from transport probes.

## Constraints

Preserve expected-revision and idempotency semantics, human edits, scoped OAuth authority, and exact-render human approval. No paid provider calls, deployment, agent publication, automatic wakeups, or editor comments.

## Entry Points — Read These First

1. `docs/validation/studio-feedback/README.md`
2. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`

See `docs/plans/2026-09-23-studio-external-agent/spec.md` and `code-map.md` for the complete approved scope.

## Grep These

- `authenticateStudioMcp|studioServiceCall|expectedRevision`
- `narrationReserve|render-review|idempotencyKey`

## Final integration assessment — 2026-09-23

Actual Codex completed creation/render/inspection/revision, preserved an attributed synthetic human edit, resumed after local credential expiry, corrected narration once and reused unchanged audio without consuming a pass. Required actual Claude and authenticated operator review/approval plus reachable-test OAuth qualification remain unavailable. Direct HTTP media download failed in this read-only client configuration; MCP refresh/images and a separate backend expiry probe are evidenced distinctly. Both rebuilt renderer image targets passed local execution; hosted dedicated-VM checks remain a release gate. No paid call, production deployment or merge occurred.

## Qualification scope update — 2026-09-30

The owner authorized immediate qualification with ChatGPT and Codex instead of
Claude. Claude qualification is deferred to the designer who has access; no
ChatGPT result establishes Claude compatibility. The owner also authorized a
temporary synthetic operator browser session and Cloudflare Tunnel access to
the isolated local fixture environment. Paid provider calls and production
deployment/merge remain outside this authorization.

The protected review tunnel serves the authenticated draft and exact MP4; its
bytes match the recorded render. Chrome blocked exact-draft navigation after
loading the authenticated project list. Actual ChatGPT discovered the real
OAuth endpoints. After the owner approved connection creation and test-account
login/consent, ChatGPT redirected to actual Auth with PKCE and the approved
resource/scopes. Chrome blocked the navigation following login submission with
`ERR_BLOCKED_BY_CLIENT`; the owner must clear that browser block before consent
and the client workflow can be observed. The web MCP connection does not itself
install the portable skill; native installation and manual context loading must
be qualified separately.
The authorize-resource and missing-renewal-scope defects found during setup were
fixed and tested, including two consecutive installed-provider refreshes.
Actual ChatGPT workflow, browser correction/approval and hosted release gates
remain incomplete. See the September 30 qualification evidence.

## Dedicated production ChatGPT client — 2026-10-01

The normal Auth seed now defines `jfp_shorts_mcp_chatgpt` as a separate public
web client with the exact ChatGPT callback, required PKCE, authorization-code
and refresh grants, narrow Shorts scopes and normal consent. Shared Shorts
resource ceilings and existing Manager callbacks remain unchanged. No user
grants or Operator memberships are created. The installed-provider contract
proves repeat seeding, consent without a human AppGrant, denied redirect/PKCE/
scope/resource violations, and no premature access token. Actual client and
human-review qualification remain open after deployment.

Setup: `apps/manager/docs/shorts-chatgpt-production.md`. The earlier authenticated
API-registration proposal is no longer necessary once this seed is deployed.

Validation: 619 Auth unit tests passed (106 opt-in database skips), all ten
installed-provider tests passed against a new isolated database, and Auth
Prisma generation, typecheck, lint and touched-file formatting passed. Existing
client/operator gates keep this ticket blocked; the seeded client is not proof
of an actual ChatGPT connection.

## Production release progress — 2026-09-30

The later owner request authorized normal PR-to-main production release. The
September 23 no-merge statement and September 30 tunnel-only authorization above
remain historical evidence; they do not describe the later release state.
[PR #2405](https://github.com/JesusFilm/forge/pull/2405) merged at 11:14:15 UTC,
followed by successful hosted image publication from main. Verified acquisition
and inactive VM selection completed. The sealed-image synthetic fixture passed
independent decoding and resource/retirement checks, and explicit supervisor
activation succeeded. Post-activation VM health confirmed an enabled, idle,
active supervisor on the exact new image digests, without restart or pending
release/drain markers. Manager and Auth run `8890beaf1`; Admin runs descendant
`99554c8b` with all four Shorts migrations complete. Health, codecs, signing,
signed queue reads and the public skill ZIP passed post-start verification.
See [production release evidence](../../validation/studio-external-agent/production-release-2026-09-30.md)
for immutable artifacts, backup and migration validation.

The ticket remains blocked on actual ChatGPT OAuth/conversation and human
exact-render correction/approval, rather than production deployment. Actual Codex
creation/render/inspection/revision evidence remains valid with its recorded
synthetic-bearer/provider and modality limits; this release does not erase or
upgrade that evidence. ChatGPT replaces Claude in immediate acceptance at the
owner's request; designer-led Claude qualification is deferred separately.

The separate consented public client in
[PR #2524](https://github.com/JesusFilm/forge/pull/2524) is deployed and verified,
with no user grants. Native ChatGPT skill upload succeeded and the editor lists
all nine packaged files. The production MCP form is prepared, but automatic
approval review requires explicit user approval before Create can proceed.
Personal login/consent, current Operator checks, actual skill invocation and
client/human-review qualification remain open. The existing Manager callback and
anonymous native-loopback DCR policy are unchanged.
