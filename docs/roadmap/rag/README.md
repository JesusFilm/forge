# RAG Migration Lane

Durable Forge-local roadmap for relocating
[`JesusFilm/jesusfilm-rag`](https://github.com/JesusFilm/jesusfilm-rag/issues/130)
into `apps/rag` and `packages/rag-contracts` without absorbing its service or
database into Admin.

> This lane is intentionally invisible to the public roadmap viewer and the
> generated `docs/roadmap/README.md` totals. This index is maintained by hand.

## Status (September 23, 2026)

- **Total tickets:** 35
- **Complete:** 23
- **In progress:** 0
- **Not started:** 12
- **Blocked:** 0

## Feature Index

| Forge ID                                                          | Historical issue                                              | Feature                                                            | Status      | Forge PR                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| [feat-423](feat-423-rag-scaffold-and-roadmap.md)                  | [#156](https://github.com/JesusFilm/jesusfilm-rag/issues/156) | Scaffold RAG space and durable roadmap                             | complete    | [#2033](https://github.com/JesusFilm/forge/pull/2033)                                                        |
| [feat-424](feat-424-rag-environment-contracts.md)                 | [#157](https://github.com/JesusFilm/jesusfilm-rag/issues/157) | Port environment contracts and secrets procedure                   | complete    | [#2061](https://github.com/JesusFilm/forge/pull/2061)                                                        |
| [feat-425](feat-425-rag-schema-empty-postgres.md)                 | [#158](https://github.com/JesusFilm/jesusfilm-rag/issues/158) | Port schema and empty Railway Postgres                             | complete    | [#2064](https://github.com/JesusFilm/forge/pull/2064)                                                        |
| [feat-426](feat-426-rag-shared-contracts-cores.md)                | [#159](https://github.com/JesusFilm/jesusfilm-rag/issues/159) | Port shared contracts and pure cores                               | complete    | —                                                                                                            |
| [feat-427](feat-427-rag-adapters-retrieval.md)                    | [#160](https://github.com/JesusFilm/jesusfilm-rag/issues/160) | Port database adapters and retrieval tooling                       | complete    | [#2076](https://github.com/JesusFilm/forge/pull/2076)                                                        |
| [feat-428](feat-428-rag-http-service.md)                          | [#161](https://github.com/JesusFilm/jesusfilm-rag/issues/161) | Port and deploy HTTP retrieval service                             | complete    | [#2079](https://github.com/JesusFilm/forge/pull/2079)                                                        |
| [feat-429](feat-429-rag-local-corpus-copy.md)                     | [#162](https://github.com/JesusFilm/jesusfilm-rag/issues/162) | Rehearse corpus copy locally                                       | complete    | [#2086](https://github.com/JesusFilm/forge/pull/2086)                                                        |
| [feat-430](feat-430-rag-production-corpus-copy.md)                | [#163](https://github.com/JesusFilm/jesusfilm-rag/issues/163) | Copy production corpus into Forge Railway                          | complete    | [#2090](https://github.com/JesusFilm/forge/pull/2090)                                                        |
| [feat-431](feat-431-rag-corpus-maintenance.md)                    | [#164](https://github.com/JesusFilm/jesusfilm-rag/issues/164) | Port acquisition, ingestion, and maintenance                       | complete    | [#2093](https://github.com/JesusFilm/forge/pull/2093)                                                        |
| [feat-432](feat-432-rag-ops-eval-dashboard.md)                    | [#165](https://github.com/JesusFilm/jesusfilm-rag/issues/165) | Port sources, skills, dashboard, and eval                          | complete    | [#2117](https://github.com/JesusFilm/forge/pull/2117)                                                        |
| [feat-433](feat-433-rag-dual-operations.md)                       | [#166](https://github.com/JesusFilm/jesusfilm-rag/issues/166) | Complete owner-managed dual RAG operations                         | complete    | [#2152](https://github.com/JesusFilm/forge/pull/2152)                                                        |
| [feat-434](feat-434-rag-seeker-cutover.md)                        | [#167](https://github.com/JesusFilm/jesusfilm-rag/issues/167) | Cut Seeker over with rollback                                      | complete    | [#2153](https://github.com/JesusFilm/forge/pull/2153), [#2158](https://github.com/JesusFilm/forge/pull/2158) |
| [feat-435](feat-435-rag-proof-soak-archive.md)                    | [#168](https://github.com/JesusFilm/jesusfilm-rag/issues/168) | Prove maintenance, soak, and archive jfrag                         | complete    | [#2189](https://github.com/JesusFilm/forge/pull/2189), [#2379](https://github.com/JesusFilm/forge/pull/2379) |
| [feat-439](feat-439-rag-railway-infrastructure-as-code.md)        | —                                                             | Migrate RAG Railway configuration to Infrastructure as Code        | not-started | —                                                                                                            |
| [feat-445](feat-445-rag-registry-policy-test-consolidation.md)    | —                                                             | Make registry policy tests execute production filtering            | not-started | —                                                                                                            |
| [feat-446](feat-446-rag-typed-operational-errors.md)              | —                                                             | Complete typed operational errors across RAG                       | not-started | —                                                                                                            |
| [feat-452](feat-452-rag-migration-recovery.md)                    | [#130](https://github.com/JesusFilm/jesusfilm-rag/issues/130) | Recover omitted RAG migration contracts                            | complete    | [#2164](https://github.com/JesusFilm/forge/pull/2164)                                                        |
| [feat-460](feat-460-rag-production-readonly-principal.md)         | —                                                             | Provision a least-privilege RAG production reader                  | complete    | [#2180](https://github.com/JesusFilm/forge/pull/2180)                                                        |
| [feat-461](feat-461-rag-readonly-provision-timeout.md)            | —                                                             | Bound production reader provisioning for network latency           | complete    | [#2185](https://github.com/JesusFilm/forge/pull/2185)                                                        |
| [feat-463](feat-463-rag-baseline-concerns-investigation.md)       | —                                                             | Investigate baseline recall, coverage, and language-label concerns | not-started | [#2189](https://github.com/JesusFilm/forge/pull/2189)                                                        |
| [feat-466](feat-466-gotquestions-icelandic-slice.md)              | —                                                             | Complete the local GotQuestions Icelandic slice                    | complete    | [#2202](https://github.com/JesusFilm/forge/pull/2202)                                                        |
| [feat-467](feat-467-gotquestions-icelandic-negative-retrieval.md) | —                                                             | Investigate the Icelandic off-topic retrieval hit                  | not-started | [#2202](https://github.com/JesusFilm/forge/pull/2202)                                                        |
| [feat-468](feat-468-rag-sitemap-discovery-policy.md)              | —                                                             | Separate sitemap discovery from article policy                     | complete    | [#2210](https://github.com/JesusFilm/forge/pull/2210)                                                        |
| [feat-469](feat-469-rag-redirected-sitemap-relative-children.md)  | —                                                             | Resolve sitemap children after redirects                           | not-started | [#2210](https://github.com/JesusFilm/forge/pull/2210)                                                        |
| [feat-470](feat-470-rag-production-operations.md)                 | —                                                             | Make production acquisition and indexing self-contained            | complete    | [#2215](https://github.com/JesusFilm/forge/pull/2215)                                                        |
| [feat-471](feat-471-rag-production-operations-rollout.md)         | —                                                             | Verify direct production maintenance and the Icelandic path        | not-started | [#2215](https://github.com/JesusFilm/forge/pull/2215)                                                        |
| [feat-479](feat-479-rag-corpus-transaction-timeouts.md)           | —                                                             | Bound corpus transactions for production latency                   | complete    | [#2233](https://github.com/JesusFilm/forge/pull/2233)                                                        |
| [feat-526](feat-526-rag-consumer-access-planning.md)              | —                                                             | Plan consumer access and usage visibility                          | complete    | [#2304](https://github.com/JesusFilm/forge/pull/2304)                                                        |
| [feat-527](feat-527-rag-consumer-access-lifecycle.md)             | —                                                             | Implement consumer access lifecycle                                | not-started | [#2304](https://github.com/JesusFilm/forge/pull/2304)                                                        |
| [feat-528](feat-528-rag-consumer-usage-visibility.md)             | —                                                             | Deliver usage reporting                                            | not-started | [#2304](https://github.com/JesusFilm/forge/pull/2304)                                                        |
| [feat-529](feat-529-rag-consumer-dogfood-migration.md)            | —                                                             | Dogfood and seven-day migration                                    | not-started | [#2304](https://github.com/JesusFilm/forge/pull/2304)                                                        |
| [feat-530](feat-530-rag-consumer-self-service-portal.md)          | —                                                             | Internal self-service portal                                       | not-started | [#2304](https://github.com/JesusFilm/forge/pull/2304)                                                        |
| [feat-532](feat-532-rag-legacy-service-credential-retirement.md)  | —                                                             | Retire legacy JesusFilm-RAG service and credentials                | not-started | [#2379](https://github.com/JesusFilm/forge/pull/2379)                                                        |
| [feat-518](feat-518-rag-consumer-access-discovery.md)             | —                                                             | Confirm consumer access implementation readiness                   | complete    | [#2304](https://github.com/JesusFilm/forge/pull/2304)                                                        |
| [feat-541](feat-541-rag-database-diagram.md)                      | —                                                             | RAG database ERD (corpus and draft consumer registry)              | complete    | [#2398](https://github.com/JesusFilm/forge/pull/2398)                                                        |

The September 8 operator decision in [feat-435](feat-435-rag-proof-soak-archive.md)
accepts the baseline for acquisition/ingestion with the three concerns tracked
in feat-463. That investigation does not block the new-source proof.

The [September 22 feat-435 receipt](evidence/feat-435/proof-soak-archive.md)
records completion under Jaco's **Option A** decision: Forge RAG is the active
owner, all consumers have migrated, and external traffic is outside scope.
Rollback rehearsal/expiry and final snapshot retention are not applicable.
Unverified Icelandic import provenance and missing direct migration/AGENTS
README links are accepted limitations. Legacy service and credential retirement
is deferred to [feat-532](feat-532-rag-legacy-service-credential-retirement.md).
The verified dashboard candidate includes 51 embedded Icelandic documents;
publication remains pending the normal reviewed merge and Pages flow.

## Programme invariants

- Relocate; do not absorb. RAG keeps a distinct Railway service and database.
- Preserve the external read-only `/v1` surface and bearer-scope semantics.
- Copy the corpus and existing vectors; do not rebuild or re-embed them.
- Historical migration policy retained jfrag and rollback values through soak.
  Feat-435’s September 22 Option A decision supersedes rollback/snapshot closure
  gates; legacy service/credential changes remain deferred to feat-532 and are
  not authorized by the documentation closure.
- Production deploys use Forge PR-to-main autodeploy only.
- Operator evidence must never contain secrets or corpus text.

Consumer programme order: feat-526 planning/design → feat-518 discovery
→ feat-527 access foundation
→ feat-528 usage visibility → feat-529 dogfood/migration → feat-530 portal.
Portal design is already captured by feat-526; implementation waits for dogfood.

[Discovery evidence](evidence/feat-518/consumer-access-discovery.md) is delivered
in separate draft #2325; feat-518 is complete as documentation. Implementation
feat-527–530 remains not-started; no deployment or runtime proof is implied.

J022 records portal admission through a repository portal-user allowlist changed
by normal PRs, with safe contributor/read-write CI checks. GitHub OAuth accepts
only merged allowlisted handles. Consumers are created directly in the portal;
owner-only Add member selects from the allowlist and updates runtime membership.
No consumer-registration PR or Git-backed per-consumer authorization remains.
Discovery and J021 evidence stay in separate draft
[PR #2325](https://github.com/JesusFilm/forge/pull/2325); the plan stays in
[PR #2304](https://github.com/JesusFilm/forge/pull/2304).
