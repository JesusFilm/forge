---
id: "feat-527"
title: "Implement formal RAG consumer access lifecycle"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 5
depends_on: ["feat-526", "feat-518"]
blocks: ["feat-528", "feat-530"]
tags: ["rag", "auth", "observability"]
---

## Problem

Formal consumer identity and independently verified usage visibility are needed
before retiring shared-token access. Planning completion is not implementation.

## Entry Points — Read These First

1. [Implementation plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md).
2. `apps/rag/src/serving/http/auth.ts` and `app.ts` — auth and counting boundary.
3. `apps/rag/scripts/serve.ts` — dependency composition.
4. `apps/rag/prisma/schema.prisma` — separate metadata schema and roles.
5. `apps/rag/docs/ops/environment-and-secrets.md` — legacy operations; this plan replaces overlap rotation.

## Grep These

`TokenRegistry`, `lookupScope`, `resolveScope`, `createApp`, `SERVE_BEARER_TOKENS`.

## What To Build

Implement plan sections A, B and D: a repository portal-user allowlist changed
through normal PRs, safe contributor/read-write CI validation with explicit
unverified coverage, and trusted merged admission for GitHub OAuth. CI validates
portal admission entries, never runtime consumer ownership. No special approver.

Build authenticated direct consumer creation with globally unique `^[a-z0-9-]+$`
name, server-derived initial owner, random secret returned once and verifier-only
storage. Consumer memberships live in the database. Only existing owners may
Add member from the current allowlist; added members can manage/regenerate.
Retain at least one owner, transaction/version checks and restricted audit.

Provide stable identity, explicit server-authorized source scope,
immediate atomic rotation, suspension/revocation and isolated metadata privileges.
Supply the backend for feat-530 management UI development and local user-flow
verification next. Deliver the migration runbook; cutoff waits for feat-529
and separate production authorization.

## Constraints

No plaintext persistence/re-reveal, consumer-registration PRs, Git-backed consumer
owner lists, cross-app imports, corpus writes or implicit usage enforcement.
No raw query, IP, corpus, token/selector or production evidence in records.
Resolve allowlist publication, account binding and safe CI coverage before activation.

## Verification

Execute plan E, including allowlist before/after merge, removed-user sessions,
all-consumer visibility versus owner-only mutations, direct creation/name races,
initial-owner tampering, allowed-member selection, last-owner concurrency,
rotation/revocation, secret-response loss and audit leakage. Run RAG tests,
typecheck, lint, depcruise and isolated DB role/integration checks; contract drift
if changed. Complete only this deliverable, not future dogfood/cutoff or UI.

## Delivered slices and next implementation

Merged [#2397](https://github.com/JesusFilm/forge/pull/2397) implements the
isolated consumer registry schema and repository foundation. Merged
[#2416](https://github.com/JesusFilm/forge/pull/2416) implements portal
admission, and [#2423](https://github.com/JesusFilm/forge/pull/2423) adds the
first approved portal user. Production operator setup and the browser checks
recorded in the [portal admission evidence](evidence/feat-527/portal-admission-slice.md)
establish admission, not consumer creation. The
[Foundation report](evidence/feat-527/consumer-registry-foundation.md) records the
schema/API decisions and disposable database verification.

**Next delivery:** merge the reviewed backend slice with live verification gaps
recorded, then build feat-530's management UI locally against a local database.
Use that UI to exercise creation, membership, credentials and lifecycle behavior
and fix integration issues. No production test consumers or pre-UI API harness
are required. The backend and UI verification are distinct milestones; keep this
ticket in progress until its deferred end-to-end checks have evidence.
Feat-528 adds usage visibility; feat-529 handles actual dogfood and cutoff after
the management flow is usable.

## V1 simplification resolution

The registry in [#2397](https://github.com/JesusFilm/forge/pull/2397) now models
exactly one runtime environment per consumer; there is no staging environment.
Source grants and lifecycle state belong to the consumer, and daily usage keys
reference it directly. Credentials, auth context, portal routes and reports must
use consumer identity without an environment selector. GitHub admission,
ownership and secret generation/hash/atomic rotation requirements are unchanged.
See the [implementation and verification report](../../plans/2026-09-23-consumer-single-environment.md).
This simplification is complete; the broader lifecycle ticket remains in progress.

## Portal admission slice

`apps/rag/portal/README.md` documents the repository allowlist, path-specific
eligibility CI, merged-revision OAuth admission and protected identity proof.
The broader consumer lifecycle remains in progress: creation, membership and
credentials are outside this admission slice; reports belong to feat-528. The
production OAuth, token, isolated session role and Railway setup are now in
place. The allowlisted login, sign-out and unlisted denial browser checks passed;
the remaining operational checks are listed in the admission evidence.

## Consumer lifecycle backend

[#2435](https://github.com/JesusFilm/forge/pull/2435) proposes the authenticated
`/portal/consumers` backend with direct creation,
owner membership, one-time credential issuance and rotation, suspension and
terminal revocation. Registered `/v1/search` credentials use the restricted
auth reader and current database state on every request. The
[migration runbook](../../../apps/rag/docs/ops/consumer-access-migration.md)
defines additive rollout, separate roles, source policy, legacy grace and
rollback. Management UI work is next under feat-530, with end-to-end checks deferred to
local UI development. Restricted consumer roles and source configuration are
required before activation; incomplete live verification does not block merging
this backend slice. Production admission above is already delivered.
