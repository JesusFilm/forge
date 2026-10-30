> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Calendar loading comparison (work in progress)

The first matched comparison used the same 18-project dataset, browser,
1440×1000 viewport, origin and backend. These are browser-cache cold/warm samples;
the server was already warm. All five samples per condition are retained.

Cold controls-ready medians were slower: list 285.6→346.5 ms (+60.9), create
224.5→252.6 ms (+28.1). Warm medians were list 228.8→223.0 ms and create
134.4→136.9 ms. Cold JavaScript transfer increased 626 bytes on both routes.
Observed CLS was zero. Shared host load changed from approximately 2.97 to 4.83;
that is a confound, not evidence that the slowdown is noise. Ranges overlap.

Calendar RSC prefetch is actual added route work: the feature sample contains
18 calendar requests completed before controls readiness, totaling 12,960 bytes;
baseline contains none. Resource observations here stop at controls readiness,
so later requests are not represented. This does not isolate causal latency.

`matched-feature-repeat.json` is a feature-only repeat started before root limited
follow-up to one alternating comparison. It is retained, not substituted for the
first sample or treated as matched evidence. No further sequential repeats will
be used to seek a passing result.

The authorized follow-up is one five-round AB/BA alternating comparison with
identical dataset/backend/origin across variants, browser CPU profiles, complete
resource timing through one second after readiness, CLS/long tasks and host CPU/
load snapshots. Profiling overhead applies to both variants. No own builds or
DB tests run during samples. Results and limitations will be added when complete.

## Single alternating follow-up

Completed all 40 samples (five AB/BA rounds, two routes, cold/warm browser cache).
Before/after dataset digest is identical:
`a1e051a15962548c5896fe7448df6e6f|21`. Three isolated database regression fixtures
were added after the first comparison, so this matched pair is a separate dataset
from the original 18-project sample. No own builds or tests overlapped measurement.
Feature source restoration hashes are retained. Both prebuilt variants ran on
origin `http://127.0.0.1:3461` against the same unchanged Admin backend.

| Controls ready, ms | Baseline median (range) | Feature median (range) |
| ------------------ | ----------------------- | ---------------------- |
| List cold          | 227.4 (184.6–553.9)     | 229.9 (173.6–469.0)    |
| List warm          | 322.2 (203.8–447.1)     | 234.8 (204.3–270.5)    |
| Create cold        | 167.9 (159.7–188.4)     | 227.0 (156.5–281.0)    |
| Create warm        | 129.7 (121.8–143.0)     | 136.3 (128.8–169.6)    |

Create cold remains slower by 59.1 ms at the median, with mixed paired direction
and overlapping ranges. List results do not repeat the initial cold-median gap.
This is **inconclusive for attribution and not a performance pass**. No further
measurement retries or speculative optimization were performed.

The feature list has two calendar RSC prefetch requests per sample through the
post-ready window; baseline has zero. Neither variant prefetches calendar on the
create route. Cold JS transfer remains +626 bytes. These establish added route
work but do not explain the create-page slowdown. Median create-cold browser task
CPU is 283.8→330.9 ms and script CPU 50.2→63.3 ms, including the one-second
post-ready window. Observed long tasks and CLS are zero throughout this comparison.
Host load remained variable (group medians 2.45–3.55); per-sample load and cumulative
host CPU counters are retained rather than used to dismiss observed differences.

`alternating-loading.json` retains navigation/resource waterfalls at readiness and
one second later, browser task/script/layout counters and host snapshots.
`alternating-cpu-*.json.gz` are losslessly compressed Chrome CPU profiles for every
sample. Profiling, process warmup and the observation window are identical between
variants, but differ from the first comparison protocol. Do not combine medians
across protocols. `alternating-summary.json` retains every metric sample.

The shared `/tmp` filesystem exhausted inodes before the source-state browser
smoke; those pre-request failures remain in `../browser/`. Both alternating
variants used verified rootfs-backed profile/cache paths under the short task-owned
`/home/tataihono/.studio461-tmp`. The first harness preflight failed before any app
request because command-line introspection requires `--enable-automation`; its log
is retained. That flag was then applied equally for the complete single comparison.

## Bounded attribution using the captured run only

`create-attribution.json` records the offline source/bundle/profile inspection.
`StudioCreate` source is byte-identical to the reviewed baseline. The added shell
breadcrumb condition occurs after the create-path return, so it is not evaluated
for `/dashboard/shorts/new`. The new calendar link renders only in StudioProjects.
Both exports share a client module, which accounts for some additional bundled
bytes on create, but does not mount the list component or its effects there.

Across all five create-cold samples, normalized non-code request routes and counts
match exactly: existing jobs polling and sidebar prefetches remain. There are no
calendar route requests and no calendar client chunk requests. The inspected
shared React/Next runtime chunks listed in the attribution artifact are
byte-identical between builds. Profiles continue to sample those common stacks,
framework/module evaluation, browser work and the test driver's interactions.

Sampled self CPU in the project chunk has median 0→1.283 ms and shell 2.198→1.615
ms. Sampling zeros do not mean no execution, and self time excludes descendants;
these figures cannot explain or rule out the +13.1 ms aggregate script median.
The added bundle bytes are real, but no specific avoidable new initialization,
hydration or network operation on create was demonstrated. No speculative code
change was made. The +59.1 ms create-cold result remains explicitly unresolved for
final release review; no additional measurements were taken.
