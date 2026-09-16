---
title: "J011 RAG consumer access discovery and implementation handoff"
date: "2026-09-17"
status: complete
module: "apps/rag"
tags: ["rag", "auth", "postgresql", "usage", "discovery"]
problem_type: "implementation_readiness"
---

# RAG consumer access discovery evidence

## Outcome, scope and provenance

Discovery is complete. All five areas have implementation handoffs, and Jaco's
latest decision resolves the remaining approval-policy question through **option
B**: retain the narrow enforcement gap under feat-512. Existing native rules and
repository CI do not establish reliable enforcement of exactly one non-author
approval only for consumer-registry/allowlist changes. This is not a claim that
GitHub could never support a purpose-built solution, or that enforcement is
configured. No approval requirement or repository setting was changed.

### Accepted continuation decisions (September 17; latest answer takes precedence)

- Review policy: any valid approval from someone other than the PR author counts;
  no senior-only, named-account, team or CODEOWNER restriction. The additional
  approval applies only when the PR changes the consumer-registry/allowlist area.
  Do not require approval on other RAG or Forge PRs, or exclude the latest pusher
  merely for pushing when that person is not the PR author.
- The earlier Jaco/Tatai/Jian Wei reviewer roster is historical context, not an
  enforcement allowlist. **Jaco alone remains recovery authority**; neither Tatai
  nor Jian Wei gains recovery delegation. Portal membership remains separately
  allowlisted; permission to approve a PR does not grant portal or report access.
- Investigate path-specific enforcement first; if exact reliable enforcement
  cannot be established, use option B and assign the gap to later implementation.
  That fallback is now selected, so it is not an unresolved discovery decision.
  Section 1 records the native options, current settings and bounded handoff.
- Portal option A: internal GitHub authentication, matching both an allowlisted
  GitHub account and a verified email in the same registry entry; multiple
  authorized engineers may manage an integration. This supersedes the earlier
  Google/Forge Auth recommendation in the unchanged programme-planning PR.
- Report option A: register RAGBot as an ordinary consumer first, then provide
  aggregate request counts/activity through a narrow internal read-only tool.
  Jaco and RAGBot alone may view aggregate consumer usage. Reports never mean
  query results. Transport/provisioning owner are implementation details, not
  another product decision or a production permission grant.

