# feat-435 post-migration production evaluation baseline preflight

Observed at `2026-09-06T23:00:53Z` from Forge commit
`d8989661da7d69c8f1cbc84b191fdcd282732bcd`. This receipt contains no
credentials, connection details, evaluation questions, retrieved content,
URLs, embeddings, prompts, or corpus content.

## Result

Status: **blocked before evaluation**

The post-migration production baseline is not valid. The configured
`forge-rag/prd` evaluation credential did not satisfy the required read-only
privilege boundary, and this run did not independently prove that its database
URL resolved to the expected Forge production RAG database. No retrieval or
golden case was executed, so there are no case ranks, aggregate evaluation
metrics, or regression claims to report.

## Production target and deployment

- Railway project/environment/service: `forge/production/@forge/rag`
- Active deployment: `b6c077e8-7e48-45ae-815c-4c8be256d83d` (`SUCCESS`)
- Deployed branch and commit: `main` at
  `3e8f1dcf40fe052afdba6b09907b9b71d7e81d6f`
- PR `#2164` merge commit:
  `3e8f1dcf40fe052afdba6b09907b9b71d7e81d6f`
- Config-as-code path: `/apps/rag/railway.toml`
- Configured health path: `/v1/health`
- Fresh in-container health response: HTTP `200`, body status `ok`. The route
  returns a dependency-free constant, so this proves only that the process is
  listening; it does not prove database reachability or migration state.
- Doppler target: `forge-rag/prd`
- Production-read environment validation: `valid`. This check proves required
  variable presence and URL shape; it does not run the expected-host guard.
- Redacted credential-target fingerprint: `54e59a0d1467aff7`, computed as the
  first 16 hexadecimal characters of SHA-256 over the URL hostname, database
  path, and credential username. This custom fingerprint is not comparable to
  the server-address host hashes in the feat-430 corpus-copy receipt and must
  not be reused as a production write target pin.

The active deployment is the exact merge commit from PR `#2164`. Railway
recorded the later `main` commit used for this checkout as skipped for
`@forge/rag`, leaving the PR `#2164` deployment active.

## Read-only privilege inspection

A catalog-only inspection reported:

- transaction forced read-only: `false`
- restricted role attributes: `false`
- database `CREATE`: `true`
- database temporary-object privilege: `true`
- schemas with `CREATE`: `2`
- schemas owned through role membership: `2`
- relations with DML or relation-management privileges: `28`
- relations owned through role membership: `28`
- writable sequences: `1`

This is incompatible with the dedicated least-privilege evaluation/dashboard
principal required by the production evaluation runbook. The inspection made
no schema or data changes.

## Stop boundary and remaining uncertainty

The run stopped immediately after the privilege failure. In particular:

- the exact database target remains unverified because no expected-host guard
  was observed before the stop;
- production migration status was not queried and remains unverified by this
  run;
- the production retrieval/golden evaluation was not started;
- no historical evaluation evidence was reconstructed or promoted;
- no production write, deployment, configuration change, source selection,
  acquisition, staging, promotion, indexing, rollback, retirement, or archival
  action occurred.

Operator go/no-go: **NO-GO**. Do not run the `forge-rag/prd` production-read
evaluation or dashboard workflow with this credential, and do not begin later
new-source acquisition or indexing. Provision and independently prove a
dedicated read-only credential, then rerun the complete target, health,
migration, privilege, and evaluation preflight before any new-source work.

## Commands used

The following command shapes identify the observed workflow without including
secret values or connection details:

```sh
git fetch origin main
gh pr view 2164 --repo JesusFilm/forge --json ...
railway status --json
railway deployment list --project forge --environment production \
  --service @forge/rag --json
railway ssh --project <forge-project-id> --environment <production-id> \
  --service <rag-service-id> <loopback-health-check>
doppler run --project forge-rag --config prd -- \
  pnpm --filter @forge/rag env:check production-read
doppler run --project forge-rag --config prd -- \
  psql <vault-injected-production-url> <catalog-only-privilege-query>
```
