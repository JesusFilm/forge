# RAG portal admission implementation and verification

## Scope and findings

The RAG HTTP service already serves `/v1/search` through bearer-token source
scope and has no portal session path. The consumer registry foundation is
isolated in `consumer_private`, so this slice adds no registry call or
management method. Portal admission uses a separate Hono route group. The
allowlist starts empty because no live account and repository permission can be
asserted from this development environment.

The allowlist stores reviewed GitHub handles together with stable numeric IDs.
The CI validator emits a receipt containing the candidate SHA, normalized
entries and three explicit predicates: account existence, handle-to-ID binding,
and current Forge repository `write`/`maintain`/`admin` permission. Syntax,
case-insensitive duplicate handles and duplicate IDs fail before network
lookup. Known inadequate permission fails. Missing review token, private
visibility, rate limit, incomplete response or network error is `unverified`
and fails the job. The job is gated on changes to
`apps/rag/portal/users.json` and feeds the required `ci-gate` check.

At runtime, each login and protected action requests the merged `main` SHA and
allowlist contents pinned to that SHA. GitHub response dates older than one
minute, unavailable reads, and failed current identity or permission checks
deny the action. There is no local admission cache. OAuth state is one-use and
bound to a separate browser cookie. Session tokens are random, stored only as
SHA-256 hashes in `portal_private`, expire after two hours, and are deleted at
sign-out. Both cookies are Secure, HttpOnly, SameSite=Lax and host-only.
Sign-out requires the configured origin. `/portal` returns only the verified
login and numeric ID with no-store headers. No portal route accesses consumers,
secrets, memberships or reports. `/v1` keeps its bearer path.

## Automated and local verification

- `pnpm --filter @forge/rag test`: passed, 112 files / 878 tests; three
  environment-dependent tests skipped. An existing subprocess test exceeded
  Vitest's default five-second limit on loaded runs, so its timeout was
  raised to 15 seconds without changing assertions; the complete suite then
  passed.
- Portal-specific Vitest: eleven tests passed for syntax/duplicate/eligibility
  receipts, synthetic login, premerge denial, next-action removal, state
  mismatch/replay, callback tampering, session fixation, sign-out origin,
  reassigned ID, unavailable and stale publication, and absent management
  routes.
- `pnpm --filter @forge/rag typecheck`, `lint`, `depcruise`, and targeted
  Prettier checks passed.
- `pnpm --filter @forge/rag db:schema:check` passed (nine tests). Migration
  from zero and `db:drift:check` passed against disposable PostgreSQL 18. The
  full `db:verify` passed 34 tests, including the new session integration test. The latter proves one-use state, session expiry and
  revocation against PostgreSQL.
- A separate local `portal_verifier` role with only schema usage and
  SELECT/INSERT/DELETE on portal tables could insert/delete OAuth state and
  read sessions; a read of `consumer_private.consumers` was denied by Postgres.
- Running the CI validator on the currently empty allowlist emitted a SHA,
  normalized empty entry list, exact predicate names and `pass` (vacuous: no
  engineer admitted). No live GitHub eligibility was claimed.
- No admin GraphQL schema or `rag-contracts` HTTP contract changed; GraphQL
  generation and contract drift checks were not applicable.

## Operator verification still required

A real nonproduction OAuth client, exact HTTPS callback host, permission-bearing
GitHub tokens, restricted session role, nonproduction Railway target and browser
are not available in this PR environment. Follow
`apps/rag/portal/README.md`: real login and denial, restart persistence,
merged-revision addition/removal propagation, GitHub outage, cookie behavior and
redacted browser/Railway log review remain unverified. Do not activate the
feature until those checks pass. No production OAuth app, Railway setting,
repository setting, credential or production data was changed.

## Limits

The GitHub API can prove the response SHA and HTTP freshness at the time of a
request; it cannot provide an independent guarantee against an internally stale
GitHub replica. The service fails closed on missing, old or unavailable
responses. The path-specific CI check depends on a review token with private
Forge collaborator-permission visibility before a nonempty allowlist PR can
pass. The new session schema needs an operator-provisioned least-privilege role
before the portal is enabled. This is an admission proof only; the broader
consumer lifecycle remains in progress.
