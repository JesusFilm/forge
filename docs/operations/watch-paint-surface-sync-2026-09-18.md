# Watch cold-paint investigation — 18 September 2026

The reproduced approximately ten-second H1 / first-paint stall is a Chrome
browser-surface synchronization delay. The Web application performed paint work
earlier; presentation waited for the browser toolbar surface. A targeted browser
feature control removes the stall with the application unchanged. This completes
feat-515's original cold-paint investigation without changing preview timing,
poster behavior or telemetry. It does not establish general Watch recovery.

## Recovering the original experiment

The original matched study was committed in PR #2321 at
`89277c0ffae860e80e46bfc6c8cf5b7fef9d1925`. A wider session-content search found
its harness in the long-running September 15 session; a search limited by session
start date had missed the September 16 tool calls. The retained harness and early
PNG were copied into this task's own worktree. No other agent's worktree, browser
session or service was reused.

The recovered agent-browser version is 0.37.1. Replaying it launches Google Chrome
for Testing 153.0.8010.36, headless, with an outer 1280×720 window and actual inner
1280×577 viewport, DPR 1. The original user-agent explicitly names Chrome 153.
Each run uses a fresh named browser/profile and the original paint/long-task
observers. Browser cache is cold; the local Web server cache is warm. The local
production build reads the public catalog through a query-only proxy and a fixed
route-manifest snapshot. An initial manifest-timeout/404 batch is excluded.

The exact URL is `/watch/1-the-simple-gospel.html`, without a query string. The
original protocol opens the page, waits for document completion and a video
element, then waits five seconds before reading the accumulated timeline.

Four recovered-harness local runs reported first paint and H1 LCP at
424 / 408 / 444 / **10,004 ms**. In the slow run, TTFB was 205 ms, DOM content
478 ms and load 479 ms. The historical fast-document/late-H1 behavior is therefore
reproduced; the different Chromium 149 / 1440×1000 study had missed this case.

## Cause and controls

Six further runs captured font readiness, focus, visibility, layout and timer
progress. Two slow runs had fonts ready at 356/321 ms and visible, focused
documents, while the paint timeline stayed empty through five seconds. Their
first paint occurred at 10,020/9,996 ms. Screenshot requests started at
2,297/2,313 ms but completed after 10,279/10,262 ms. The returned pixels cannot
be labeled as screenshots of the requested early instant.

Six Chrome traces distinguish renderer paint from presentation:

| Run | First renderer Paint | Presented firstPaint | Browser surface wait |
| --- | -------------------: | -------------------: | -------------------: |
| 0   |             1,864 ms |             9,971 ms |             9,999 ms |
| 1   |               228 ms |               321 ms |         No long wait |
| 2   |               213 ms |             9,993 ms |             9,999 ms |
| 3   |               364 ms |               457 ms |         No long wait |
| 4   |               247 ms |             9,957 ms |             9,999 ms |
| 5   |               216 ms |               298 ms |         No long wait |

Each slow trace records `Surface deadline passed` and a
`SurfaceSynchronizationEvent` of 9,999 ms on the browser surface, followed by
`chrome://webui-toolbar.top-chrome` first visually nonempty paint, then Watch
first paint. The renderer was doing page paint work well before presentation.

The pinned Chromium source propagates the initial toolbar synchronization
deadline to the active tab and resets it after toolbar paint. Its feature
parameters specify 600 frames (ten seconds at 60 FPS) and a 10,000 ms renderer
commit delay. These match the observed mechanism, rather than merely matching
an application timer. Sources:
[toolbar surface deadline implementation](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.36/chrome/browser/ui/views/toolbar/webui_toolbar_web_view.cc),
[feature parameters](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.36/third_party/blink/common/features.cc),
[Chromium architecture explanation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/webui/webui_toolbar/README.md).

Twelve alternating local runs compare the default browser with
`InitialWebUISurfaceSync` disabled. The first two pairs include overlap with the end of tracing
and are excluded from the clean timing comparison. In the remaining four pairs:

- Default first paint: **316 / 10,012 / 9,984 / 10,008 ms**.
- Feature disabled: **316 / 416 / 260 / 284 ms**.

The local CLI override replaces its default disabled-feature list. A separate
confirmatory control preserves `Translate` and adds only
`InitialWebUISurfaceSync`, using a temporary executable wrapper; this removes
that launch-configuration confound. Three pairs against a static HTML page with
no app scripts, fonts or media all paint at 40–56 ms, including defaults. Thus
the delay is intermittent and is not universal on every navigation.

