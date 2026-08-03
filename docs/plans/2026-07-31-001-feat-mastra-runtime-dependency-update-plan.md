# Mastra runtime dependency update plan

## Scope

Upgrade the coordinated Mastra dependency set used by `apps/mastra`, satisfy
the updated Editor peer contract explicitly, adapt the standalone runtime to
any public API changes, and validate the same tests and deploy build that guard
production behavior. Admin's legacy in-process Mastra playground remains out of
scope.

## Work units

1. Pin the current compatible Mastra Core, CLI, Editor, MCP, storage, memory,
   logging, and observability releases in `apps/mastra/package.json`.
2. Regenerate `pnpm-lock.yaml` through the repository-pinned pnpm version and
   inspect the resulting peer graph for duplicate or unmet standalone-runtime
   peers.
3. Run typecheck first to identify public API drift, then update runtime code
   and focused tests only where the new packages require it.
4. Run the complete Mastra test, typecheck, lint, and Studio build checks.
5. Run a dependency freshness check, review the dependency-manifest diff, and
   record the validated release set in the roadmap completion notes.

## Stop conditions

- Do not broaden into the Admin playground dependency set.
- Stop and document a follow-up instead of weakening authentication, storage
  separation, observability redaction, or devotional lifecycle protections.
- Do not publish if the Studio build or the full Mastra test suite is red.
