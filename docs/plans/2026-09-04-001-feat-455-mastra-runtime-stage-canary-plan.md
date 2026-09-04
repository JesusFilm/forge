# Mastra runtime update and production-derived stage canary plan

## Scope

Upgrade the coordinated direct Mastra dependencies used by `apps/mastra`,
adapt the runtime where necessary, validate the full package surface locally,
then deploy only `@forge/mastra` to an isolated Railway environment duplicated
from production. Observe automatic storage initialization and prove runtime,
Studio, and health behavior without changing production or shared `stage`.

## Work units

1. Resolve the current stable version of every direct `mastra` and
   `@mastra/*` dependency and update exact pins as one coordinated set.
2. Regenerate the lockfile and inspect the resolved peer graph for unmet or
   duplicated Mastra runtime peers.
3. Run typecheck and focused tests, adapt public API usage, then run the full
   Mastra test, lint, and production Studio build checks.
4. Duplicate Railway production into an isolated `mastra-update-*` environment
   and verify that the copy targets cloned data services rather than production
   resources.
5. Deploy only `@forge/mastra`, wait for the health gate, inspect migration and
   runtime logs, and probe the private canary's health and Studio surfaces.
6. Record the validated release set and canary evidence in feat-455, marking it
   complete only after every required check passes.

## Stop conditions

- Never target Railway production with an upload, redeploy, or config mutation.
- Do not deploy if local tests, typecheck, lint, or `mastra build --studio` fail.
- Stop before deployment if the duplicated environment still references a
  production database, bucket, hostname, or service variable.
- Do not weaken runtime safeguards merely to satisfy the upgrade.