Three pairs against production Web revision
`c813991ad3645aebdb50d6b1cac92a47b5aad250` report:

- Default first paint: **9,976 / 540 / 640 ms**.
- Feature disabled, preserving Translate: **460 / 464 / 1,012 ms**.

The slow production document completed loading at 2,076 ms, well before paint.
All six production visits had the expected heading, Watch now and a playing
muted preview, with no captured JavaScript errors. These are causal diagnostic
samples, not user percentiles or a before/after production application release.
All feature overrides are confined to owned local browser processes, which were
closed afterward. No production setting or application code changed.

## Repeat and interpret

Use agent-browser 0.37.1 with the exact Chrome executable above. Record its
`--version`, effective launch arguments and `innerWidth`/`innerHeight`; do not
assume the outer window dimensions equal the viewport. Use unique session names
and pass the same launch configuration on every command. Retain every LCP
candidate and `performance.getEntriesByType("paint")`, plus navigation timing,
document visibility, font readiness and media state. Close only owned sessions.

For traces, run `agent-browser trace start` before opening the URL and
`agent-browser trace stop <owned-path>` after the measurement. Align trace events
to the Watch document's navigation ID, not the last iframe navigation. Compare
renderer `Paint`, `firstPaint`, `SurfaceSynchronizationEvent` and the toolbar's
`WebContentsImpl::OnFirstVisuallyNonEmptyPaint` origin. Save screenshot request
and completion times separately.

For the diagnostic control, append the single Chrome argument
`--disable-features=Translate,InitialWebUISurfaceSync` in an owned executable
wrapper, preserving existing arguments. Agent-browser 0.37.1 splits its `--args`
value on commas, so passing that list directly would split it incorrectly. Run
alternating fresh default/control browsers against the same application and
cache conditions. This is a labeled control, not a global browser configuration
change or a way to suppress default-run failures.

Numerical evidence, control metadata and trace hashes:
`docs/validation/watch-followups-2026-09-18/paint-surface-sync.json`.

## Limits and remaining production work

The September 16 study already established this behavior predates the sound-off
release. Its recovered harness and today's trace/control evidence identify the
mechanism of the reproduced shape. The old individual runs did not retain
traces, so their internal surface events cannot be retroactively verified.
The immediate correction is to the verification method and evidence, with no
justified Watch code change for this browser stall.

The later VIDEO LCP is separately explained by native poster mounting, including
when HLS is blocked. Neither result explains every slow non-headless field
event. The retained field study found mostly first-byte-dominated heading
delays, plus two mobile post-response delays; see feat-520 for the latter's
focused attribution work. No Chrome feature experiment was run on user devices.

feat-496 remains open for actual request failures. In the uninstrumented
00:46:58–00:47:52 UTC browser batch, 12 delivery HTTP 200s included ten served
responses, one `delivery_timeout` and one `in_flight`. Four selection
acknowledgments succeeded, one browser request aborted, and one navigation sent
no selection request; its correlated server trace includes a selection HTTP 503.
Do not present these semantic fallbacks or failed acknowledgments as recovery.

Later retained APM spans for 00:50–01:20 contain 14 playback HTTP 503s and 12
evidence HTTP 503s; these are sampled span counts, not population rates or
proof of one cause. Twelve retained recommendation-delivery HTTP 200 spans do
not reveal their body semantics. In the same window, workflow counters show
1,485 flow / 785 step callbacks on `forge-admin-worker` at `c813991ad`, with no
Admin callback series, extending the runner-isolation observation.

At 01:26:28 UTC, a fresh SSH runtime check confirmed Admin, worker and Web all
run `c813991ad3645aebdb50d6b1cac92a47b5aad250`. Admin's runner flag is false,
the worker's is true, and profiling remains enabled. Railway reports the later
documentation-only `5f34355ef` revision skipped by all three service filters;
that docs revision must not be mistaken for the executing application revision.

Sequential Compound Engineering review checked causal attribution, negative
controls, screenshot timing, privacy, scope and roadmap consistency. The review
excluded the overlapping local measurement pairs and retained the separate field
follow-up. Validation passed formatting, `git diff --check`, two hidden-roadmap
regressions and the public-roadmap lane check. This closure changes documentation
and evidence only; the prior code PRs' unit, real-database, build and production
acceptance results remain in the companion release report.
