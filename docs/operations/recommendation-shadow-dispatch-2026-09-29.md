# Recommendation shadow dispatch recovery — September 29, 2026

Scope: feat-563, the dispatch portion of the
[governed live rollout plan](../plans/2026-09-29-003-feat-shadow-recommendations-live-plan.md).
This repairs operator retry and workflow ownership. It grants no graph,
experiment or live-serving approval.

## Operator contract

Retain one evaluation UUID and its exact window, manifest, generator, sampling,
retention, context, eligibility, sample-size and minimum-run configuration.
The evaluation UUID and generation select one deterministic workflow ledger ID.
The database atomically selects one caller to persist start intent before
calling Workflow. An exact retry can claim a prepared reservation whose start
was never attempted; it cannot claim an attempted reservation again.

| Dispatch state | Meaning                                                   | Next action                                                           |
| -------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `attached`     | Runtime identity attached; execution may not have begun   | Inspect the same evaluation and workflow                              |
| `running`      | Existing runtime observed running                         | Inspect the same evaluation and workflow                              |
| `uncertain`    | Runtime acceptance or current state cannot be established | Retain the tuple; inspect/reconcile the same ledger and known runtime |
| `terminal`     | Ledger or runtime is terminal                             | Inspect the separately persisted evaluation decision and reason       |

The operator reports `dispatch_uncertain` for an uncertain dispatch. Attached
or running dispatches report `queued` on initial invocation and
`already_dispatched` when reused. The `dispatch` object also returns the ledger ID, nullable runtime ID, reuse
flag and workflow status; supported runtime reconciliation adds runtime status.
`queued` is false for uncertain or terminal receipts. A terminal runtime alone
does not establish that the evaluation completed or passed.

Workflow 4.2.2 does not accept a caller-supplied runtime ID or idempotency key
at start. A thrown start can follow queue acceptance. If the process dies after
persisting start intent but before obtaining an ID, the application cannot
prove whether a runtime exists. Worker self-attachment can resolve that case;
otherwise operator investigation remains necessary. Never mint another
evaluation ID, delete the ledger or treat `FAILED` as permission to redispatch.

Known-runtime reconciliation performs one World read with a two-second wait.
Timeout, missing state and errors remain uncertain. This bounds the caller's
wait, not the underlying World request's completion. Runtime attachment has at
most two compare-and-set attempts. Conflicting runtimes cannot execute or
overwrite the attached runtime's terminal receipt. Terminal writes preserve
the original tuple.

Legacy random-ID ledgers are recognized conservatively. A legacy failed ledger
with an attached runtime is checked against World because the old start-error
handler could overwrite a running receipt. A legacy failed ledger without an
ID remains uncertain. Historical tuples missing fields are not reconstructed.
Serialize operational invocations during mixed-version deployment and inspect
any in-flight legacy workflow before retrying it.

## Validation

- Implementation revision: `e3f8f09ae8f47709312d0251c7f2ade2c797abef`.
- Worker validation: 93 focused tests across ten suites, including 17 native
  PostgreSQL tests; full Admin typecheck, scoped lint and repository format hook.
- Independent parent rerun: 59 tests across dispatch, operator, job, CLI and
  workflow suites, including all 17 native PostgreSQL cases.
- Full Admin production build passed, including Workflow discovery, bundle
  creation, TypeScript and the repository workflow registration verifiers.
- PostgreSQL fixture: isolated `forge_test`, loopback-only, dummy credentials;
  no production fault injection. Runtime acceptance/status was a controlled
  double, not a claim that a production Workflow run was exercised.

Native cases race first admission and exact retries, simulate loss before
start ownership and after queue acceptance, recover same-runtime attachment,
reject competing runtime writes, bound unavailable World reads, preserve
terminal configuration, run the empty-population job to inconclusive, and
retain stale-generation/source fencing. No migration is required.

Production execution, release receipts and co-watch acceptance remain separate
from these local checks. Ordinary recommendations are unchanged by dispatch.
