# Import editorial recommendations into the existing comparison path

Scope: feat-741, extending PR #2809 at the user’s explicit request. Reuse the
protocol-1 saved-generation producer contract already deployed in Admin.
The newer full-library generator stores private offline artifacts, not directly
servable Admin rows; do not misrepresent editorial work as its model output.

Prepare an immutable content-only import plan from the committed editorial list.
Read-only validation uses `validatePrecomputedChoices`; expected content-identity
rejections are reported and removed in original order, with contiguous ranks.
Five unresolved evidence sources retain empty rows and explicit exclusions.
Abort unexpected database/validation errors. Bind the source set, source artifact,
cutoff, decisions and omissions into the plan digest. Execute through the deployed
authenticated ingest endpoint, preserving its replay, stale-input and completion
checks. Save sanitized preflight/import receipts. Completion makes this generation
selectable in existing Admin comparison and private A/B tools; no public routing
or experiment activation is part of the import.

Test the adapter with failure/replay coverage and run the production preflight
before any write. Reconcile database counts and incumbent/public-control state
afterward. Publish code/docs through the existing PR; no direct code deployment.

## Result and durable findings

The deployed protocol-1 endpoint completed generation
`editorial-catalog-20261019-v1` at 2026-10-19T03:14:57.948Z. The independent
readback confirms 1,031 sources / 6,147 links, with no missing targets or
self-links and unchanged public controls. Nine canonical-identity exclusions and
30 withheld links from five unresolved-evidence sources are recorded in the
committed preflight report. Existing six-choice review artifacts are unchanged.

Preparing sources concurrently with a bound of four keeps the existing main
pool budget and preserves input order. The standalone adapter reuses current
contract validation rather than reproducing its identity logic. Current main's
shared-reading import is a separate producer with stronger frozen-evidence and
receipt requirements; an editorial import must not impersonate that producer.
Allocate roadmap IDs against freshly fetched main: feat-739, feat-740, feat-741.

Checks: 32 tests across adapter, reader, native PostgreSQL contract and HTTP
route passed; scoped TypeScript and touched ESLint passed. An initial unbounded
whole-app tsc exhausted its default heap; it is not claimed as a successful
whole-app check. The importer and its full dependency graph passed the bounded
scoped check. No public serving or experiment controls were changed.
