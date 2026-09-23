# External-agent workflow implementation review

Review follows the approved specification and published roadmap, with independent
standards and specification axes. This record is incremental; passing a slice
review does not qualify the complete workflow or either client.

## Connection and render

Reviewed on 2026-09-23. Standards review covered `fdd34d12c...b1862e6bd`;
render specification review covered `0c0006abf...b1862e6bd`. Reviewers did not
implement the reviewed render slice. Both were static reviews; the test evidence
below was produced separately by implementation and integration runs.

| Axis          | Actionable findings | Scope                                                                        |
| ------------- | ------------------- | ---------------------------------------------------------------------------- |
| Standards     | 0                   | Connection/render conventions, authority, immutable records, tests           |
| Specification | 0                   | Render admission, retries, source preparation, exact output, human authority |

The specification review traced descriptor materialization through the trusted
broker, per-issued-lease immutable preparation, and winning admitted execution
selection at catalog/publication gates. It checked expired/stale behavior and
scoped output access. Exact review UI and full real-client qualification remain
later acceptance gates.

A nonblocking duplication observation concerns manifest validation in
`draft-render.ts` and `catalog.ts`; no behavior change was requested.

After integrating narration and resolving overlapping scope/tool contracts,
Manager typechecking passed, nine focused Manager tests passed, and fifteen
guarded real-Postgres render/narration/catalog tests passed. The commit hook's
lint-staged and repository-wide formatting check passed. Prisma was regenerated
for the combined model. No Pothos fields changed in these slices.

The connection slice also received a separate specification review of
`72d02d991...0c0006abf`, with zero actionable implementation findings. It checked
current Operator enforcement, same-environment URL resolution, recoverable
conflicts, actor/client-bound retry receipts, and canonical history pagination.

## Narration recovery

Independent specification/authority review identified one P1: a lost response
after paid audio retention could invoke `preflight-error` and terminalize a
successful attempt before attachment. A duplicate runner's context failure could
also terminate another runner's live attempt.

Fix `1cef7c108` (integrated as `abdf03264`) replaces this path with bounded,
deduplicated reconciliation observations. It preserves run, attempt, and claim
ownership. Status exposes the diagnostic; retrying the original accepted request
can attach retained completed speech without another provider dispatch. Live or
ambiguous claims remain consumed, and already completed attachment stays intact.

An independent reviewer checked the fix, separate observation identities,
run-lock serialization, allowance accounting, and regression tests: zero
remaining actionable findings. Twelve real-Postgres tests passed again after
integration. The slice's eight fake-provider runner tests and Admin/Manager
typechecks passed. No paid provider call was used.

## Sampled inspection

Independent review found zero standards violations and one specification P2:
the original decoder deadline did not include context/asset-capability RPCs.
The fix propagates cancellation and bounds those calls, handles the broker's
earlier download timeout, and returns uncached incomplete evidence where exact
context is known. A failed final authority check remains fail-closed.

Final re-review found zero remaining findings on either axis. It checked exact
completed-output binding, immutable retention, decoder isolation, report size,
honest sampled-cut counts, and explicit retry after a stalled grant. Tests were
inspected by the reviewer; the implementer ran 16 Manager tests, 10 Admin DB
tests, 43 contract tests, and Admin/Manager typechecks. Six contained-render
fixtures separately measure rendering and evidence preparation; client reasoning
time is not established by those fixtures.

## CI integration correction

CI exposed a stale Auth seed test expectation of 29 scopes after the two explicit
consent scopes brought the count to 31. The full local Auth suite reproduced that
single failure. Updating the count and asserting both new scope records produced
587 passing tests; 99 environment-gated integration tests remained skipped.
Admin SDL and gql.tada regeneration produced no tracked drift.

## Remaining review gates

Human review, portable skill, final integration, and real-client qualification
require their own evidence before this record can establish completion.
