---
title: "Mastra eval workflow local dev requires Admin contracts and browser-reachable Studio"
date: "2026-05-27"
last_updated: "2026-05-28"
category: "integration-issues"
module: "apps/mastra, apps/admin, .devcontainer"
problem_type: "integration_issue"
component: "development_workflow"
symptoms:
  - "Mastra eval query generation returned admin_config_missing when run from Studio"
  - "The host browser could not reach localhost:4111 or a container-private 172.x address"
  - "The Mastra Evaluation sidebar stayed empty even though the workflow existed"
  - "Studio Form input treated JSON as a string and returned invalid_input"
  - "Studio rendered a single generic input instead of usable workflow fields"
  - "A workflow run showed a green Studio card even though the result body was ok:false"
root_cause: "incomplete_setup"
resolution_type: "environment_setup"
severity: "medium"
related_components:
  - "apps/mastra"
  - "apps/admin"
  - ".devcontainer"
tags:
  - "mastra"
  - "studio"
  - "search-eval"
  - "admin-contract"
  - "devcontainer"
  - "workflow"
  - "browser-smoke"
---

# Mastra Eval Workflow Local Dev Requires Admin Contracts and Browser-Reachable Studio

## Problem

The feat-138 eval query generation workflow was implemented and the Mastra
server was running, but a local Studio run returned
`{ "ok": false, "reason": "admin_config_missing" }`. After the container was
rebuilt, the host browser still could not consistently reach Studio because
Mastra was bound inside the devcontainer without a browser-reachable host port.

The working path required treating local validation as three separate
contracts: Mastra-to-Admin HTTP configuration, host-to-container Studio
reachability, and Studio workflow input shape.

## Symptoms

- `http://localhost:4111/studio/workflows/eval-query-generation` returned
  `ERR_CONNECTION_REFUSED` when Mastra was not exposed to the host browser.
- Pointing the browser at `http://172.19.0.4:4111/...` failed with
  `ERR_ADDRESS_UNREACHABLE` because that address was container-private.
- Running the workflow before Mastra had Admin eval env returned:

  ```json
  {
    "ok": false,
    "reason": "admin_config_missing",
    "retryable": false
  }
  ```

- The Mastra **Evaluation** nav did not show anything because feat-138/139
  workflows do not create native Mastra scorers, datasets, or experiments yet.
  Feat-138 stages generated candidates in Admin, and feat-139 writes
  artifact-backed offline reports.
- The Studio **Form** tab accepted a JSON-looking string, but sent it as a
  string payload. The workflow then completed as a Studio run with
  `invalid_input` instead of generating candidates.
- The `offline-search-eval` workflow initially exposed `z.unknown()` as its
  workflow and step input schema. Studio had no field-level contract to render,
  so it fell back to a single generic input.
- The workflow returned `{ ok: false, reason: "invalid_input" }` as a normal
  output value. Mastra Studio correctly treated the step as completed because
  no exception was thrown.

## What Didn't Work

- Checking only the custom service route was insufficient. A bearer-authenticated
  route can work while the Studio workflow path is still broken. Validate the
  built-in workflow APIs and run history as well.
- Using the container IP from inside Chrome on the host was the wrong network
  boundary. The host browser needs a published/forwarded host port, not the
  container's internal Docker address.
- Looking in Mastra's **Evaluation** section was premature for feat-138/139
  validation. The native Evaluation area is the long-term search-eval operator
  destination, but these workflow runs do not appear there until native
  Dataset, Scorer, and Experiment records are created. Generated eval
  candidates remain in Admin with `promotion_status = generated` until later
  human-promotion/regression-gate work.
- Sending JSON through Studio's **Form** textbox made the payload a string. The
  workflow input schema expects an object.
- Exposing `z.unknown()` for a Studio-facing workflow preserved runtime
  flexibility but destroyed operator usability. Studio needs concrete Zod
  object fields, defaults, and descriptions to render a useful form.
- Returning a failure-shaped object from a workflow step is not the same thing
  as failing the run. Studio marks the step green unless the step throws or
  Mastra rejects the input schema.
- Running the default empty input locally can pull in `locale_quality` generation.
  Without `OPENROUTER_API_KEY`, that path may fail with generation configuration
  errors. Use explicit `catalog` and `trace` sources for local smoke unless the
  model key is intentionally configured.
- Prior feat-137 validation established that Admin internal trace sampling must
  stay bearer-protected and only sample safe viewer-intent rows by default
  (session history). This local problem was not a trace-labeling regression; it
  was missing runtime configuration around the new contracts.

## Solution

Start Admin and Mastra with matching local eval contract env, then access Studio
through a host-reachable URL.

Minimum Admin-side local contract:

```bash
DATABASE_URL=postgresql://forge:forge@db:5432/forge_admin
DATABASE_URL_SYNC=postgresql://forge:forge@db:5432/forge_admin
SEARCH_TRACE_SAMPLING_API_KEYS=local-search-eval-key
MASTRA_BASE_URL=http://127.0.0.1:4111
MASTRA_SERVICE_API_KEY=local-mastra-service-key
pnpm --filter @forge/admin dev -- --port 3003
```

