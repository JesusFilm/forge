# feat-501 validation record

## Status

The reproducible probe is implemented, but the baseline is **not measured**.
On 2026-09-14 this worktree had neither `DATABASE_URL` nor
`TARGET_DATABASE_URL`, and `pg_isready -h db -p 5432 -U forge -d forge_admin`
reported `db:5432 - no response`. No local or staging fixture was therefore
available. This is an external evidence blocker, not a passing baseline.

The intended pre-fix revision is identified by the available short SHA
`1d7e0ede7`; record its resolved full SHA when the baseline environment is
available. The incident cardinalities from
the plan are 125 referenced videos and 143,030 active Dubs (up from 64 and
4,344). The largest representative collection count is still unknown and must
be measured from the isolated fixture before the performance gate can pass.

## Frozen workload contract

Use `probe:experience-editor-video-data` unchanged for the baseline and fixed
revisions. Use the same disposable PostgreSQL copy, experience locale, cookie
principal, request bodies, URLs, Admin process, hardware, warm-up count, and
measurement order.

The default gate is:

- one recorded cold editor request, then one unrecorded warm-up;
- 30 rounds at editor concurrency 1 and 30 rounds at concurrency 4;
- one public control request in every editor round plus 30 no-editor control
  requests;
- 20 idempotent open/save cycles, with RSS sampled after the same 60-second
  idle interval;
- one explicit add-all request for the largest direct-child collection;
- Admin RSS sampled from `/proc/<pid>/status` every 25 ms;
- emitted SQL counted as new non-empty records in an append-only JSONL log,
  with exactly one PostgreSQL statement per record;
- pool timeouts counted from new Admin log lines containing `P2024`,
  `pool timeout`, or `timed out fetching a new connection`;
- serialized Dub records counted from the exact `"streamUrl"` property marker
  in the uncompressed editor response. Keep the marker unchanged across both
  revisions.

The report contains raw absolute timings, response bytes, Dub-marker counts,
RSS samples, statuses, fixture counts, revision, cold/warm state, target
fingerprints, and hardware. It stores no response bodies, URLs, headers,
cookies, authored blocks, or inventory values.

## Fixture recipe

Follow `apps/admin/docs/worktree-preview-setup.md` to copy, migrate, and run an
isolated database. Do not benchmark a shared database. Select the `/watch-home`
locale matching the incident cardinalities, then record:

1. the exact source snapshot and disposable database name outside committed
   artifacts;
2. referenced video and active-Dub counts;
3. the maximum direct-child collection count and its ordered expansion cost;
4. Admin PID, CPU model/count, memory, OS, revision, and cold/warm state;
5. PostgreSQL JSON statement log and Admin runtime log paths.

Create the session cookie file outside the repository with mode `0600`. Request
body and header files must describe an idempotent save of the same draft and
must not be committed. Header JSON may not contain `Cookie` or `Authorization`;
the probe rejects those fields and never emits header values.

## Commands

The dry run works without a database or credentials and prints the redacted
contract:

```bash
pnpm --filter @forge/admin probe:experience-editor-video-data -- \
  --dry-run \
  --fixture incident-2026-09-14 \
  --revision 1d7e0ede7 \
  --referenced-videos 125 \
  --active-dubs 143030
```

Once an isolated fixture exists, run the same command on both revisions,
supplying the concrete local URLs and untracked request files:

```bash
pnpm --filter @forge/admin probe:experience-editor-video-data -- \
  --environment local \
  --fixture incident-2026-09-14 \
  --revision <revision> \
  --editor-url <local-editor-url> \
  --cookie-file <mode-0600-cookie-file> \
  --public-url <local-public-query-url> \
  --public-body-file <public-query-body> \
  --save-url <local-idempotent-save-url> \
  --save-body-file <save-body> \
  --save-headers-file <save-headers> \
  --collection-url <local-collection-action-url> \
  --collection-body-file <collection-body> \
  --referenced-videos 125 \
  --active-dubs 143030 \
  --largest-collection-children <measured-count> \
  --server-pid <admin-pid> \
  --sql-log <postgres-jsonl-log> \
  --server-log <admin-log> \
  --out <baseline-or-fixed.json>
```

For the fixed run add `--baseline <baseline.json>`. The comparison reports
fixture equality, serialized-Dub reduction, peak-RSS-delta reduction, and
public-query p95 change. Any `evidenceCoverage.gaps` entry leaves the gate
incomplete. If the largest collection exceeds the editor budget, stop and
replan instead of truncating it. If bounded SQL passes but RSS does not, capture
and attribute a heap profile as required by the plan.

## Required evidence before completion

- Baseline and fixed JSON reports from the same fixture and hardware.
- At least 30 timing rounds, with absolute measurements retained.
- At least 90% fewer serialized Dub records.
- At least 75% lower editor-induced peak RSS delta.
- Final-five idle RSS mean no more than 5% above the first five and a 95%
  linear-trend confidence interval that includes zero.
- No editor or paired-public 5xx and no pool timeouts at concurrency 1 or 4.
- Paired public-query p95 no more than 20% above the no-editor control.
- Complete largest-collection expansion without truncation.
