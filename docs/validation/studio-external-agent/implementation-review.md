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

## Remaining review gates

Narration is under independent authority/specification review. Inspection,
human review, portable skill, final integration, and real-client qualification
require their own evidence before this record can establish completion.
