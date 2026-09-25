---
id: "feat-527"
title: "Implement formal RAG consumer access lifecycle"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 5
depends_on: ["feat-526", "feat-518"]
blocks: ["feat-528"]
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
Supply the same backend to the pre-portal dogfood harness; the full UI remains
feat-530 after dogfood. Deliver the migration runbook; cutoff waits for feat-529
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

**Next work remains feat-527:** implement the backend that lets an admitted
GitHub user create a consumer directly. The server derives its initial owner
from the authenticated GitHub account, applies an explicit source grant, mints
a random API credential, stores only its verifier and returns the secret once.
Then implement current-credential authentication for `/v1`, owner-controlled
membership and rotation, suspension/revocation, restricted audit and the
privilege boundaries in plan sections A/B. Use reviewable PR slices if needed;
do not mark feat-527 complete until the lifecycle and plan E verification are
delivered. Usage aggregates belong to feat-528, operational dogfood to feat-529,
and the full management UI to feat-530. The existing `/portal` identity page
does not create a consumer or issue a key.

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
credentials are outside this slice; reports belong to feat-528. The production
OAuth, token, isolated session role and Railway setup are now in place. The
allowlisted login, sign-out and unlisted denial browser checks passed; the
remaining operational checks are listed in the admission evidence.
