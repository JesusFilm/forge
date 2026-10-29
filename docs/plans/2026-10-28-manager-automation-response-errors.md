# Manager automation response errors

Scope: repair the creation failure at `apps/manager/src/app/dashboard/agents`, the automation API JSON boundary, and the client response handling. Track work in feat-906. The Compound Engineering commands are unavailable here; follow the plan, implementation, review and documentation loop directly.

The non-mock store still uses removed CMS operations. Admin has no automation replacement, so do not route legacy operations to Admin's incompatible schema or create local production state. Ask the owner whether to restore the recurring backend or present the missing capability honestly. While awaiting that decision, repair response handling and cover failures with regression tests.

Verification: focused Manager Vitest tests, typecheck, lint, Prettier and browser smoke. Compare page-load resource/timing evidence when changing rendering. Record durable findings under `docs/solutions/integration-issues/`.

Completed response handling and premature review submission fixes. The optional backend-scope question received no answer during implementation; no broader backend migration or unavailable-state redesign was made. Track the necessary durable backend restoration in feat-907. Validation and durable findings are recorded in feat-906 and the associated solution.
