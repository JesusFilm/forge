# feat-501 validation record

## Status

**Complete.** The frozen baseline and fixed-revision runs were measured on
2026-09-14 against the same disposable PostgreSQL fixture and hardware. All
behavior, resource, concurrency, and completeness gates pass.

- Baseline revision: `1d7e0ede779173d053f6844262b9206840993241`
- Fixed revision: `9ca6e5af08cbb89334600dedb3e32b1e2e58670c`
- Fixture: 125 referenced videos, 143,030 active Dubs, and a 124-child
  collection
- Hardware: Intel Core i7-14700F, 28 logical CPUs, 64 GiB RAM, Linux
  7.2.3-arch1-3
- Sampling: five warm-ups; 30 rounds each at editor concurrency 1 and 4; 30
  no-editor public controls; 20 open/save cycles with a 60-second idle

The raw JSON reports stayed outside the repository because they are generated
runtime evidence. The durable results below contain the values needed to
reproduce and audit the gate without retaining cookies, request bodies, or
authored content.

## Results

### Like-for-like baseline comparison

| Measure                |        Baseline |        Fixed | Outcome                   |
| ---------------------- | --------------: | -----------: | ------------------------- |
| Cold editor latency    |    5,466.821 ms |    58.245 ms | 98.9% lower               |
| Cold response size     |    39,028,297 B |    112,620 B | 99.7% lower               |
| Serialized Dub markers |         143,026 |            0 | 100% lower; pass (>=90%)  |
| Peak RSS delta         | 4,837,748,736 B | 59,191,296 B | 98.8% lower; pass (>=75%) |

The comparator reported `comparable: true`, `sameFixture: true`, and no
fingerprint mismatches.

### Concurrent editor and public GraphQL workload

| Editor concurrency | Editor p95 | Paired public p95 | No-editor public p95 | Increase | Failures / pool timeouts |
| -----------------: | ---------: | ----------------: | -------------------: | -------: | -----------------------: |
|                  1 |  45.985 ms |         17.801 ms |            16.891 ms |    +5.4% |                    0 / 0 |
|                  4 |  74.166 ms |         16.277 ms |            16.891 ms |    -3.6% |                    0 / 0 |

Both public p95 results pass the maximum 20% increase. The committed full run
independently measured +12.1% at concurrency 1 and +9.1% at concurrency 4,
also with no editor failure, public failure, or pool timeout.

### Completeness and repeated-use stability

- Collection Apply returned 124 children, all 124 unique, with ordered digest
  `07058f6e1bc2d0718b5eb355bc29df985f1be930de0a5c20fe250a829422b38c`.
- The first five post-idle RSS samples averaged 645,106,073.6 B; the final five
  averaged 618,698,342.4 B, 4.1% lower and therefore within the +5% ceiling.
- The 20-cycle RSS trend was -1,911,199.8 B/cycle with a 95% confidence
  interval of [-4,609,084.3, 786,684.7], which includes zero.
- Full evidence coverage reported `complete: true` with no gaps.

## Frozen workload contract

Use `probe:experience-editor-video-data` unchanged for the baseline and fixed
revisions. Use the same disposable PostgreSQL copy, experience locale, cookie
principal, request bodies, URLs, Admin process, hardware, warm-up count, and
measurement order.

The default gate is:

- one recorded cold editor request, then five unrecorded editor/public warm-up
  rounds so both routes have the same hot-state basis as the trailing public
  control;
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
  --warmups 5 \
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

## Completed evidence checklist

- [x] Baseline and fixed reports used the same fixture and hardware.
- [x] Each concurrency profile retained 30 absolute timing samples.
- [x] Serialized Dub records fell by at least 90%.
- [x] Editor-induced peak RSS delta fell by at least 75%.
- [x] Repeated-use mean and trend confidence-interval gates passed.
- [x] No editor/public 5xx or pool timeout occurred at concurrency 1 or 4.
- [x] Paired public-query p95 stayed within 20% of no-editor control.
- [x] The largest collection expanded completely without truncation.
