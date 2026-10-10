> J028 reference update (2026-09-21): historical RAG IDs feat-511–515 now map
> to feat-526–530, respectively, after collisions with tickets merged to main.
> Historical execution claims retain their original IDs; ticket links are updated.

# J008 — Approved RAG consumer access decisions

> Historical execution record. J014 (2026-09-17) supersedes its senior/specific
> approver, engineer/email allowlist, Google portal and mutable-manager proposals.
> Follow the [current programme plan](2026-09-15-001-feat-rag-consumer-access-usage-plan.md)
> for normal PR registration, merged per-consumer `owners`, GitHub login and
> narrow owner-validation CI. Earlier checks and operational claims remain historical.

## Scope and findings

Updated existing draft [PR #2304](https://github.com/JesusFilm/forge/pull/2304)
from head `fc299b20285c13d664e7f44365664731526ffedd`. Work remains documentation
only. The existing branch is checked out in another worktree; this job commits
on `ops/j008` and pushes HEAD explicitly to the existing PR branch without
modifying the other checkout or creating a PR.

Read root/lane/RAG guidance, domain vocabulary, analytics policy, the existing
plan/tickets/report, credential-storage solution and relevant source paths.
No relevant unresolved RAG consumer finding was found in `todos/`. Compound
Engineering commands are not available; performed the plan/work/review/compound
loop directly, preserving findings here and requirements in the plan.

Current main `ed6d978f8` already allocates IDs through 510, including collisions
with this draft's 501–503. Renumbered this programme to 511–513, added 514
(dogfood/migration) and 515 (portal), and updated local references and index.
Existing unrelated duplicate 501 IDs on main are outside this PR's scope.
The historical J007 report has reference-only renumbering; its original execution
claims are historical, not J008 validation.

## Evidence and decisions

- `apps/auth/src/auth/config.ts` conditionally enables Google and emits verified
  email; `apps/chat/src/auth/oauth-client.ts` checks the OIDC token and strict
  boolean claim. Recommend this existing Forge Auth flow, with a new portal
  client registration still to design. No deployed portal or configured Google
  availability was inferred. GitHub remains an explicit alternative, not an
  invented existing integration.
- `apps/rag/scripts/serve.ts` delegates to `wire`; `apps/rag/src/main.ts` selects
  configured `EMBED_BASE_URL` plus OpenRouter fallback, otherwise OpenRouter.
  `fallback-embedder.ts` verifies model/dimensions and catches primary failures.
  Local hosting, production activation, cost and capacity remain unverified.
  No environment files, real credentials or production services were accessed.
- No tracked `forge-rag-retrieve` definition was found. The future dogfood ticket
  requires its actual task path/revision and HTTP route, using Jaco's VM or
  RAGBot consumer. This is a future execution dependency, not a planning blocker.
- Replaced pending product decisions with approved policy: protected engineer
  allowlist, verified identity, audited multiple managers, Jaco/RAGBot-only
  narrow report access, durable aggregate metrics, hash-only one-time secrets,
  atomic rotation without overlap, seven days of migration support and separate
  production cutover approval. Portal design is present now, delivery follows
  dogfood; external rate limits remain separate scope.
- Retained exact count, success, activity/window, isolation, revocation and
  coverage acceptance tests. Distinguished raw sensitive events from aggregate
  storage and operational accounting; capacity review is future work, with no
  retention/deletion implementation or infinite-storage promise.

## Review and durable learning

Provider wiring proves conditional code behavior, not deployment topology.
Rotation approval here replaces the older overlap recipe only for this planned
consumer credential system. Multiple managers require consumer membership and
concurrency rules separate from integration usage identity. Recheck roadmap IDs
against current main before pushing a long-lived planning PR.

Remaining implementation details are named in the plan: senior reviewer identities
and protected CI configuration, portal host/client and identity claim verification,
dogfood environment/scope/task revision, and separately approved cutover timestamps.
None requires blocking this documentation delivery.

## Validation

Results are recorded below after running documentation checks. No runtime,
credential issuance, retrieval, production, deployment or merge verification is
claimed or authorized by this job.

- PASS: full repository Prettier 3.8.1 check (`All matched files use Prettier
code style`), followed by changed-file check after report finalization.
- PASS: `git diff --check`; targeted frontmatter and reciprocal programme
  dependencies; all 32 index links/status totals; changed Markdown local links.
- PASS: both hidden-roadmap-lane tests (2/2) and hidden-lane checker. Checker
  emits pre-existing unrelated public-lane missing-frontmatter warnings.
- Reused external `/tmp/j007-doc-tools` tooling; no dependency or lockfile edits.
  Generated `.husky/_` is absent; no hooks bypassed. Checks run explicitly.

Changed files: the consumer access plan, this report, the historical J007 report
(reference renumbering only), RAG README, renamed/updated feat-511–513 and new
feat-514–515 tickets. No delivery blockers remain. Push target is exclusively
`docs/rag-consumer-access-usage-plan`, existing draft PR #2304.
