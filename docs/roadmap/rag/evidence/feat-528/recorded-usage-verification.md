# Recorded consumer usage correction — local verification

The product owner removed coverage/inventory as a design mistake on 2026-09-29.
The requirement is recorded request/success numbers per consumer for the unchanged
selected date range, regardless of interruptions. This correction changes code
and documents, not production configuration or private consumer-key custody.

## Red/green reproduction

The isolated PostgreSQL regression used five stored Ragbot requests/successes and
the screenshot's exact range, `[2026-09-22T05:17Z,2026-09-29T05:17Z)`.
Before the fix, `usage-counts.integration.test.ts` failed because the report had
`coverageStatus: unavailable`. After the fix it returned 5/5, unchanged boundaries,
no coverage or complete-through fields, and zero for an unused consumer.

The browser regression was also run against the original main adapter, coverage
helper and Usage module, temporarily restored in this isolated worktree. It
failed on the actual symptom: the table had `—`, `—`, last activity and
`unavailable`, instead of the expected 5/5. Original files were then restored to
the corrected implementation. Both browser tests passed with the corrected code:
counts/details, unchanged dates, zero usage, absent Coverage/watermark fields,
narrow-screen layout, and actual failed reads clearing stale totals with an error.
The portal and PostgreSQL report adapter are real; admission is synthetic and the
directory is limited to the two test fixtures. No production session/key is used.

## Package and database checks

- `pnpm --filter @forge/rag test`: 907 passed; five conditional integration tests
  skipped without a DB. Import-law checks passed. Consumer audit/session tests
  were exercised separately in the full DB verification below; the unrelated
  external dashboard-query integration remained conditional.
- `DATABASE_URL=<isolated localhost> pnpm --filter @forge/rag db:verify`:
  46 passed, with 51 restricted consumer-role cases conditional on dedicated
  role URLs. Those 51 cases plus the two HTTP lifecycle cases then passed using
  locally provisioned synthetic restricted consumer roles. No skipped usage cases.
- Minimal usage writer/report roles worked with no collector/gap/inventory rights.
  Real admission/completion privilege failures preserved other stored counts;
  pending requests did not hide totals. Recovery and deduplication preserved
  request/success counts. Corpus/credential reads and inventory writes were denied;
  unexpected corpus grants remained rejected. Legacy narrow metadata grants
  stayed compatible without being required.
- PostgreSQL tests covered concurrent +3 then +2, rotation, exact half-open
  admission boundaries, consumer isolation, stale historical collectors/gaps,
  unfinished attempts, historical zero, unknown-consumer error and old/new
  pending writes during rolling deployment.
- Real HTTP tests covered completed responses, invalid/retrieval failures,
  revoked auth, disconnects and a failed accounting write followed by recovery.
  CLI tests printed 5/5 with no coverage fields and exited nonzero on DB-read error.
- Typecheck, lint, schema validation/tests and hidden-roadmap tests/check passed.
  Existing unrelated hidden-roadmap frontmatter notices remain unchanged.

Migration `20260929020000_simplify_usage_counting` was tested upgrading the
previous ten migrations, and all eleven migrations were applied from zero to a
second disposable local DB. A repeat deploy was a no-op, status was current and
schema drift check passed. Only the legacy pending collector reference becomes
nullable. Counts/timestamps and old metadata are preserved; old instances can
still insert collector references while new instances omit them.

## Page loading

Initial portal navigation made zero Usage module/report requests. Entering Usage
loaded the module once; measured local load times were 4.2–5.1 ms. The two report reads
came from entering Usage and applying the selected range. Usage JS decreased
from 10,660 to 10,091 bytes; no new runtime dependency or initial-page script was
added. Local timings are a smoke measurement, not a production performance claim.
The browser regression runs in the RAG database CI job through
`pnpm --filter @forge/rag portal:usage:verify`.

## Release scope

No direct production DB writes, role changes, variable changes or deployment were
performed for this correction. Normal PR-to-main migration/autodeploy remains
required. Reporting returns stored aggregates even if recording was interrupted;
it cannot reconstruct requests whose accounting was never persisted. Retired
metadata/migrations are inert history for audit and rollback, not an ongoing
inventory/recovery requirement. Feat-529 lifecycle/isolation, migration grace and
separately approved shared-token cutoff remain outside this fix.
