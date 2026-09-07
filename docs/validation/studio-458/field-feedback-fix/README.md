# Canonical proposal field/type feedback correction

Fixed review base: `2554442afcd0be5209789ff46c22a9b11ee434da` (closed paid
follow-up 2 evidence). This is a separate unpaid implementation correction.
No prompt changes, provider requests, proposal application or media generation
were performed for this correction. Full feat-458 acceptance remains in progress.

## Demonstrated failure and contract

The unchanged rejected ch19 proposal is retained in
`../native-hosted-followup-2/live/`. Its second proposal contains string
`fontSize` values. Canonical validation previously threw a Zod error that the
native boundary reduced to a generic asset rejection. The original paid streams
and the subsequent read-only diagnosis remain separate and unchanged.

`@forge/studio-contracts/production` now exports
`studioProposalFieldFeedbackSchema`, `studioProposalFieldRejectionSchema` and
`StudioProposalFieldError`. Code `PROPOSAL_FIELD_TYPE_MISMATCH` carries at most
eight facts: path `["operations", index, "properties", canonicalTextKey]` and
expected `number` or `string`. Index is bounded to 0–99. Keys are drawn from the
canonical text schema, never from arbitrary component/source payloads. No supplied
values, raw validator messages or unrelated errors are serialized. Facts need not
be exhaustive; the native message explicitly warns that other errors may remain.

Admin's canonical text-property validation rejects malformed values without
coercion. `/api/studio/tools` returns the strict 400 envelope with `no-store` only
after signed caller authority, current revision and admitted project checks for
`validate-proposal`. Malformed internal feedback stays generic. Native tool
feedback accepts only this strict envelope for that action/status within the
existing 4096-byte response bound. Unknown keys/types, oversized or unrelated
responses remain generic. Dynamic component properties retain their own schema.

Correcting the actual proposal's property types in the regression still produces
`ROLE_COVERAGE_UNCHECKED_IDS`; neither validation changes the persisted project.
This fix does not weaken coverage, introduce layout requirements or establish
editorial quality. It has no new live-provider acceptance claim.

## Verification

Preserved red tests demonstrate the original failure at canonical PostgreSQL,
authenticated HTTP and the next native model turn. Green tests cover those same
seams plus invalid feedback, unauthorized/wrong-project requests, unrelated errors
and dynamic component properties. `field-pg.log` records all 18 narration database
tests against the task-owned PostgreSQL instance; no shared database was used.

Full Mastra: 3,013 passed, 29 skipped. Full Admin: 6,147 passed, two failed,
138 skipped and one todo. Failures were the established Redis fallback environment
case and an unrelated SEO byte-budget test timing out at 10 seconds during the
parallel full runs. Both passed in the network-isolated rerun (40 tests total,
including the new property tests); SEO completed in 5.5 seconds. No timeout or
shared Redis setting was changed. The original failing full log is retained.
Contracts: 14 passed. Admin, Manager, Mastra and contracts typechecks passed after
fixing test fixture inference; the original type failure is retained.

Independent Standards and Spec reviewers inspected the complete diff against the
fixed base and the final fixture type annotation. Both reported no findings.
`reviews.md` records their conclusions. Build and hook results are recorded below.

No frontend rendering, routing, media loading or initialization code changed.
The existing matched browser/performance evidence remains applicable to those
unchanged flows; it is not relabeled as a new run or as paid quality proof.

## Final builds

Admin, Manager and Mastra production builds passed. Admin build ID: `mYU12-QYwWh7F4evVgHFH`; Manager build ID: `J8ugyJsgt4FRHamYe_782`. The Admin build also passed its recommendation workflow artifact check.

Builds used the existing task-local sanitized runtime; no credentials or services
were changed. Existing service processes were not restarted or stopped for this
correction. Build artifacts are newer than those processes, so any subsequent
browser use requires a documented restart; no fresh browser run is claimed here.

Of the 383 prior evidence-manifest entries, only HANDOFF.md changed (an explicit
appendix). All prior raw provider, source, fixture and comparison files match
their preserved hashes. No ledger was reopened.

Scoped ESLint and the full repository format check passed. The correction is
committed with normal lint-staged and full-format pre-commit hooks enabled.
