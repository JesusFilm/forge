# feat-433 dual-operations evidence

Verified on September 3, 2026 from the approved operations VM without
retaining credentials, connection strings, database endpoints, queries, corpus
text, or retrieved result metadata.

## Ownership and deployment

- Canonical task definitions: `~/Ops/ops-tasks/tasks/` on the operations host.
- Deployed task definitions: `/opt/ops-tasks/`.
- Canonical operator documentation: `docs/system/ops-tasks.md` in the VM
  operations workspace.
- Invocation: NanoClaw delegates only to catalogued `ops-taskd` tasks. Each RAG
  request names `jfrag` or `forge`; an unqualified request is clarified instead
  of selecting a production target implicitly.
- Credentials: task definitions reference target-scoped secrets without
  containing or printing their values.

## Operation inventory

| Operation      | Transition interface                        | Mode                                      | Verification                                                        |
| -------------- | ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Retrieve       | Explicit jfrag and Forge tasks              | Read-only                                 | Forge passed against the distinct production corpus                 |
| HTTP smoke     | Explicit jfrag and Forge tasks              | Read-only                                 | Forge health, authentication, search, and response contract passed  |
| Acquire        | Explicit jfrag and Forge tasks              | Dry-run or separately authorized write    | Forge parser and refusal paths passed; no live acquisition was run  |
| Ingest / index | Explicit jfrag and Forge tasks              | Bounded, separately authorized write      | Forge parser and refusal paths passed; no live indexing was run     |
| Language sweep | Explicit jfrag and Forge tasks              | Bounded dry-run in this migration step    | Forge minimal bounded dry-run passed; no `--apply` operation ran    |
| Evaluation     | Explicit jfrag and Forge tasks              | Read-only retrieval evaluation            | Forge bounded evaluation passed                                     |
| Source status  | Forge-local source-management skill and CLI | Repository validation or reviewed changes | Kept outside the production task daemon; deterministic checks exist |
| Dashboard      | Forge-local status-dashboard skill          | Read-only snapshot plus reviewed PR       | Kept outside the production task daemon                             |
| Migration      | Forge operator runbooks                     | Manual, separately authorized             | Deliberately not exposed through NanoClaw or executed in this step  |

Source status is repository lifecycle state rather than a choice between two
production receivers. Forge owns it through `plugins/jfp-rag/skills/slice` and
the `@forge/rag` `status:*` commands. Dashboard refresh is a compound repository
workflow owned by `plugins/jfp-rag/skills/status-dashboard`; it reads a
production snapshot, validates and builds committed artifacts, and publishes
only through review. Database schema and corpus migration remain manual
procedures under `apps/rag/docs/ops/postgres-and-schema.md` and
`apps/rag/docs/ops/corpus-copy.md`. Turning those workflows into conversational
production tasks would broaden authority without adding transition coverage.

## Safety and test results

- The Forge target rejects a resolved legacy jfrag database host and rejects a
  database host outside the approved Railway hostname boundary.
- A deliberately incorrect target configuration was refused before retrieval.
- The corrected Forge target produced successful ranked retrieval without
  retained query or result content.
- Forge smoke and bounded evaluation completed successfully.
- The Forge language task completed a minimal source-scoped dry run and did not
  apply changes.
- Acquire and ingest/index were not executed. Their missing-scope, missing-limit,
  missing-authorization, and wrong-target refusal paths passed.
- Existing jfrag tasks remain available for rollback. No request silently
  switches between jfrag and Forge.

## Closure boundary

This evidence establishes dual transition operations without authorizing a
Seeker cutover, a live acquisition/indexing run, a database migration, or
retirement of jfrag. Those actions remain gated by later migration steps.
