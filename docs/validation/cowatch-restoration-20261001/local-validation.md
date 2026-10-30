# Local release validation

Validation ran in the isolated Co-watch worktree on Node 24.16, with the final
branch based on `3748973331e8ab78187de3c67bfbaf890bae37a4`. These checks establish
implementation readiness; deployment and real serving require separate receipts.

- Full Admin suite: 554 files passed, 97 skipped; 8,806 tests passed, 688 skipped,
  one todo. Database-only tests were exercised explicitly below.
- Final native commands against owned PostgreSQL 18 and all 126 migrations:
  refresh lifecycle 13 plus integrity reuse 6; trial authority 32 plus source
  query equivalence 1. All 52 passed with serial files and a 30-second test limit.
  These runs are local evidence. The owner requested removing the proposed CI
  wiring; feat-591 tracks that separate follow-up. Existing CI is unchanged.
- Final source-query, graph, projection and CLI focused suite: 59 tests passed.
  The frozen reference covers identity priority, invalid retained ownership,
  legacy missing generation, exact output ordering and full graph equivalence.
- Refresh API, new operator controls and existing owner controls: 26 passed,
  including delayed acknowledgements and retrying the original operation body.
- Retention: 15 native and 21 unit tests; owner operator: 9 unit tests passed.
- Admin lint and typecheck passed. Scoped formatting and whitespace checks passed.
  The commit hook additionally checks formatting across the repository.
- Official final Admin production build passed: 75 static pages and all retention,
  refresh, Studio and push workflow/step route registration verifiers. The build
  emits 97 nonfatal existing Node/Edge instrumentation warnings and a Node
  `url.parse()` deprecation warning.
- GraphQL schema emission passed with no SDL changes; generated GraphQL outputs
  are unchanged.
- UI loading and visual verification are recorded in `operator-loading-proof.md`.
  The new controls issue no initial requests and add 1,820 compressed JavaScript
  bytes in the local component comparison; this is not a production Web Vitals
  measurement.
- Final production source comparison: 40,605 identical rows and exact graph
  equality; 2.69 seconds under the unchanged five-second statement limit.
  Independent 60-generation retained-overlap fixture: 2.33 seconds with identical
  rows, fields and order. Receipts retain the earlier failures and fixture limits.

No production publication, owner activation or refresh authorization is implied
by these results. Neither roadmap ticket is marked complete on local checks alone.
