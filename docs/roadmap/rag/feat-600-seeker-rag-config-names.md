---
id: "feat-600"
title: "Name Seeker RAG configuration after its consumer"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-10-02"
duration: 1
depends_on: []
blocks: []
tags:
  - "rag"
  - "seeker"
  - "configuration"
---

## Problem

Mastra's `JESUSFILM_RAG_*` names identify the old service branding rather than
the Seeker consumer. The Seeker fixture-capture CLI also uses a separate
`RAG_API_KEY` / `RAG_BASE_URL` pair for the same integration.

## Entry Points — Read These First

1. `apps/mastra/src/config/env.ts` and `env.test.ts` — schema, runtime projection and production host guard.
2. `apps/mastra/src/evals/seeker/capture-rag.ts` — CLI overrides and capture configuration.
3. `apps/mastra/CLAUDE.md` — current configuration reference.

## Grep These

- `SEEKER_RAG_`, `getJesusfilmRagConfig`, `assertJesusfilmRagBaseUrlAllowedForProduction` in TypeScript source.
- Exclude credential-bearing dotenv files from searches.

## What To Build

- Rename all six `JESUSFILM_RAG_*` variables to `SEEKER_RAG_*`: `API_KEY`,
  `BASE_URL`, `ALLOWED_HOSTS`, `TIMEOUT_MS`, `MAX_RESPONSE_BYTES`, `USER_AGENT`.
- Use `SEEKER_RAG_API_KEY` and `SEEKER_RAG_BASE_URL` in fixture capture;
  retain explicit CLI overrides and independent evaluation budgets.
- Update configuration tests, the checked-in example template and current docs.
  Preserve historical migration evidence, internal client/type names and defaults.

## Constraints

- Direct cutover, with no old-name aliases or fallback.
- No credential rotation, endpoint changes or production configuration writes.
- Do not read credential-bearing dotenv files or display credentials.
- Preserve optional configuration, production host restrictions and existing caps.

## Rollout

The owner will rename configured production settings after the code merges, and
update local settings before restarting local Mastra. Until both the new base URL
and API key are configured, retrieval returns unavailable. Set the new host
allowlist with the base URL: a configured production URL without its matching
allowlist fails startup. Rename optional overrides only where they are configured.
The API key value stays the same. Rolling code back also requires restoring the
old variable names.

## Verification

- Run configuration, RAG-client, retrieve-answer and Seeker capture/evaluation tests.
- Check formatting and TypeScript for the touched package.
- After rollout, verify grounded retrieval and citations locally and in production.
- Publish the reviewed implementation as a PR; keep this ticket in progress until
  the production/local configuration rollout is verified.

## Local Verification — October 2, 2026

- 243 tests passed across configuration, RAG client, retrieve-answer, fixture
  capture and evaluation contracts. CLI tests use a local synthetic HTTP server
  and temporary directories; no live service or credential files are used.
- Mastra TypeScript check and ESLint for changed TypeScript files passed.
- Old runtime/capture names are rejected; CLI overrides and existing runtime
  defaults, caps and production host restrictions remain covered.
- Implementation PR: [#2549](https://github.com/JesusFilm/forge/pull/2549).
- Production/local configuration rollout remains pending; no production settings
  have been changed.

## Resolution

Implemented in [#2549](https://github.com/JesusFilm/forge/pull/2549). Runtime
and fixture capture use `SEEKER_RAG_*` without old-name aliases. Explicit capture
flags, existing defaults, internal function names and production host guards are
preserved. Missing-key guidance now applies to both local and remote capture.

The implementation is ready for the agreed direct cutover. This ticket remains
in progress until the owner renames the configured local and Railway Mastra
variables, restarts/redeploys with those settings, and confirms retrieval,
citations and usage under the `seeker` consumer. Keep the credential value; apply
the base URL and allowed hosts together. No production settings were changed
by this PR.
