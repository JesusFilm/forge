---
id: "feat-466"
title: "Process the GotQuestions Icelandic section locally"
owner: "jaco"
priority: "P2"
status: "complete"
start_date: "2026-09-08"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "i18n", "acquisition", "indexing"]
---

## Problem

Pull Icelandic forward as an explicit exception to the deferred multilingual
campaign. Source-wide acquisition and numeric indexing limits cannot isolate it.

## Entry Points — Read These First

- `apps/rag/docs/slices/gotquestions.md` — completed English and Icelandic resume state.
- `apps/rag/docs/slices/gotquestions-multilingual.md` — deferred campaign.
- `apps/rag/src/registry/gotquestions.ts` — English policy and Icelandic path scope.
- `apps/rag/scripts/{acquire,index}.ts` — operation previews and apply gates.

## Grep These

- `listPending`, `canonicalUrlPrefix`, `pathPrefix`, `gq-`

## What To Build

Add explicit registered path-scoped acquisition and indexing for `/islenska/`.
Use only `/islenska/icelandic.xml`, exclude the landing page, preserve English
extraction, and pin the nine English GotQuestions cases to `language: en`.
Verify the exact article count before approved local acquisition and indexing.
Check three Icelandic queries with both source and language filters; record
redacted evidence and resume state. The operator expanded this scope on
2026-09-08 to run dedicated evaluation and prepare reviewed Icelandic golden
cases. Other-language inventory remains deferred.

## Constraints

Keep the existing source key and English completion. Each Slice lifecycle/data
mutation needs its own fresh operation/target approval. No production or deploy.

## Verification

Local environment, status, dependency checks; focused scope/extraction/indexing
tests; typecheck, lint, formatting; acquisition/index previews; counts, language
and chunk/embedding parity; three Icelandic retrieval checks.

## Resolution

Completed all four local slice stages on 2026-09-08: 51 Icelandic documents,
142 chunks, and 142 embeddings, with the pre-existing corpus unchanged. Registered
path scoping protects English and other-language rows before indexing limits;
exact discovery count checks prevent silent inventory expansion. CLI commands
accept the documented pnpm separator.

The operator approved six reviewed Icelandic golden cases (26 relevant pairs),
the canonical rerun, finding dispositions, final lifecycle closure, and this PR.
All 431 canonical cases ran: recall@10 0.991, coverage 0.815. All six Icelandic
cases returned a relevant document within the top three; their coverage is 0.769.
The 22 relevance disagreements were resolved using prior-source precedents:
9 inclusions and 13 exclusions. Existing golden cases remain intact, apart from
the nine explicit English language pins required by the multilingual registry.
The historical 416-case control prefix is unchanged.

The repeated programming false positive is a known local limitation tracked in
feat-467. No identity-matched historical comparison is available or claimed;
broader baseline concerns remain in feat-463, and this local slice does not
close feat-435 migration acceptance. English remains complete and other
translations deferred. `gotquestions/is` and the source rollup are done; all
four lifecycle stages are green, with `status:check` passing.

Evidence: `apps/rag/docs/slices/gotquestions.md` and
`apps/rag/docs/slice-evidence/gotquestions-is-evaluation-canonical.json`.
Validation: 816 unit/CLI/contract tests, 23 PostgreSQL integration checks in an
isolated database, typecheck, lint, dependency boundaries, schema/drift and
migration checks, environment/status/dashboard validation, and full formatting.

[Forge PR #2202](https://github.com/JesusFilm/forge/pull/2202).
