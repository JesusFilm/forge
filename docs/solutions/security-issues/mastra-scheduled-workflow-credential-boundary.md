---
module: Mastra
problem_type: security_issue
tags: [mastra, workflows, credentials, egress, validation, testing]
---

# Keep scheduled workflow configuration outside durable input

## Pattern

Mastra workflow input is caller-controlled, durable data. Test-only URL, API
key, transport or timeout overrides must never enter the registered schema.
A scheduled workflow needing no caller parameters should use
`z.strictObject({}).default({})` on both the workflow and its first step.
Revalidate inside the execute callback to cover direct step calls and paths
where framework validation is disabled. The callback must not forward caller
data into a code-only dependency argument.

`apps/mastra/src/mastra/workflows/subtitle-eval-recovery.ts` uses a separate
private dependency type for helper tests. Registered execution resolves only
the optional operator env pair. A supplied test config replaces the entire
pair, so a fixture cannot accidentally inherit the runtime credential.

## Credentialed transport

Validate the exact operator destination before constructing bearer headers.
For recovery, the supported destination is exactly
`https://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery`.
There is no documented recovery-specific private Railway or local exception.
Reject alternate hosts, ports, paths, query strings, URL userinfo and fragments;
set `redirect: "error"` so the credential cannot follow a redirect. Missing
configuration remains a silent `config_missing` skip; a disallowed configured
destination returns only `config_invalid` with zero counts.

Env schema declarations also need explicit `process.env` mapping in
`apps/mastra/src/config/env.ts`; declaration alone does not configure runtime.
Do not print values or raw transport errors to diagnose mapping.

## Verification

Test the actual registered schema and execute callback, rather than only a
helper supplied safe dependencies. With a dummy operator key and stubbed fetch,
prove URL-only and key/fetch/timeout overrides fail before any request, including
when the callback is unit-called without framework validation. Pin the separate
code-only injection seam, default operator resolution, missing-pair skip and env
mapping. Keep negative destinations dummy-only and stub every fetch; never
weaken production policy for a fixture. Preserve deadlines, streamed byte caps,
reader cancellation, safe errors, counts and evented scheduling. These unit tests
do not require starting a run, persisting workflow state or activating a scheduler.

A fresh independent reviewer should trace generated workflow entry points to
the registered step and the credentialed request, including direct step and
time-travel/resume paths. Gateway UI visibility is not an execution boundary.
