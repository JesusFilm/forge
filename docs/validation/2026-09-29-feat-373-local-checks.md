# Feat-373 local verification

This receipt covers the origin-issued v2 manifest implementation and its bounded
Admin report. The feature remains in progress until normal automatic rollout,
healthy migration/service revisions and authorized deployed browser/Admin
reconciliation establish coverage. Independent Admin/Web builds can finish in
either order; new-Web/old-Admin compatibility falls back to v1/unknown coverage.
No ranking, experiment, profile, traffic-admission or rate-limit changes are
included. Migration 0105 is reserved for this change; no additional migration is
reserved by this batch.

## Checks

- Frozen dependency install, Prisma client generation, Admin SDL printing and
  shared GraphQL client generation passed. The SDL adds the issuer mutation and
  nullable direct-search descriptor.
- Full Admin suite before the report performance/filter delta: 473 files passed,
  60 skipped; 7,455 tests passed, 368 skipped, one todo. Broad Admin lint passed.
- Final report delta: 12 focused tests passed (seven actual PostgreSQL fixtures,
  five unit tests), including full identity/policy/position/path isolation,
  pre-window ordinal history, receipt cutoffs, early selection, served-only v2,
  output tie ordering, truncation and optional-placement filtering. Thirteen
  Admin page tests passed, including bound filter forwarding, unchanged overview
  window, authorization and withheld invalid/ambiguous filters. Scoped ESLint
  passed for all six changed report/page files.
- Actual migration SQL contention test passed: the two-second lock timeout
  returned 55P03, the transaction retained the previous CHECK and no new index;
  after releasing the local fixture lock, exact SQL retry succeeded and enforced
  served-v2/no-capability/unique-card rules. This is not a claim that Prisma
  automatically repairs failed production migration state.
- Web source/contract focused suite before the tooling correction: 117 tests passed,
  including 77 independent
  actual-renderer/native-URL parity cases, 13 source adapters, six signatures,
  two feed-contract cases and 19 feed-route cases. The oracle resolves the real
  rendered href against the actual document URL; it does not reuse projection
  fallback logic. Scoped ESLint and nonincremental Web typecheck passed.
- Root-home strict prop expectations were updated for the proven public
  pathname; all seven homepage tests passed. Full Web lint and roadmap lint
  passed. Full implementation Web rerun before the tooling-only correction passed all 276 files (one skipped): 4,699
  tests passed, 10 skipped, one todo. Configured Admin typecheck passed using
  the repository's existing 8 GiB heap setting.
- The two actual database fixture files passed all eight tests locally with
  `--no-file-parallelism`; the dense statement measured 336 ms on that rerun.
  The existing CI database step uses an explicit file list that omits these
  fixtures. Adding them was rejected by GitHub because this OAuth credential
  lacks `workflow` scope; no credential or permission change was attempted.
  This PR retains the fixtures and reproducible local evidence, with automatic
  CI fixture wiring left to an already authorized workflow owner. The standard
  CI migration step still applies migration 0105.
- CodeQL found reflected fixture HTML input and double attribute unescaping in
  test tooling. Inline JSON now encodes literal `<` as a JavaScript Unicode
  escape; a real-browser closing-script attack confirms data round-trip without
  execution. The parity oracle uses inert DOM parsing to decode attributes once
  before independent URL resolution; all 78 parity tests passed. Production
  implementation files are unchanged by these tooling fixes.
- `git diff --check` passed. Normal lint-staged and repository formatting hooks
  passed for the implementation commit and remain enabled for the tooling follow-up.

Broad suites run serially with at most two Vitest workers. No existing timeout
was raised. Direct nonincremental Admin tsc hit Node's default 4 GiB heap; the
repository's configured typecheck uses its existing 8 GiB heap.

## Report failure reproduction and bounded fix

The parent's authorized production read-only diagnostics established that the
exposure schema and indexes were present and the signed report succeeded, while
the anonymous query cancelled with SQLSTATE 57014 at three seconds. Its plan
materialized a large ranked CTE and correlated an eligibility scan for every
first selection. A local 60,000-fact fixture reproduced the same cancellation.
The exact-partition first-eligible window calculation completed in 338 ms on the
same fixture, with the statement/transaction limits unchanged at 3s/4s.

The parent then ran one authorized candidate SELECT with a three-second statement
and one-second lock budget in a read-only transaction. It succeeded and returned
129 aggregate groups, the existing truncation sentinel. The receipt's 5,741 ms
includes SSH/transport and is not SQL latency. The new registry-entry/optional
placement filter applies bound values to both cohort selection and ranked
history, and maps signed identities to their existing version. A database fixture
with 130 earlier outsider groups proves the target cohort can be inspected before
truncation. The 128-row warning and unknown coverage remain explicit.

Parent diagnostic receipts are sanitized aggregates/plans only:

- [Anonymous execution](2026-09-29-feat-373-anonymous-execute.json),
  [plan](2026-09-29-feat-373-anonymous-explain.json) and
  [candidate](2026-09-29-feat-373-anonymous-candidate.json).
- [Signed execution](2026-09-29-feat-373-signed-execute.json) and
  [plan](2026-09-29-feat-373-signed-explain.json).
- [Aggregation cancellation log receipt](2026-09-29-feat-373-admin-aggregation-log-check.json).

## Browser, cache and graph evidence

The [actual local Chromium boundary/Admin fixture](2026-09-29-feat-373-browser-local.md)
passed 29 checks with 316 served and 316 v2 rendered facts, 33 accepted batches,
zero ingestion errors and zero duplicate served identities. Four alternating
baseline/enabled runs found medians of 25.90/24.75 ms DOMContentLoaded,
412.25/414.75 ms load and 38/42 ms FCP; script bytes were identical and three
telemetry resources appeared after load. This fixture does not execute full Next
routes, deployed search/feed, or the production ingress. Native BFCache was not
observed; hidden/prerender states were property simulations. History reload
issuance was separately verified.

[Independent final client graphs](2026-09-29-feat-373-client-graphs.json) prove
source/signing/Markdown compiler modules are absent from browser roots. Raw,
unminified export-preserving bytes are 665,294 for search, 627,423 for the feed
contract and 621,489 for shared exported helpers. These are not final Next chunks,
transfer sizes or a baseline bundle comparison. No full Next build is claimed.

The [parent signing configuration receipt](2026-09-29-feat-373-signing-config.json)
records configured/equal booleans with no secret values and no production
mutations. Production headless browser measurements remain page-load/excluded
traffic evidence because admission rejects its declared crawler UA. The parent
owns separate genuine headed ordinary-browser acceptance and preserves existing
admission/rate limits; local fixture success cannot stand in for it.

## Explicit authority gaps and release gate

Raw/Markdown navigation-relative anchors, including rootless same-scheme HTTPS
forms, require the exact public document pathname. Proven root/language home
routes supply it. Generic video/episode/preview callers withhold the whole
ambiguous source, preserving legacy v1 unknown coverage. Follow-up feat-564 owns
that remaining cached navigation authority. Unknown types and union slates over
100 cards also withhold v2 authority; ordinary lists retain a bounded first-100
projection. No claim is made that a particular live content block hits these
gaps. All eight anonymous registry entries remain incomplete pending deployed
reconciliation, and the table's filter does not change that gate.

Admin's ordinary sign-in blocker was cleared. The parent owns normal CI/merge,
deployment revision/migration receipts, deployed UI visual review, authorized
Admin reconciliation, exact public DOM/ingestion aggregate evidence, and final
roadmap evidence. No production repair, deployment bypass, secrets, raw viewer
identities or fabricated success is part of this receipt.