- Parent: draft [PR #2304](https://github.com/JesusFilm/forge/pull/2304), branch
  `docs/rag-consumer-access-usage-plan`, head
  `e5b22f7235385ee67d0e9aeda54916b8394408e3`, observed open on 2026-09-16.
- Discovery branch: `docs/rag-consumer-access-discovery`, stacked on that exact
  head. The parent owns the programme and original ticket; this PR owns this
  evidence, discovery ticket/index updates and necessary feat-512/515 handoffs. No parent branch or PR edit.
  After the parent lands, rebase only discovery commits onto main and retarget;
  do not merge discovery into the parent as an evidence-delivery shortcut.
- Main at inspection: `19b8f062e0b62b84e14882fc828166998265a2da`.
  Compared the cited RAG files, Chat auth directory, Auth config and seed entry
  points, and CI workflow against main. Only the inspected Auth seed script
  differed (Manager backend scope additions), unrelated to the portal proposal.
  Evidence below is pinned to the parent revision, not a deployment inventory.
- Read root/lane/RAG guides, `CONCEPTS.md`, the programme plan, RAG role tests,
  RAG evidence precedent and credential-storage solution. No relevant unresolved
  consumer-access finding was found in `todos/`; no tracked executable
  `forge-rag-retrieve` task was found. No environment/credential files were read.
- Work loop: plan the five questions against feat-518; inspect code and read-only
  GitHub metadata; review adversarial cases; compound the findings here.
  Compound Engineering commands are unavailable in this session. No delegation.
- Boundaries: documentation only. No application edits, production/Railway calls,
  live retrieval, token generation, migrations, data/corpus changes or deployments.
  Public vendor documentation was consulted only to verify underlying primitives.

The [approved programme](../../../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md)
remains authoritative: internal engineers initially; one integration identity with
multiple authorized managers; hash-only tokens displayed once; immediate atomic
rotation; durable aggregate usage going forward, with no retention implementation;
heavy-use visibility and conversation first; no quotas or external-consumer rate
limits. Portal design is now, delivery after dogfood. The seven-day registration
and shared-token cutoff remain a later separately approved production action.
RAGBot dogfood must use the real `forge-rag-retrieve` HTTP path.

## 1. Engineer allowlist and protected review

### Current repository and GitHub evidence

The current parent has neither `config/` nor `.github/CODEOWNERS`. There is no
consumer registry, review evaluator or approval workflow. Read-only API recheck
on September 17 returned ruleset **`Main` (`12972651`)**, targeted to the default
branch, with `deletion`, `non_fast_forward` and `pull_request` rules. The latter
has `required_approving_review_count: 0`, `required_reviewers: []`,
`require_code_owner_review: false`, `require_last_push_approval: false` and
`dismiss_stale_reviews_on_push: false`. No required-status-check rule was returned.
`required_review_thread_resolution` and squash-only are enabled; they do not
establish the desired approval gate. `bypass_actors: null` is not evidence that
privileged bypass is impossible. The earlier legacy protection API 404 is not
used as proof that no other protection exists.

The exact existing workflow is **`forge-ci`**, `.github/workflows/ci.yml`, and its
aggregate job is **`ci-gate`**. The job checks dependency results; it neither lists
PR reviews nor tests changed consumer paths. Events are `pull_request` and main
`push`, not `pull_request_review`. Its comment says main _can_ require this stable
check; current effective settings do not show that requirement. The actual
supporting jobs are `commit-lint`, `affected`, `format`, `patched-deps-guard`,
`hidden-roadmap-lanes`, `dev-port-contract`, `experiment-ledger`,
`admin-graphql-generate`, `admin-schema-drift`, `web-redis-integration`,
`auth-postgres-integration`, `rag-postgres-integration`, `lint`, `test`,
`expo-doctor` and `build`. None is the missing approval evaluator. Earlier
hypothetical RAG check names remain withdrawn; no new configured name is asserted.

Main is now `8151e5518f019d314b995ebe71cbc1ace0e19342`; comparison found no relevant
changes to `.github`, RAG, Auth config or Chat auth from the inspected source.
PR #2304 is still an open draft at `e5b22f723`; discovery resumed at `4b4531b26`.
No settings or credentials were read through production services or changed.

### Path-specific options investigated and decision

| Mechanism                                                         | Actual capability                                                                                                                        | Fit for this policy                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch/ruleset `pull_request.required_approving_review_count = 1` | Requires reviews for PRs targeting the branch; this count has no changed-path condition.                                                 | Reject: would add approvals to unrelated Forge/RAG PRs. Leave the global count unchanged.                                                                                                                           |
| Ruleset `pull_request.required_reviewers[]`                       | Each entry has `file_patterns`, `minimum_approvals`, and `reviewer: { id, type: "Team" }`. This is genuine native path-specific support. | Not an exact fit: only approval from the specified write-enabled team counts. An all-engineers team would still narrow “any non-author approval” and create membership administration. No team is selected.         |
| `require_code_owner_review` plus path-only CODEOWNERS             | Matches paths and accepts approval from an assigned owner.                                                                               | Not an exact fit: a valid non-owner approval would fail. No CODEOWNERS file or broad ownership rule is added.                                                                                                       |
| Push ruleset path restrictions                                    | Reject selected file pushes.                                                                                                             | Not an approval requirement; cannot translate into “allow with a non-author approval.”                                                                                                                              |
| Required workflow using only `on.pull_request.paths`              | Can avoid workflow execution for irrelevant files, but a skipped required workflow can remain pending and block unrelated merges.        | Reject as a shortcut. Workflow filters alone neither implement review state nor preserve unaffected PRs.                                                                                                            |
| New conditional review evaluator integrated with CI               | Could compute the exact path predicate and accept any valid non-author review while returning not-applicable success elsewhere.          | Possible later implementation, not a reliable existing control. Current CI lacks the evaluator, review events, trust boundary and merge protection; review-dismissal races and spoofable/stale statuses need proof. |

Native capabilities are documented in GitHub's
[available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
and [rules REST schema](https://docs.github.com/en/rest/repos/rules).
[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
requires designated owners. GitHub's
[workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
explains skipped required workflows and path-diff limits. Review-state events are
separate [workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_review).
These sources establish available primitives, not configured Forge enforcement.

**Select option B.** The inspected mechanisms do not reliably enforce this exact
policy as they stand. Native path-specific review exists, but its reviewer
restrictions differ; current CI has no trustworthy implementation of the exact
predicate. This is a bounded finding, not a platform-wide impossibility claim.
Jaco explicitly authorized documenting this gap for later implementation rather
than broadening approvals. Assign it to [feat-512](../../feat-512-rag-consumer-access-lifecycle.md).
No new blocker or owner question is needed to complete discovery. A later
implementation may prove a suitable custom gate without changing the policy.

### Exact bounded handoff to feat-512

The proposed registry area is the following **exact repo-relative paths**:

- `config/rag-consumer-engineers.json` — account/email registry and recovery binding.
- `config/rag-consumer-engineers.schema.json` — its validation schema.

These files do not exist yet. Do not replace the paths with `config/**`,
`apps/rag/**`, `.github/**` or all Forge files. Registry moves must carry an explicit
path migration; include old and new names when detecting renames/deletions so a
move cannot silently escape the policy. No general approval requirement for
workflow, runbook, corpus or unrelated feature changes is authorized. Protection
of the eventual evaluator itself is a separate trust-boundary design constraint;
do not solve it by silently broadening this review trigger.

Desired predicate: `touchesRegistryArea(PR) => exists valid APPROVED review whose
reviewer GitHub ID != PR author GitHub ID`. No senior/team/owner membership test;
no special latest-pusher exclusion. Use GitHub IDs, not display names. Preserve
current-head and non-dismissed review validity; comments, pending reviews and
self-approval do not count. One valid qualifying approval suffices for this
additional policy; normal existing GitHub merge restrictions still apply.

Future implementation acceptance, not claims of tests executed here:

1. Added/modified/deleted registry/schema and renames into or out of either path
   require one valid non-author approval. Other RAG and Forge paths add **zero**
   approval requirements, including mixed commits with no registry change. A mixed
   PR containing a registry change is in scope regardless of its other files.
2. Enumerate the complete changed-file set and all review pages. API failure or
   truncated enumeration cannot be treated as “unrelated.” Do not rely on the
   first 300 files of an Actions path filter as the security predicate. Prefer
   complete base/head tree comparison for overflow; fail closed if not possible.
3. Re-evaluate relevant PR open/synchronize/base changes and review submitted,
   edited/dismissed events. Use the current PR head and latest effective review
   states; reject stale/dismissed approvals. A later decisive review supersedes
   that reviewer's approval. Prove correct status invalidation when an approval
   is dismissed after a successful check, including the merge race; a webhook
   handler alone is not proof that a stale success cannot allow merge.
4. Run trusted policy code, not untrusted PR-head code with privileged permissions;
   prevent another workflow from impersonating the required result. Prove safe
   handling of forks, same-repo workflow edits, dropped/out-of-order events and
   pushes during evaluation. Do not claim polling or a one-time check eliminates
   all merge-time review races. Keep this as a gap until that trust/merge binding
   is demonstrated in an authorized disposable/test setting.
5. If a required CI result is eventually used, it must report an explicit
   not-applicable success for unrelated PRs rather than a permanently pending
   path-skipped check. It may add an automated check, **not a human review wait**,
   to those PRs. Measure the unaffected path as a fast no-op. Preserve unrelated
   native review requirements exactly as configured; do not enable a global
   minimum review count, global last-push approval, or broad CODEOWNERS fallback.
6. Prove positive/negative cases with author versus non-author, non-senior and
   non-team reviewers, stale/dismissed approvals, 300+ changed files, renames,
   unreadable file/review pages, review-after-check and unaffected RAG/Forge PRs.
   Record the eventual exact evaluator/check/rule name and bypass posture only
   after implementation verification. Do not invent them in discovery.

Do not treat the registry as mechanically protected before this work passes.
feat-512 owns the enforcement gap and its validation before access activation;
if a reliable implementation still cannot satisfy the exact predicate, retain
option B openly and report it in that implementation's release review. Never
weaken the reviewer predicate or broaden paths as an automatic fallback.

### Registry schema and identity/recovery mapping

Keep `config/rag-consumer-engineers.json` and its strict schema:

```ts
type EngineerRegistry = {
  schemaVersion: 1
  recoveryGithubUserIds: ["219753371"] // Jaco only; not a PR reviewer allowlist
  engineers: Array<{
    engineerId: string // immutable UUID, never an integration/usage identity
    githubUserId: string // immutable numeric ID represented as a string
    githubLogin: string // current label, not the identity key
    verifiedEmails: string[] // complete reviewed addresses, same account entry
    environments: Array<"local" | "staging" | "production">
    allowedSourceKeys: string[] // explicit registered keys; no wildcard
    status: "active" | "disabled"
  }>
}
```

Reject unknown properties, duplicate/malformed IDs or normalized emails, unknown
source/environment values and wildcard/domain grants. Normalize email with trim
and lowercase; do not collapse Gmail dots/plus aliases. Proposed bounds: 100
engineers, five emails each, 254 characters/email, 39/login and 128/source key;
source arrays cannot exceed the registered inventory. A GitHub/email pairing is
reviewed under the non-author policy, not derived from commit/profile email or
name/domain similarity. No actual allowlist or private email binding is created.

Public account IDs verified on September 17: Jaco Brink `jaco-brink` = `219753371`,
Tatai `tataihono` = `802117`, Jian Wei `jianwei1` = `17999235`. These earlier named
reviewers have no exclusive reviewer status under the latest policy. Jaco alone
recovers; PR approval by anyone else does not delegate recovery, authorize portal
membership or grant reports. The earlier proposed approver-allowlist file is
withdrawn; keep recovery configuration in the bounded registry area.

The activated registry revision is an exact reviewed, merged main SHA recorded
in restricted access metadata/audit. A controlled publisher imports it only after
the implemented validation policy passes, disables removed engineers and revokes
their sessions transactionally. Management reads the active revision each action;
no fallback to an older bundled registry. Publication lag and recovery authority
are tested separately; GitHub merge time is not an invented activation timestamp.

## 2. Portal identity and multi-engineer ownership

### Reusable evidence and selected approach

`apps/auth/src/auth/config.ts` has conditional Google/Facebook/Apple provider
wiring but no GitHub provider. `apps/auth/src/domain/apps.ts` has no RAG portal
client. No existing Forge GitHub portal login can be claimed from this source.
`apps/chat/src/auth/oauth-state.ts` and `oauth-client.ts` offer state, PKCE and
bounded exchange patterns; their OIDC id-token/JWKS verifier does not validate
GitHub OAuth identity. `identity.ts`/`session-cookie.ts` explicitly describe an
8-hour snapshot unsuitable for general authorization. No cross-app imports.

Jaco selected **GitHub authentication**. Implement a RAG-owned server-side GitHub
OAuth web flow; do not silently substitute the earlier Google/Forge Auth design
or assume that adding GitHub to Forge Auth already happened. This keeps the
portal within RAG while using Forge's established session/CSRF implementation
patterns as reference. A future shared Auth integration would require proving
that it preserves the GitHub numeric account and verified-email binding.

### GitHub account and verified-email contract

Use a dedicated OAuth app registration per environment with only `read:user`
and `user:email`, no repository/org/admin or offline-access scopes. Fixed callback
`<approved-origin>/api/auth/callback/github`; exact per-environment origin and
client binding, no wildcard/preview callbacks or browser-supplied issuer/base URL.
Host selection, GitHub app registration and secret provisioning are feat-515
implementation tasks; no origin or registration is claimed to exist today.

Use authorization code flow with single-use random state, PKCE S256 and exact
redirect matching; exchange only from the backend with bounded network timeouts.
GitHub documents the [web authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
and [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
These are protocol references, not proof of a configured client.

After each exchange, use that same access token to fetch the
[authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
and all [authenticated email addresses](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user),
following pagination. Require numeric user `id` equal to an active registry
`githubUserId`, and at least one email with `verified === true` whose normalized
value is in **that same engineer's** `verifiedEmails`. `primary` alone does not
mean verified. Missing email scope, incomplete pages, API error, no verified
match or account mismatch deny login. Do not treat public profile email, Git
commit email, login spelling, an Actions OIDC token, or a browser claim as proof.
Do not join account A with allowlisted email belonging only to account B.

Persist only the restricted binding `(provider: github, githubUserId)` to
`engineerId`, matched-email reference, verification time and local session state.
A changed login cannot transfer the numeric identity; conflicting bindings require
Jaco recovery. Discard OAuth token material after callback identity checks; no
provider-token persistence/refresh is needed for this short local session.
Keep tokens, authorization codes, PKCE values and email API responses out of
logging/analytics and out of the browser. No OAuth flow or credential was exercised
by discovery; the public account-ID lookup was the only account API inspection.

### RAG management and session boundary

Keep a separate RAG management entrypoint/pools with a same-origin portal backend,
not management routes on public retrieval `/v1`. The operator-mediated dogfood
precursor calls the same lifecycle authorization using a verified GitHub session;
it is not a SQL bypass. Multiple allowlisted engineers manage one integration
through membership records below, never by becoming separate usage consumers.

Use opaque server-side sessions, hashed session secrets, HttpOnly/Secure/host-only
cookies, CSRF/origin checks on mutations, no-store management responses and no
analytics/replay on issuance pages. Proposed maximum lifetime is one hour without
silent extension; issuance/recovery requires a fresh GitHub authorization callback
and account/email API revalidation. Do not claim that an OAuth callback forces a
new GitHub password challenge. Every read/mutation checks local session status,
expiry, active registry revision, engineer binding and consumer membership plus
environment/source rights. Removal/disable is effective on the next action after
the registry revision is activated, including existing sessions.

GitHub logout, provider email removal or OAuth-grant revocation does not itself
revoke an already-issued local session. Bound that snapshot to one hour; use
local session revocation/engineer disable for immediate administrative removal.
Revalidation before issuance/recovery prevents stale provider identity from
issuing keys. Document and test the distinction in feat-515; do not advertise
instant provider-wide logout propagation. Registration owner and final host are
implementation assignments, not unresolved G2 choices or permission to provision.

`ConsumerMembership(consumerId, engineerId)` is distinct from the integration's
credential. Existing managers can add only active, mapped engineers; an invited
engineer must complete verified binding before exercising management rights.
Serialize membership/scope changes, rotations and recovery on the consumer row,
then re-read authorization and registry version inside the transaction. Prevent
removal of the last active manager; if registry removal disables all managers,
suspend management and require Jaco, the sole recovery authority, to act. Do not auto-delete
or transfer the consumer or its usage history. Audit actor/target/action/outcome,
consumer/environment, time and registry revision, never secrets or arbitrary notes.

A manager may approve or issue only source/environment rights within their own
current entitlement. Effective retrieval scope remains integration-level; any
registry entitlement reduction must transactionally intersect affected integration
grants with the union of active managers' entitlements (never auto-expand grants).
Last-manager loss requires Jaco to review the integration's continued access;
manager removal does not claim to revoke a secret already copied. Coordinate
rotation/revocation explicitly. Recovery cannot self-authorize via portal input.

## 3. Credentials, lookup, rotation and environment binding

Evidence: `apps/rag/src/serving/http/auth.ts` uses a plaintext-keyed `TokenRegistry`
and exposes scope only. `scripts/serve.ts` loads `SERVE_BEARER_TOKENS` at startup.
There is no credential lifecycle database. The older receiver-first overlap in
`apps/rag/docs/ops/environment-and-secrets.md` stays accurate for the existing
system; the approved new lifecycle deliberately replaces it. Do not rewrite that
runbook until implementation changes the actual mechanism.

Proposed registered credential format: a fixed version marker plus 32 CSPRNG
bytes encoded as canonical base64url (256 random bits), with no embedded consumer,
environment, credential ID or selector. Generation is server-side only. Restrict
header/format length before hashing; no query-string or client-ID header auth.
No credential is generated by this discovery.

Store only `SHA-256(domain || trustedEnvironment || fullToken)` as 32-byte verifier,
with fixed, unambiguous domain/version/environment separators. An indexed unique
`(environment, verifier)` lookup joins current consumer/environment/credential
state, then uses `node:crypto.timingSafeEqual` on equal-length digest buffers;
perform the same fixed-size dummy comparison on misses. A fast digest is chosen
for uniformly random high-entropy keys, not human passwords. No pepper/key
management dependency or reversible encryption is needed for this proposal.
A digest in the credential store is itself sensitive auth data, never telemetry.

The lookup is not globally constant-time: database hit/miss latency differs.
Do not claim that a constant-time comparison removes database timing or all
surrounding-code side channels; use uniform generic auth errors and never expose
an identifier that permits selecting someone else's verifier. Node documents
[random generation, hashing and timing-safe comparison](https://nodejs.org/api/crypto.html).
These primitives do not replace the state/authorization checks.

Use the receiver's immutable configured environment, checked against the database
installation environment marker, never a caller parameter. A staging database
copy must not authenticate production credentials: both receiver/db mismatch and
cross-environment lookup fail closed. No positive auth cache in V1. Auth-store
outage returns generic service unavailable; it must never retry as legacy auth.
A distinct registered-token marker selects that path even on lookup failure;
legacy compatibility is a separately enabled, clearly unattributed path only
during the later approved grace period. Existing scope intersection, empty 200,
body limit and public health semantics remain unchanged.

Rotation transaction (initial issue uses expected version 0):

1. Authorize verified session/manager/entitlements and expected credential version;
   lock consumer then environment in deterministic order. Recheck authorization
   after locks, including active registry version and current consumer state.
2. Generate replacement in process memory, compute verifier, revoke old active
   row, insert replacement, increment environment credential version, append
   bounded audit and commit together. A partial unique index allows at most one
   non-revoked credential per `(consumerId, environment)`. Suspended/expired keys
   are never accepted; expiration does not bypass the single-slot constraint.
3. Reveal plaintext once only after commit in the authenticated no-store response.
   No logging, tracing, response recording, browser persistence, CLI stdout,
   audit payload, retry cache or reveal-again endpoint contains it. Other managers
   see version/status only. The UI warns replacement immediately interrupts callers.
4. A failed transaction leaves the prior key valid and reveals nothing. Concurrent
   stale versions return conflict; no silent retry rotates a winner's newly issued
   key. On response loss after commit, status reveals only that the version changed;
   the engineer explicitly rotates again. No idempotent replay of plaintext.
5. Suspend is reversible; credential revoke is terminal. Consumer revoke gates all
   environments in the same authorization state. No rollback can restore revoked
   keys or shared-token mode. A request whose authorization linearized before the
   revoke commit may finish; the next auth statement after commit must reject.

Test commit/response failure, simultaneous managers, rotate/revoke races, wrong
environment/database copy, expired credentials, malformed input, source reduction,
unknown registered token during legacy grace and DB outage. Use synthetic fixtures.

## 4. PostgreSQL, Prisma and privilege isolation

### Why another schema is necessary

`apps/rag/prisma/schema.prisma` models corpus/cache/staging/audit tables without
multi-schema declarations. `src/main.ts` constructs one Prisma client and wires
both search and write adapters; the HTTP handler only uses retrieval. This is
code composition, not proof of the deployed database role.

`scripts/provision-readonly.ts` grants `forge_rag_readonly` SELECT on **all public
tables**, plus future tables through owner default privileges. Its integration
test deliberately proves future public-table visibility. Access tables in public
would therefore expose verifiers/contacts to the existing corpus/evaluation reader.
A table naming prefix or Prisma model is not isolation.

Propose schemas `rag_access`, `rag_usage`, `rag_reporting`; leave existing corpus
in `public`. Extend the existing Prisma 6.19.3 schema with explicit schema names
and `@@schema("public")` for existing models; new models map to their restricted
schema. Regenerate, never hand-edit the Prisma client. Prisma documents this
[multi-schema mapping](https://www.prisma.io/docs/orm/v6/prisma-schema/data-model/multi-schema).
Audit generated migration SQL for zero corpus relocation/drop/rebuild. Fully
qualify new raw SQL. Privilege SQL, partial indexes, report views and bounded
functions require explicit migrations and independent schema/role tests; Prisma
model visibility does not grant database privileges. Extend `check-schema-drift.ts`
with precise new expected objects, not a blanket ignore of metadata drift.

### Proposed logical schema

| Schema/model                                                  | Keys and invariants                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rag_access.RegistryRevision`, `Engineer`, `EngineerIdentity` | Active reviewed SHA/version; immutable engineer UUID and unique GitHub ID/email mapping; unique `(provider, githubUserId)`; disabled state. Restricted identities only.                                                        |
| `rag_access.Consumer`, `ConsumerEnvironment`                  | Stable UUID, approved bounded label, accountable-owner reference, bounded purpose/contact, state/times; environment PK `(consumerId, environment)`, approved source set, credential version; terminal consumer revoke.         |
| `rag_access.ConsumerMembership`, `PortalSession`              | Unique consumer/engineer pair; revocable session digest and expiry; last-manager rule enforced under transaction locks.                                                                                                        |
| `rag_access.Credential`, `LifecycleAudit`                     | Random internal row UUID, verifier/environment uniqueness, single active slot, issue/expiry/revoke/replacement/version; bounded actions/actors, append-only audit. Row ID never travels in token/report.                       |
| `rag_access.ReportPrincipal`                                  | Separate Jaco human binding and RAGBot machine capability; report-only purpose/environment/status/expiry, separate verifier namespace from retrieval keys. No manager auto-enrollment.                                         |
| `rag_usage.ConsumerDimension`, `UsageMinute`                  | Only stable consumer ID, approved label history and environment/existence times; aggregates keyed by consumer/environment/UTC minute, 64-bit requests/successes, latest admission time. No contact, credential or corpus join. |
| `rag_usage.PendingAttempt`, `CollectorEpoch`, `CoverageGap`   | Random internal attempt ID, consumer/environment/admission, collector epoch/sequence, completion state; fixed gap reason enum and interval, heartbeat and safe watermark. No request content.                                  |
| `rag_reporting` views                                         | Explicit aggregate/dimension/coverage columns only; no `SELECT *`, credential, contact, membership, pending-attempt or corpus exposure.                                                                                        |

Use nonnegative checks and `successes <= requests`. Keep minimal pending/dedup
state operational; compact resolved accounting through safe epoch/sequence
checkpointing, not a raw event archive or time-based retention policy. Durable
aggregates and gap history are kept going forward. Capacity/backup review remains
required before volume expansion; no retention/deletion implementation now.

### Proposed roles and processes

| Principal                          | Allowed                                                                                                                | Explicitly denied                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Metadata migration owner (offline) | DDL for new schemas, role grants/functions/views                                                                       | Runtime use; new authority over corpus                                              |
| Existing corpus runtime reader     | Existing corpus SELECT only                                                                                            | New schema access, verifier/contact reads, all metadata/corpus writes               |
| Access administration process      | Restricted registry/identity/consumer/member/session/credential lifecycle and audit; bounded dimension synchronization | Corpus SELECT/DML, arbitrary usage mutation, report access through membership       |
| Serving auth reader                | Narrow current-state/verifier/source projection                                                                        | Contact/session/audit reads, writes, report capability verifier                     |
| Serving usage writer               | Execute fixed admission/completion/heartbeat functions                                                                 | Table-wide writes, auth data, corpus, report views                                  |
| Usage reconciler                   | Bounded checkpoint/gap/pending reconciliation functions                                                                | Corpus/auth data, credential or consumer authority                                  |
| Report process reader              | SELECT approved aggregate/dimension/coverage views                                                                     | Any mutation, base pending tables, identities/contacts, retrieval verifiers, corpus |
| Report authentication reader       | Narrow report-principal state/verifier view                                                                            | Retrieval credentials, membership and corpus; separate from report-data pool        |

All runtime logins: non-owner, no superuser/createdb/createrole/bypassrls, no role
membership allowing escalation. Revoke PUBLIC schema creation and function
EXECUTE for new metadata objects; explicit owner-scoped default privileges.
Avoid `GRANT SELECT ON ALL TABLES` outside the existing corpus reader. No new
metadata role inherits `forge_rag_readonly`. Do not pass a broad owner URL to
serving. Separate processes prevent a public retrieval compromise from acquiring
the administration/report pools; multiple pools in one process alone do not.

For narrow `SECURITY DEFINER` functions: dedicated non-login owner with only
required metadata rights, qualified objects and fixed safe `search_path` including
`pg_temp` last, no dynamic SQL, bounded arguments, PUBLIC EXECUTE revoked in the
creation transaction, and EXECUTE only to the matching role. These precautions
follow PostgreSQL's [security-definer guidance](https://www.postgresql.org/docs/current/sql-createfunction.html).
Keep the existing corpus verifier's prohibition on callable security-definer
functions; grant these new functions only to metadata roles with explicit tests.

Tests must connect as every real restricted role to a disposable local/CI DB,
force `SET TRANSACTION READ WRITE`, and prove prohibited reads/DDL/DML still fail.
Cover future public and metadata tables/default privileges, views/functions,
role inheritance/SET ROLE, TEMP, sequences, large objects and corpus writes.
Assert report query plans cannot reach access/corpus tables and synthetic secret,
contact, IP, query and corpus sentinels never appear in reports/logs. Use the
existing `tests/readonly-role.integration.test.ts` pattern without weakening it.
Ports in `src/contracts/` and metadata adapters behind `src/main.ts` preserve
`.dependency-cruiser.cjs`; serving must not import Prisma/adapters directly.

## 5. Authenticated accounting and narrow reports

### Exact count/completion boundary

Current `src/serving/http/app.ts` applies a 16 KiB body limit before authentication,
then JSON/schema validation, source intersection and retrieval. It has no consumer
identity, usage hooks or report route. `scripts/serve.ts` currently calls
`serve({ fetch: app.fetch })`; returning a Hono Response does not prove a completed
server response. New instrumentation must bridge the Node response `finish` and
premature `close` events to the admitted attempt. Node's [HTTP event contract](https://nodejs.org/api/http.html#event-finish_2)
allows server completion evidence but does not prove client receipt.

1. Authenticate current consumer/environment and admit each actual HTTP attempt
   exactly once before JSON parsing. Use a server random internal attempt ID and
   a trusted UTC admission timestamp; atomically insert pending state and increment
   its minute request count/update last activity. Retries are separate attempts.
2. On Node `finish` with status 2xx, idempotently settle the same attempt and
   increment success in its **admission** bucket. Empty-source/empty-result 200
   qualifies. On pre-finish disconnect, 4xx or 5xx, settle without success. A
   `close` after `finish` cannot undo or double-count it. Replayed completion
   cannot create success without an admitted attempt. Bound request lifetime.
3. A crash after network finish but before durable completion is unknowable from
   the database alone: retain a coverage gap and partial success count, never
   guess success or silently declare complete. This prevents a false exactness
   claim. In-process idempotence alone does not close that crash window.
4. Pre-auth body-limit/unknown/expired/revoked auth, health and legacy traffic
   stay out of consumer totals. Optional service counters use fixed denial enums
   and `legacy-unattributed`, with no guessed identity. Auth failures after revoke
   increment neither consumer count. Already-admitted work follows the race
   boundary in section 3.

Only consumer ID/environment, approved label and aggregate times/counts flow to
reports. No token/selector/verifier, IP, user-agent, raw query/result/corpus,
end-user identity, free-form error or arbitrary URL is collected. Do not add
per-source/query dimensions. Existing `app.ts` error-name output and raw error
logging in `serve.ts`/embedding fallback must receive sentinel leakage tests
before instrumentation ships; never copy these patterns into telemetry. A later
approved deployment review must check proxy/access-log/tracing capture separately.

### Coverage that cannot silently become zero

Register each serving instance's collector epoch before accepting requests. It
must renew bounded leases and persist safe checkpoints. The reporting coverage
starts only with a known instrumented deployment epoch; an uninstrumented receiver
or incomplete fleet manifest cannot produce complete coverage. Keep safe checkpoints and durable gap intervals per environment; all instance
checkpoints must cover the requested interval and all pending attempts must be
settled before marking it complete.

If usage persistence fails, bounded retrieval may continue under the approved
policy, but the instance stops advancing its safe frontier immediately. On
recovery, persist a conservative gap from its last confirmed safe checkpoint
through recovery, before resuming checkpoints. A crash/stale lease similarly
opens an unrecoverable interval until reconciliation; a heartbeat alone never
proves that no increments were lost. If gap persistence also fails, stale
checkpoints force unavailable coverage. A process restart cannot reset gaps or
advance past lost attempts as though they never existed.

Reports inspect overlap with gaps, deployment epochs, pending attempts and lease
health in one consistent snapshot. `completeThrough` is the report-window contiguous safe UTC frontier from
`windowStart`, capped at `windowEnd` (null if no frontier can be established).
A complete row reports `windowEnd`, so later heartbeats cannot change an already
certified closed-window report. A window can be complete after an older
historical gap only if its own interval is fully certified. Return partial
when known counts exist with an identified gap/pending tail, unavailable when
coverage itself cannot be established. Never synthesize 0/0 for unavailable
storage/history or an unknown consumer. For known unused consumers in fully
covered retained windows, the correct values are 0/0/null. Retired consumers and
old label versions stay reportable; do not reuse IDs.

### Proposed command, endpoint and authentication

Implement a private `POST /internal/rag/usage-report` separate from public `/v1`,
with only `{ consumerId?, environment, from, to }`. The corresponding operator
command is `usage:report --consumer <id> --environment <env> --from <UTC> --to <UTC>`;
a bounded all-consumer mode supports heavy-use visibility without arbitrary SQL.
This command/endpoint does not exist today. Use strict UTC `Z` timestamps,
minute-aligned half-open windows `[from,to)`, `from < to <= now`, maximum 31 days
per request. Reject nonaligned input instead of silently rounding: minute
aggregates cannot answer arbitrary sub-minute windows exactly. Longer historical
analysis composes adjacent bounded windows; retention is not limited to 31 days.

Single-consumer reports return one row, unknown consumer returns a typed error.
All-consumer mode uses bounded pages (proposed 100 rows) and snapshot-bound opaque
pagination; fixed ordering by request count descending then consumer ID. No
caller-selectable SQL/columns/joins/order expressions. Include zero-use consumers
and coverage status; partial counts are lower bounds, not heavy-use rankings
certified as complete. Labels are approved labels as of window end so closed
report windows remain stable across renames. Snapshot IDs/cursors are operational
pagination metadata, not additional per-request telemetry.

Fixed row contract (matches programme C): `consumerId`, `label`, `environment`,
`windowStart`, `windowEnd`, `requestCount`, `successfulRequestCount`,
`lastActivityAt`, `generatedAt`, `completeThrough`, `coverageStatus`.
Use lossless decimal strings for database bigint counts in JSON. Generate from
one repeatable-read snapshot; the same closed certified window is stable except
`generatedAt`. An unavailable report is visibly unavailable and CLI exits nonzero;
partial rows are visibly labelled (proposed exit 2), complete exit 0. Storage
outage returns generic service unavailable, not rows fabricated from defaults.

Human reports require Jaco's verified GitHub binding (`githubUserId` =
`219753371`) and active allowlisted RAG session; a matching display name or email
string alone is insufficient. First register **RAGBot as an ordinary retrieval
consumer**, then give it a separate narrow internal read-only usage tool. This
ordering and aggregate-only access are approved G3 option A. RAGBot gets one dedicated report-only opaque capability, separately
hashed/domain-bound to `rag-usage-report` and the receiver environment, with
current-state checks and revocation. It grants only this endpoint, not retrieval,
registration, rotation, membership changes or general database access. The
bounded future `forge-rag-usage-report` ops task accepts only the fixed filters,
never a URL/SQL/header override, and obtains its capability out of band from the
approved secret store. No credential on command line, stdout or agent transcript.
The report server uses the aggregate-only database role; the bot receives no DB
credential. This endpoint/capability is a concrete transport proposal for the
approved narrow tool, not a new approval prerequisite. feat-513 must document
the actual tool transport, registered RAGBot consumer ID, runtime binding and
named provisioning/rotation owner before activation; the RAG access/usage
implementer owns recording that handoff, with Jaco retaining recovery authority.
No identity is inferred from an agent process name or a caller-supplied header.
Provisioning remains a later authorized operation.

RAGBot's **retrieval** dogfood credential is its first, separate ordinary consumer
credential used by actual `forge-rag-retrieve` over `POST /v1/search`. Report access
does not substitute for that proof. Other engineers/managers receive neither
report capability nor report access through their membership.

Preserve programme E's exact later proof: known covered baseline 0/0/null; real
ops HTTP attempts +3/+3 then +5/+5; second consumer +1/+1 while first stays +5/+5;
repeat closed report; post-auth validation/retrieval failures; empty 200;
disconnects/retries; revoke and identity-preserving replacement; all-environment
consumer revoke; collector failure/recovery/gaps; forbidden role reads/writes;
synthetic grace/cutoff/rollback. No execution of that proof occurred here.

## Readiness gates and handoff

| Gate                                | Current finding / remaining handoff                                                                                                                                                                                                                                                                           | Owner and timing                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 — discovery resolved by option B | Latest policy is any valid non-author approval for the two registry/schema paths only. Native team/CODEOWNERS variants change reviewer eligibility; whole-branch count broadens scope; current CI has no exact reliable evaluator. Preserve this documented gap in feat-512 with the acceptance matrix above. | Jaco/feat-512 implementer; no remaining discovery decision, no configured-enforcement claim or settings change.                                      |
| G2 — design resolved                | GitHub OAuth, same-entry allowlisted account plus verified email, multiple managers. No Google fallback. Register per-environment portal apps/origins and assign provisioning owner; implement the one-hour revocable local session and issuance-time provider revalidation.                                  | feat-515 implementation; host/registration and synthetic login proof before activation, portal delivery after dogfood.                               |
| G3 — design resolved                | RAGBot consumer first; Jaco/RAGBot aggregate counts/activity only through narrow read-only tool. Document actual transport, consumer binding and provisioning owner under the proposed endpoint/capability contract. No query results or general DB capability.                                               | feat-513 transport/handoff and feat-514 consumer-first dogfood; concrete runtime assignments before activation, not another discovery approval gate. |
| G4 — implementation proofs          | Synthetic credential races, role isolation/default grants, Node completion, crash/gap tests, account/email mismatch and removal/session cases, latency budget.                                                                                                                                                | feat-512/513/515 as applicable; no runtime tests claimed here.                                                                                       |
| G5 — actual dogfood                 | Actual `forge-rag-retrieve` task path/revision, selected consumer/source scope/environment, retries and real HTTP acceptance evidence.                                                                                                                                                                        | feat-514; tracked task definition still absent; no outside Ops workspace inspected.                                                                  |
| G6 — production authorization       | Communications owner, seven-day grace start/cutoff, complete dogfood/report coverage and rollback approval.                                                                                                                                                                                                   | Separately approved production action only, never authorized by G1–G3 answers.                                                                       |

Existing feat-512–515 own implementation/release work. feat-518 is **complete**:
the explicitly authorized option-B disposition resolves the discovery gate while
retaining the real enforcement gap under feat-512. No implementation ticket is
marked complete. Jaco remains recovery authority; GitHub portal and consumer-first
aggregate reporting choices remain settled. No new feature ID is needed because
the existing access-lifecycle ticket already owns registry enforcement. Shared
`/v1` contracts, operational runbooks and PR #2304 remain untouched.

## Review and durable lessons

Self-review found and incorporated five important failure cases: a same-name CI
check is not a trusted approval source; the Chat identity cookie is not a portal
authorization session; public-schema default grants defeat metadata isolation;
returning a response is not socket completion; and a fresh heartbeat cannot erase
lost usage increments. The pending completion crash window must produce incomplete
coverage, not a fabricated exact count. These RAG-specific lessons are preserved
here rather than rewriting unrelated auth systems or operational runbooks.

## Documentation verification

Local documentation results on 2026-09-16:

- PASS: changed-file `npx --no-install --prefix /tmp/j007-doc-tools prettier
--check` (Prettier 3.8.1) and `git diff --check`.
- PASS: targeted Node/gray-matter validation of all 33 lane frontmatters and
  index rows/counts (20 complete, 1 in-progress, 11 not-started, 1 blocked),
  reciprocal programme dependencies, sequence feat-511 → 518 → 512 → 513 →
  514 → 515, evidence metadata and 38 relative links.
- PASS: `tsx --test scripts/check-hidden-roadmap-lanes.test.ts` (2/2) and
  `tsx scripts/check-hidden-roadmap-lanes.ts`. Reused external tool installation
  `/tmp/j007-doc-tools/node_modules` through `NODE_PATH`; no dependency/lockfile
  changes. Local runner is Node 22.22.1; repository CI uses `.nvmrc` Node 24.
- Existing broader findings: whole-lane dependency scan flags
  `feat-461.blocks: feat-435` without reverse `feat-435.depends_on: feat-461`.
  Verified unchanged in parent `e5b22f723`; all consumer programme edges pass.
  Hidden-lane checker emits 18 existing unrelated public-lane missing-frontmatter
  warnings. Neither finding was introduced or repaired by this scoped PR.
- `.husky/_` is absent in this supplied worktree; no hook was bypassed. Required
  checks were run explicitly.
- PASS: full repository `prettier --check .` (3.8.1): all matched files use
  Prettier code style; final report/PR-link edits receive the targeted check.
- Initial commit attempt found no configured author. Verified the authenticated
  GitHub account is `jaco-brink` and used its GitHub noreply identity for this
  job's commits via per-command Git options; no global/shared Git config change.

No runtime, role, crypto, HTTP, page performance, live claim, production or
cutover verification was performed or is implied by these documentation checks.

## Draft delivery receipt

- Discovery PR: [#2325](https://github.com/JesusFilm/forge/pull/2325), created as a draft.
- Branch/base: `docs/rag-consumer-access-discovery` →
  `docs/rag-consumer-access-usage-plan` at parent `e5b22f7235385ee67d0e9aeda54916b8394408e3`.
- Investigation commit: `886743382`; subsequent documentation receipt commit
  adds this PR link and final checks. The initial delivery changed this report,
  feat-518 and the RAG README. The final path-policy handoff also updates feat-512
  and feat-515 to remove superseded senior-only/Google guidance: five docs only.
- PR #2304 was re-read before delivery and remained an open draft at the same
  head; it was neither modified nor merged. No deployment or production action.
- Final outcome: discovery complete under the approved option-B fallback;
  enforcement remains an explicit feat-512 implementation gap, not a claim of
  current protection. Current-head CI is recorded in the final job receipt.

## September 17 continuation review and verification

The existing discovery PR is updated, not replaced. Jaco's explicit GitHub choice
supersedes the earlier portal recommendation; no changes to the parent planning
PR are needed to record that precedence. Self-review checked account/email
same-entry binding, numeric identity versus rename, recovery versus approval,
consumer-first bot registration versus report capability, and actual check names
versus suggested names. No new production permission is inferred.

Repository/API recheck: PR #2304 remains at `e5b22f723`; this continuation starts
from discovery head `7621524cc`. The parent and main evidence revisions above
are unchanged. Public numeric account lookups and effective-rule reads succeeded;
legacy branch-protection endpoint again returned 404. Current PR comments/reviews
contain no additional control description. No credentials or private email API
was accessed. At that checkpoint, exact enforcement was the remaining discovery
dependency; the later path-policy decision below resolves its disposition.

Continuation local checks passed: changed Markdown Prettier 3.8.1,
`git diff --check`, all 33 lane frontmatters/index rows and counts, 38 relative
links, reciprocal consumer-programme dependencies, hidden-lane tests (2/2) and
the hidden-lane checker. The same pre-existing feat-461/435 reciprocal-edge
mismatch and 18 public-lane missing-frontmatter warnings remain outside scope.
The September 16 results above remain historical evidence. Full repository
`prettier --check .` also passed on September 17 (all matched files use Prettier
code style); the final report edit receives a targeted recheck. Revised-head
GitHub CI is reported separately in the job's final receipt.

## Path-policy continuation: final decision and verification

The user superseded senior-only approval with any valid non-author approval on
consumer-registry/allowlist changes only, and explicitly authorized option B if
exact reliable enforcement could not be established. Investigated native minimum
reviews, path-specific required-team reviewers, CODEOWNERS, push path rules and
conditional CI. Selected option B for the reasons in section 1; the current
capabilities are not misrepresented as a platform-wide limitation.

Self-review removed broader reviewer, latest-pusher and unrelated-path approval
requirements, separated Jaco recovery from review eligibility, assigned the gap
to existing feat-512 and corrected the feat-515 handoff. The five-area discovery
is now complete; implementation, actual dogfood and production cutoff are not.
No settings or executable files changed. Final local checks are recorded below.

Final targeted checks passed: all five changed Markdown files, whitespace, all
33 lane frontmatters/index rows (21 complete, 1 in-progress, 11 not-started,
0 blocked), reciprocal programme dependencies, completed-ticket Resolution/PR
link and 44 relative links. Hidden-lane tests pass 2/2 and the checker passes.
The existing feat-461/435 reciprocal-edge mismatch and 18 public-lane warnings
remain unchanged. No implementation or live enforcement test is claimed.

Full repository Prettier 3.8.1 also passed for this final continuation (all matched
files use Prettier code style). The final receipt edit is checked separately.
The worktree's hooks remain absent; checks were run explicitly without bypass.
Current-head GitHub CI and the pushed commit are reported in the final job result.
