---
id: "feat-532"
title: "Redeem Changelog Contributor preapprovals for active accounts"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-23"
duration: 1
depends_on: ["feat-489"]
blocks: []
tags: ["auth", "changelog"]
---

## Problem

Implement JesusFilm/jfp-changelog#131, parent #128. Existing ACTIVE human
identities need individual Contributor preapproval redemption before native
website and dynamically registered MCP authorization evaluates access.

## Entry Points

- `apps/auth/src/auth/config.ts`: Google sign-in and session creation.
- `apps/auth/src/services/changelog-oauth-grant.service.ts`: authorization policy.
- `apps/auth/src/services/changelog-preapprovals.service.ts`: management contract.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: native lifecycle seam.

## What To Build

Retain verified Google exact-address evidence on the authenticating session.
Require Gmail or verified Workspace evidence, current ACTIVE HUMAN eligibility,
exact approved environment, production gate and current approver Admin authority.
Atomically redeem and issue only Contributor authority; preserve linked-method
continuity and require explicit fresh approval after revocation. Serialize with
lifecycle/grant writers. Keep existing management response contracts.

## Constraints

No new/INVITED membership activation (#132), weaker account linking, deployment,
or merge. Existing code exchange, refresh and scope ceilings remain enforced.

## Verification

Use native website/MCP and management handlers against disposable PostgreSQL,
with Google as the external test boundary. Run focused tests and typechecks during
implementation, all Auth tests once at completion, lint, formatting and two-axis
code review against initial commit `1cccac03cec7ad4427d0c6f80443dd4d71b942e0`.

## Implementation and contract

Google ID tokens are verified with Better Auth's supported verifier before
capturing their profile. The native flow retains the framework's nonce checks;
the browser callback now explicitly verifies signature, issuer, audience and
expiry as well. `validateUserInfo` carries request-local evidence into session
creation without changing account linking. Session fields are server-only,
non-input fields; existing sessions have no evidence and require Google sign-in
again to redeem. Password sessions never inherit evidence from a linked account.

The Serializable redemption transaction updates the environment coordination
row, locks recipient/session/account and approver identities, and rechecks current
eligibility, exact client resource binding and approval expiry. An authorization
conflict fails closed; a fresh attempt reevaluates everything. Grants carry only
`changelog:submit` (existing policy implies read), attached to the stable user.
All simultaneously eligible duplicate approvals are consumed together so an old
duplicate cannot restore a later revocation. No membership state is changed.

The migration adds nullable session evidence fields, a paired-field constraint,
and an exact-address lookup index. Apply it before deploying the Auth runtime.
No management transport changes: `redeemedAt` and `redeemedById` are populated
atomically with `state: "redeemed"`; Contributor listing returns the same user id.
History survives Contributor revocation and approver authority loss. A fresh
explicit approval can be redeemed at another qualifying authorization.

## Review

Standards and Spec axes reviewed sequentially per repository tool mapping,
against starting commit `1cccac03cec7ad4427d0c6f80443dd4d71b942e0` and issue #131.
No unresolved findings. Review tightened expiry checks after lock waits and
checked OAuth client resource binding inside the transaction. The repository
has no `docs/agents/issue-tracker.md`; the supplied GitHub issue was read with
`gh` directly. The invoked review skill's setup suggestion is
`/setup-matt-pocock-skills` for future issue-tracker discovery.

Compound evaluation: no separate solution document; the request-local evidence
boundary and lock/snapshot reasoning are captured in implementation comments,
this ticket and native persistence regressions.

## Verification results

- All 651 Auth tests passed in 55 files against disposable PostgreSQL 18,
  with all migrations applied from an empty database. This includes 38 native
  Changelog lifecycle tests and preserved code-exchange, refresh, scope-ceiling,
  production gate, membership and account-linking coverage.
- Auth typecheck, lint, changed-file formatting and `git diff --check` passed.
- Full-suite command: `AUTH_TEST_DATABASE_URL=<disposable-url> BETTER_AUTH_SECRET=<one-shared-test-secret> pnpm --filter @forge/auth test -- --no-file-parallelism`.
  One secret is required across integration files sharing JWKS persistence;
  their per-file defaults differ. The first full run exposed this harness
  configuration and route mocks missing session IDs; both were corrected.
- Google endpoints are replaced by signed test tokens and a test JWKS. Tests
  exercise real Better Auth browser callback and native sign-in, OAuth handlers,
  management handlers and PostgreSQL; no live Google account is involved.
- Deliberate PostgreSQL failures prove transaction rollback, serialization
  conflicts, concurrent suspension/cancellation and duplicate-approval safety.
- No deployment, merge, production data mutation or membership activation.
