# RAG Migration Lane

Durable Forge-local roadmap for relocating
[`JesusFilm/jesusfilm-rag`](https://github.com/JesusFilm/jesusfilm-rag/issues/130)
into `apps/rag` and `packages/rag-contracts` without absorbing its service or
database into Admin.

> This lane is intentionally invisible to the public roadmap viewer and the
> generated `docs/roadmap/README.md` totals. This index is maintained by hand.

## Status (September 4, 2026)

- **Total tickets:** 17
- **Complete:** 13
- **In progress:** 0
- **Not started:** 4
- **Blocked:** 0

## Feature Index

| Forge ID                                                       | Historical issue                                              | Feature                                                     | Status      | Forge PR                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| [feat-423](feat-423-rag-scaffold-and-roadmap.md)               | [#156](https://github.com/JesusFilm/jesusfilm-rag/issues/156) | Scaffold RAG space and durable roadmap                      | complete    | [#2033](https://github.com/JesusFilm/forge/pull/2033)                                                        |
| [feat-424](feat-424-rag-environment-contracts.md)              | [#157](https://github.com/JesusFilm/jesusfilm-rag/issues/157) | Port environment contracts and secrets procedure            | complete    | [#2061](https://github.com/JesusFilm/forge/pull/2061)                                                        |
| [feat-425](feat-425-rag-schema-empty-postgres.md)              | [#158](https://github.com/JesusFilm/jesusfilm-rag/issues/158) | Port schema and empty Railway Postgres                      | complete    | [#2064](https://github.com/JesusFilm/forge/pull/2064)                                                        |
| [feat-426](feat-426-rag-shared-contracts-cores.md)             | [#159](https://github.com/JesusFilm/jesusfilm-rag/issues/159) | Port shared contracts and pure cores                        | complete    | —                                                                                                            |
| [feat-427](feat-427-rag-adapters-retrieval.md)                 | [#160](https://github.com/JesusFilm/jesusfilm-rag/issues/160) | Port database adapters and retrieval tooling                | complete    | [#2076](https://github.com/JesusFilm/forge/pull/2076)                                                        |
| [feat-428](feat-428-rag-http-service.md)                       | [#161](https://github.com/JesusFilm/jesusfilm-rag/issues/161) | Port and deploy HTTP retrieval service                      | complete    | [#2079](https://github.com/JesusFilm/forge/pull/2079)                                                        |
| [feat-429](feat-429-rag-local-corpus-copy.md)                  | [#162](https://github.com/JesusFilm/jesusfilm-rag/issues/162) | Rehearse corpus copy locally                                | complete    | [#2086](https://github.com/JesusFilm/forge/pull/2086)                                                        |
| [feat-430](feat-430-rag-production-corpus-copy.md)             | [#163](https://github.com/JesusFilm/jesusfilm-rag/issues/163) | Copy production corpus into Forge Railway                   | complete    | [#2090](https://github.com/JesusFilm/forge/pull/2090)                                                        |
| [feat-431](feat-431-rag-corpus-maintenance.md)                 | [#164](https://github.com/JesusFilm/jesusfilm-rag/issues/164) | Port acquisition, ingestion, and maintenance                | complete    | [#2093](https://github.com/JesusFilm/forge/pull/2093)                                                        |
| [feat-432](feat-432-rag-ops-eval-dashboard.md)                 | [#165](https://github.com/JesusFilm/jesusfilm-rag/issues/165) | Port sources, skills, dashboard, and eval                   | complete    | [#2117](https://github.com/JesusFilm/forge/pull/2117)                                                        |
| [feat-433](feat-433-rag-dual-operations.md)                    | [#166](https://github.com/JesusFilm/jesusfilm-rag/issues/166) | Complete owner-managed dual RAG operations                  | complete    | [#2152](https://github.com/JesusFilm/forge/pull/2152)                                                        |
| [feat-434](feat-434-rag-seeker-cutover.md)                     | [#167](https://github.com/JesusFilm/jesusfilm-rag/issues/167) | Cut Seeker over with rollback                               | complete    | [#2153](https://github.com/JesusFilm/forge/pull/2153), [#2158](https://github.com/JesusFilm/forge/pull/2158) |
| [feat-435](feat-435-rag-proof-soak-archive.md)                 | [#168](https://github.com/JesusFilm/jesusfilm-rag/issues/168) | Prove maintenance, soak, and archive jfrag                  | not-started | —                                                                                                            |
| [feat-439](feat-439-rag-railway-infrastructure-as-code.md)     | —                                                             | Migrate RAG Railway configuration to Infrastructure as Code | not-started | —                                                                                                            |
| [feat-445](feat-445-rag-registry-policy-test-consolidation.md) | —                                                             | Make registry policy tests execute production filtering     | not-started | —                                                                                                            |
| [feat-446](feat-446-rag-typed-operational-errors.md)           | —                                                             | Complete typed operational errors across RAG                | not-started | —                                                                                                            |
| [feat-452](feat-452-rag-migration-recovery.md)                 | [#130](https://github.com/JesusFilm/jesusfilm-rag/issues/130) | Recover omitted RAG migration contracts                     | complete    | [#2164](https://github.com/JesusFilm/forge/pull/2164)                                                        |

## Programme invariants

- Relocate; do not absorb. RAG keeps a distinct Railway service and database.
- Preserve the external read-only `/v1` surface and bearer-scope semantics.
- Copy the corpus and existing vectors; do not rebuild or re-embed them.
- Keep jfrag production and rollback values intact through the approved soak.
- Production deploys use Forge PR-to-main autodeploy only.
- Operator evidence must never contain secrets or corpus text.