Minimum Mastra-side local contract:

```bash
DATABASE_URL=postgresql://forge:forge@db:5432/forge
MASTRA_STORAGE_BACKEND=postgres
MASTRA_NATIVE_EVAL_ENVIRONMENT=local
MASTRA_SERVICE_API_KEYS=local-mastra-service-key
ADMIN_SEARCH_TRACE_SAMPLE_URL=http://127.0.0.1:3003/api/internal/search-traces/sample
ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL=http://127.0.0.1:3003/api/internal/search-eval/catalog-context
ADMIN_SEARCH_EVAL_CANDIDATES_URL=http://127.0.0.1:3003/api/internal/search-eval/candidates
ADMIN_SEARCH_EVAL_SEARCH_URL=http://127.0.0.1:3003/api/internal/search-eval/search
ADMIN_SEARCH_EVAL_API_KEY=local-search-eval-key
MASTRA_SEARCH_EVAL_ARTIFACT_DIR=.mastra/storage/search-eval
# Required for offline compare mode; capture-baseline can run without it.
OPENROUTER_API_KEY=
SEARCH_EVAL_JUDGE_MODEL=anthropic/claude-haiku-4-5
pnpm --filter @forge/mastra dev
```

When local Postgres is unavailable and the goal is only to smoke the native
Evaluation projection, use local-only in-memory storage instead:

```bash
MASTRA_STORAGE_BACKEND=memory
MASTRA_NATIVE_EVAL_ENVIRONMENT=local
MASTRA_SERVICE_API_KEYS=local-mastra-service-key
MASTRA_SEARCH_EVAL_ARTIFACT_DIR=.mastra/storage/search-eval
pnpm --filter @forge/mastra dev
```

`MASTRA_STORAGE_BACKEND=memory` is rejected in production and loses records on
process exit. It is only for proving that a report artifact can become native
Dataset, Scorer, and Experiment records in Studio.

For browser reachability, prefer a real devcontainer port mapping for `4111`.
When the running devcontainer has not been rebuilt with that mapping, a
temporary host bridge can prove the workflow, but the durable fix is to expose
Mastra Studio directly to the host.

Use Studio from the browser-reachable URL:

```text
Mastra instance URL: http://localhost:4111
API prefix: /api
Headers: none
```

If the current devcontainer only exposes SSH on host `2222` and is temporarily
bridging that traffic to Mastra, use `http://localhost:2222` as the instance
URL for that session. Do not use the container-private `172.x` address from the
host browser.

In Studio, open **Workflows**, not **Evaluation**, select
`eval-query-generation`, switch to the **JSON** input tab, and run:

```json
{
  "sources": ["catalog", "trace"],
  "locales": ["en"],
  "traceLimit": 2,
  "catalogLimit": 3
}
```

Then verify both the workflow run and Admin persistence:

```bash
curl -sS \
  'http://127.0.0.1:4111/api/workflows/eval-query-generation/runs?limit=1&offset=0' |
  jq '.runs[0].snapshot.result'

psql 'postgresql://forge:forge@db:5432/forge_admin' -Atc "
  select source, locale, query_text, promotion_status, mastra_run_id
  from search_eval_candidate
  order by created_at desc
  limit 5;
"
```

A healthy local smoke returns a successful run similar to:

```json
{
  "ok": true,
  "storedCount": 5,
  "skippedCount": 0,
  "sourceCounts": {
    "trace": 2,
    "catalog": 3,
    "locale_quality": 0
  },
  "generatedCount": 5
}
```

The generated rows should stay staged with `promotion_status = generated`. They
are not permanent regression benchmarks until sanitized and human-promoted in
the later evaluation-gate flow.

For the feat-139 `offline-search-eval` workflow, use the **Form** tab. The
workflow exposes a structured schema with operator-safe defaults, so a local
seed capture can run without hand-written JSON:

```text
mode: capture-baseline
baselineName: seed-baseline
locales: en, es, fr
searchLimit: 20
searchMode: hybrid
contentType: all
```

Use `contentType=all` for the default both-corpora eval, or narrow to `video`
or `experience` when intentionally testing one corpus. `searchMode=hybrid` is
Admin's normal search pipeline; `keyword-first` exercises the lexical-first
candidate strategy. Avoid nullable defaults for Studio form fields; Mastra
renders nullable unions as awkward required `OR` controls.

Compare mode loads the named baseline and calls the judge, so it also needs
`OPENROUTER_API_KEY`. If current seed search or judge calls fail, the workflow
marks the Studio run red after writing a report artifact path into the typed
failure result. That is intentional: a failure report is useful evidence, but a
green workflow card would be a false signal for operators.

For the feat-142 native Evaluation smoke, open **Workflows**, select
`search-eval-native-suite`, and run the default Form values:

```text
action: create-sample-report
baselineName: local-smoke
environmentLabel: local
promotedLimit: 100
```

