---
title: "Mastra eval workflow local dev requires Admin contracts and browser-reachable Studio"
date: "2026-05-27"
category: "integration-issues"
module: "apps/mastra, apps/admin, .devcontainer"
problem_type: "integration_issue"
component: "development_workflow"
symptoms:
  - "Mastra eval query generation returned admin_config_missing when run from Studio"
  - "The host browser could not reach localhost:4111 or a container-private 172.x address"
  - "The Mastra Evaluation sidebar stayed empty even though the workflow existed"
  - "Studio Form input treated JSON as a string and returned invalid_input"
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

- The Mastra **Evaluation** nav did not show anything because feat-138 is a
  workflow that stages generated candidates in Admin, not a Mastra scorer,
  dataset, or experiment yet.
- The Studio **Form** tab accepted a JSON-looking string, but sent it as a
  string payload. The workflow then completed as a Studio run with
  `invalid_input` instead of generating candidates.

## What Didn't Work

- Checking only the custom service route was insufficient. A bearer-authenticated
  route can work while the Studio workflow path is still broken. Validate the
  built-in workflow APIs and run history as well.
- Using the container IP from inside Chrome on the host was the wrong network
  boundary. The host browser needs a published/forwarded host port, not the
  container's internal Docker address.
- Looking in Mastra's **Evaluation** section was a false lead. Generated eval
  candidates remain in Admin with `promotion_status = generated` until later
  human-promotion/regression-gate work.
- Sending JSON through Studio's **Form** textbox made the payload a string. The
  workflow input schema expects an object.
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
MASTRA_SERVICE_API_KEYS=local-mastra-service-key
ADMIN_SEARCH_TRACE_SAMPLE_URL=http://127.0.0.1:3003/api/internal/search-traces/sample
ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL=http://127.0.0.1:3003/api/internal/search-eval/catalog-context
ADMIN_SEARCH_EVAL_CANDIDATES_URL=http://127.0.0.1:3003/api/internal/search-eval/candidates
ADMIN_SEARCH_EVAL_API_KEY=local-search-eval-key
pnpm --filter @forge/mastra dev
```

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

## Prevention

- Treat Mastra eval workflow smoke as a three-part check: Admin contract env,
  host-reachable Studio URL, and object-shaped workflow input.
- Keep the local Admin and Mastra bearer keys paired in runbooks:
  `SEARCH_TRACE_SAMPLING_API_KEYS` on Admin and `ADMIN_SEARCH_EVAL_API_KEY` on
  Mastra.
- Use explicit `sources: ["catalog", "trace"]` for local smoke unless
  `OPENROUTER_API_KEY` is intentionally present for `locale_quality`.
- Confirm `/api/workflows/eval-query-generation/runs` and
  `search_eval_candidate` rows after a Studio run. Seeing a Studio "success" row
  alone is not enough because `{ ok: false }` is still a completed workflow
  result.
- Keep generated candidates separate from promoted truth. A successful local
  run should create staged candidates only; it should not affect permanent
  regression gates.
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