That action writes a realistic sample comparison report artifact, syncs the
report into native Datasets, Scorers, and Experiments, then writes the native ids
back into the report's `mastraEvaluation` projection. After the run, open the
native **Evaluation** area and verify records named like:

```text
Dataset: search-eval:local:local-smoke
Scorer: Search result pairwise judge
Experiment: search-eval-compare:local:local-smoke:<run id>
```

Run the same workflow a second time with the same report id through
`action=sync-report` if you want to prove idempotency for a fixed artifact. The
Dataset should stay singular, items should update by source key, and the report
Experiment should be reused instead of duplicated.

## Why This Works

Mastra does not read Admin's database directly. The eval workflow needs Admin's
authenticated HTTP contracts for trace sampling, catalog context, and candidate
storage. `ADMIN_SEARCH_EVAL_API_KEY` in Mastra must match Admin's
`SEARCH_TRACE_SAMPLING_API_KEYS`; otherwise the workflow either has no route to
Admin or cannot authenticate to the sampling/read/write contracts.

The host browser also has a different network view from the devcontainer.
Mastra listening on `0.0.0.0:4111` inside the container is necessary but not
sufficient; Docker or the devcontainer must publish that port to the host. A
container-private `172.x` URL can work from inside the container and still be
unreachable from Chrome on the host.

Finally, Studio's workflow runner distinguishes object input from string input.
The JSON editor sends the object shape the workflow schema expects. The Form
textbox can serialize the same text as a string, which produces an
`invalid_input` result even though the Studio run itself is marked complete.

For operator-facing workflows, the schema is part of the UI contract. A concrete
Zod object schema lets Studio render select boxes, arrays, booleans, numeric
fields, descriptions, and defaults. `z.unknown()` hides all of that information
from Studio. If workflow code catches an error and returns `{ ok: false }`,
Studio still sees a successful step output; throw a typed workflow error when a
run should be red in Studio, and keep service routes responsible for mapping the
same failure into clean HTTP JSON.

## Prevention

- Treat Mastra eval workflow smoke as a three-part check: Admin contract env,
  host-reachable Studio URL, and object-shaped workflow input.
- Treat Studio workflow schemas as operator UX. Use concrete Zod object schemas
  with defaults for common local smoke paths; reserve `z.unknown()` for
  non-Studio internal glue.
- For Studio select fields that need a no-filter state, model that as an
  explicit enum value such as `all` instead of `nullable().default(null)`.
- Throw inside workflow steps for failure-shaped results that should mark the
  Studio run failed. Service routes can catch and translate those errors back
  into stable JSON responses.
- Keep the local Admin and Mastra bearer keys paired in runbooks:
  `SEARCH_TRACE_SAMPLING_API_KEYS` on Admin and `ADMIN_SEARCH_EVAL_API_KEY` on
  Mastra.
- Use explicit `sources: ["catalog", "trace"]` for local smoke unless
  `OPENROUTER_API_KEY` is intentionally present for `locale_quality`.
- For `offline-search-eval`, smoke capture first with `{}` or the default Form
  values, then run compare only after a named baseline exists and
  `OPENROUTER_API_KEY` is configured.
- For `search-eval-native-suite`, use `create-sample-report` with
  `MASTRA_STORAGE_BACKEND=memory` when local Postgres or Admin data is
  unavailable. Use `sync-promoted` only when Admin candidate env is configured.
- Confirm `/api/workflows/eval-query-generation/runs` and
  `search_eval_candidate` rows after a Studio run. Seeing a Studio "success" row
  alone is not enough because `{ ok: false }` is still a completed workflow
  result.
- Keep generated candidates separate from promoted truth. A successful local
  offline-search-eval run should use seed prompts only; staged generated
  candidates remain out of the operator workflow until a later promotion flow.
- Do not interpret production `/api/search/health` embedding-provider failures
  as trace-labeling or eval-generation failures without checking the component
  health details. A prior production smoke found an embedding-provider `403`
  while trace retention and sampling auth boundaries were healthy (session
  history).

## Related Issues

- [Mastra Studio API routes must not inherit service-bearer route guards](mastra-studio-api-auth-guard.md)
  covers the sibling Studio failure where service-bearer middleware blocked
  Mastra's built-in `/api/workflows` browser calls.
- [Offline workflow batches must respect consumer write limits](offline-workflow-batches-must-respect-consumer-write-limits.md)
  covers the producer/consumer batch boundary for this same eval generation
  workflow.
- [Mastra embedding workflow ownership pattern](../platform/mastra-embedding-workflow-ownership-pattern.md)
  captures the broader Mastra/Admin ownership rule: Mastra runs offline
  workflows, Admin owns live search and durable storage.
- [Admin search query labeling pattern](../platform/admin-search-query-labeling-pattern.md)
  documents the trace-labeling and default safe-sampling contract that eval
  query generation builds on.
- [Devcontainer setup](../platform/devcontainer-setup.md) documents the local
  devcontainer port and SSH assumptions that can affect host-browser access.
