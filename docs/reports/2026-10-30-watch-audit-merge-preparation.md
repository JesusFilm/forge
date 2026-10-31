# Watch audit merge preparation — October 30, 2026

## Scope and decision

The conversation covers 34 open PRs: 27 code candidates, five documentation
PRs, one held experiment (#2845), and one superseded PR (#2626). Nothing has
been merged or deployed. This report replaces readiness claims in the dated
October 20–21 reports; it does not replace their historical measurements.

The candidate is assembled locally from `main` at
`a672f688b3b7d33cf49bc3495f7a70eede7cfae5`. The validation branch is never
pushed. GitHub checks, review, and required production qualification remain
separate from local tests.

## Exclusions and unresolved gates

- **#2845: keep draft.** Reserving a six-card recommendation skeleton worsens
  accepted empty and partial outcomes. The native-anchoring alternative held
  reader position but did not improve CLS; a three-card outcome worsened
  0.8575 → 0.9279. That alternative was rejected and is not shipped.
- **#2626: superseded by #2829.** Do not merge its conflicting older hero
  implementation or its colliding feat-631 ticket. Closure is left to the owner.
- **#2848: authenticated live-manifest qualification remains open.** The
  production-server fixture proves document statuses, recovery, cache freshness,
  and real TTL behavior with synthetic data. It does not prove the current
  authenticated Admin snapshot. Do not infer a production pass from anonymous
  public reads or from a locally rendered recovery page.
- Physical screen readers/devices, random-hero crossfade, and non-English or
  markup caption-cue expansion remain tracked by feat-781. The authored-title
  content follow-up remains open in feat-763; shared popup-placement residuals
  remain in feat-782.

## Repairs prepared

- Current main's retired profile/co-watch and cookie controls stay deleted.
  #2821 now carries regression coverage and historical documentation only.
- History's roadmap ID is feat-909 (#2822); routing freshness is feat-908
  (#2848). Neither overwrites an unrelated main ticket.
- Search modal focus containment, cold lazy opening, inert header, and exact
  opener restoration are repaired in #2663. #2835 uses a compact single row
  below a 17rem container width, translated control names, and 44px targets.
  The existing logo asset is cropped; no second header row or image fetch is
  introduced.
- #2836 integrates with #2826's shared quality picker, clears the popup before
  Terms opens, preserves the selected quality, and closes Terms with one Escape.
- #2849 clears stale retry intent on a new error and removes only temporary
  focus attributes on blur. Its typed test helper and #2848's moved test
  imports are repaired.
- #2852 threads full subtitle language tags through current main's shared
  section renderer and preserves published audience journeys. #2740 is
  refreshed first so the child PR retains a narrow diff.
- #2840 integrates #2853's immediate first poster with passive intro load
  gating and the explicit Play/unmute bypass. #2829's refreshed motion controls
  remain the base.
- Contrast work in #2669 preserves #2637's accessibility order and uses the
  same wrapping home action row as #2829.

## Merge ordering

Merge independent PRs in the validated sequence below. For stacked PRs,
merge the parents first, retarget the child to main, and rerun checks against
its resulting exact head. No green-check snapshot removes that requirement.

- #2637 → #2838 → #2849 → #2848 (last item additionally held for live manifest).
- #2637 → #2669.
- #2826 → #2836.
- #2663 → #2835.
- #2740 → #2852.
- #2829 → #2840; **#2853 must also precede #2840**.
- Keep #2853 before #2833/#2834 in the retained performance rollout order.
- Merge docs #2825, #2827, #2832, #2841, #2855 after their implementation
  prerequisites. Prepared/complete roadmap entries are not proof of deployment.

## Validation

The combined candidate at `00de3f30b689c08ee09f1df879aa14b3b2771359`
contains all 27 exact code heads and the five updated report bodies. Subsequent
report-only main merges have no runtime changes.

- Full Web suite, two workers: **356 files passed, 7,241 tests passed**;
  three files and 13 tests skipped, one todo.
- Admin search: **169 tests passed** across the snippet, semantic-search and
  Typesense service suites.
- Web lint, complete Web typecheck, touched Admin lint, repository formatting,
  production Next build, admission-worker build and ISR pruning all passed.
  Local build worker count was two, matching the baseline; the temporary
  worker setting was restored and is not part of any PR.
- Production Chromium header geometry: **16 cases passed** (home/What's New,
  320/390/768/1280px, 100%/200% root text). No overlapping header targets;
  backdrop and hover geometry contain the header.
- Production search at 320/390/1280px: lazy first open focuses the input,
  header is inert, 24 Tab/Shift+Tab steps stay in the dialog, and Escape
  restores the exact opener. No horizontal overflow; input is 260px at 320px.
- #2848's exact routing mechanism previously passed the real production-server
  document-status regression, including three real 60-second TTL/retry waits.
  Its authenticated live-snapshot requirement remains outstanding.

Raw local evidence is retained in
`/home/lado/.local/share/forge-audits/2026-10-29-merge-preparation/`:
`candidate-code-heads.json`, `combined-*.log`,
`combined-header-geometry.json`, `combined-search-focus.json`,
`paired-load.json`, `film-lcp-probe.json`, and the GitHub readiness snapshot.
No credentials or browser traces are attached to this report.

## Mergeable subset qualification

The separate local tree `413e6afe8e3282eb51955fffb4394e958eb34250`
contains the 26 mergeable code heads plus the five report bodies. The heads
of #2626, #2845 and #2848 are explicitly absent. It assembles without conflict
and passes **355 Web files / 7,205 tests**, with the same 13 skips and one todo.
Its production Next build, TypeScript check, admission-worker build and ISR
pruning also pass. The same Admin source is present, so the earlier 169-test
Admin search result applies unchanged. This subset is the set proposed for
ordered merge; the larger tree above proves additional compatibility with the
held routing change.

The mergeable build separately passes the same 16 header-geometry cases and
three search focus checks. One additional interleaved pair per route uses the
same throttled browser settings on this subset. All four documents return 200,
with real home/film content, no page exceptions, and no horizontal overflow.
This small repeat confirms behavior and records load impact; it does not
establish a reliable LCP effect.

| Mergeable-subset run |      LCP |     Load | Observed transfer |
| -------------------- | -------: | -------: | ----------------: |
| Home / main          | 6,292 ms | 7,737 ms |   1,265,768 bytes |
| Home / mergeable     | 8,536 ms | 6,097 ms |   1,081,993 bytes |
| Film / main          | 3,068 ms | 7,906 ms |   1,285,654 bytes |
| Film / mergeable     | 3,272 ms | 7,223 ms |   1,117,312 bytes |

The detailed three-pair measurements below apply to the larger compatibility
tree, which includes #2848. Keep the two candidate references distinct.

## Loading evidence and limits

Baseline and candidate used separate production servers, Node 24.22.1,
390×844 Chromium, 4× CPU throttling, 150ms RTT, 200,000 bytes/s download,
fresh browser contexts, and three interleaved pairs per route. Capture ended
five seconds after load. This is a bounded local comparison using anonymous
public Admin reads, not field Core Web Vitals or an authenticated manifest test.
All 12 navigation responses were 200, with no page exceptions or horizontal
overflow. Home rendered 72 images; the explicit-English JESUS film rendered 65.
The implicit-English route is deliberately not used as film performance proof.

| Route / metric                 |            Main | Combined candidate |
| ------------------------------ | --------------: | -----------------: |
| Home median load               |        7,125 ms |           6,076 ms |
| Home median LCP                |        6,536 ms |           2,280 ms |
| Home LCP range                 | 5,672–10,868 ms |     1,824–9,464 ms |
| Home observed median transfer  | 1,261,126 bytes |    1,094,280 bytes |
| Film median load               |        7,223 ms |           6,380 ms |
| Film median LCP, initial pairs |        2,372 ms |           4,064 ms |
| Film observed median transfer  | 1,285,657 bytes |    1,117,871 bytes |
| English font transfer          |   206,024 bytes |       66,460 bytes |

The film LCP result triggered a separate three-pair repeat with LCP element,
image-load and render timing. Both versions used the identical high-priority
`hero-player-poster` image URL and dimensions. Repeat median LCP was 2,372ms
on main and 2,456ms on the candidate (+84ms); median load was 7,222ms versus
6,366ms. A large candidate outlier followed the poster's late arrival (4,068ms
image load, 4,112ms LCP). These live-network samples do not establish a film
LCP improvement or statistical equivalence. They show lower page load/transfer,
with residual LCP variation to recheck in field data. No further speculative
runtime change is bundled into this merge preparation.

Transfer totals are browser-observed resource timing, so cross-origin resources
without Timing-Allow-Origin can be omitted. Home's random slide transition still
produces a long LCP tail and remains in feat-781. Do not extrapolate these two
English routes to every locale, template, device, or authenticated experience.

## Review and operational limits

No review approval is manufactured by local validation. Owners still review the
exact PR heads, honor the prerequisite order, and recheck required CI after any
retarget or new commit. PR #2848 stays draft until its live-manifest qualification
is supplied; #2845 stays draft; #2626 stays excluded. The search and compact-header
PRs #2663/#2835 can leave draft following their completed combined validation.

## Exact-head GitHub snapshot

Snapshot: 2026-10-30T03:46:12.356787+00:00. Main remains `a672f688b`. All reported
checks on the 31 intended merge candidates passed and GitHub reported them
mergeable. No changes-requested review was present; no human approval is
implied. #2855 is listed at its pre-final-report head; publishing this report
creates a new head and restarts its CI. The local readiness snapshot after
publication records that final SHA without a self-referential commit claim.

| PR                                                    | Head        | Base                                              | Disposition                            |
| ----------------------------------------------------- | ----------- | ------------------------------------------------- | -------------------------------------- |
| [#2626](https://github.com/JesusFilm/forge/pull/2626) | `362bcfa9f` | `main`                                            | Excluded: superseded/conflicting       |
| [#2637](https://github.com/JesusFilm/forge/pull/2637) | `5d2848665` | `main`                                            | Prepared; green checks                 |
| [#2663](https://github.com/JesusFilm/forge/pull/2663) | `f7c998e63` | `main`                                            | Prepared; green checks                 |
| [#2669](https://github.com/JesusFilm/forge/pull/2669) | `f7c5f14fb` | `vladmitkovsky/fge-204-w-089-accessibility-order` | Prepared; green checks                 |
| [#2740](https://github.com/JesusFilm/forge/pull/2740) | `5417bd055` | `main`                                            | Prepared; green checks                 |
| [#2821](https://github.com/JesusFilm/forge/pull/2821) | `ecfc1067a` | `main`                                            | Prepared; green checks                 |
| [#2822](https://github.com/JesusFilm/forge/pull/2822) | `62250e242` | `main`                                            | Prepared; green checks                 |
| [#2824](https://github.com/JesusFilm/forge/pull/2824) | `d102bba85` | `main`                                            | Prepared; green checks                 |
| [#2825](https://github.com/JesusFilm/forge/pull/2825) | `e2f861b2e` | `main`                                            | Prepared; green checks                 |
| [#2826](https://github.com/JesusFilm/forge/pull/2826) | `7ce981208` | `main`                                            | Prepared; green checks                 |
| [#2827](https://github.com/JesusFilm/forge/pull/2827) | `92d639f55` | `main`                                            | Prepared; green checks                 |
| [#2829](https://github.com/JesusFilm/forge/pull/2829) | `11ddfb704` | `main`                                            | Prepared; green checks                 |
| [#2830](https://github.com/JesusFilm/forge/pull/2830) | `162c7380b` | `main`                                            | Prepared; green checks                 |
| [#2831](https://github.com/JesusFilm/forge/pull/2831) | `3dd311383` | `main`                                            | Prepared; green checks                 |
| [#2832](https://github.com/JesusFilm/forge/pull/2832) | `64513c30f` | `main`                                            | Prepared; green checks                 |
| [#2833](https://github.com/JesusFilm/forge/pull/2833) | `399240a09` | `main`                                            | Prepared; green checks                 |
| [#2834](https://github.com/JesusFilm/forge/pull/2834) | `aa1b4c198` | `main`                                            | Prepared; green checks                 |
| [#2835](https://github.com/JesusFilm/forge/pull/2835) | `31ca6e209` | `codex/fge-48-search-modal`                       | Prepared; green checks                 |
| [#2836](https://github.com/JesusFilm/forge/pull/2836) | `128532819` | `fix/watch-download-quality-keyboard`             | Prepared; green checks                 |
| [#2837](https://github.com/JesusFilm/forge/pull/2837) | `9e1644615` | `main`                                            | Prepared; green checks                 |
| [#2838](https://github.com/JesusFilm/forge/pull/2838) | `2f61d17d2` | `vladmitkovsky/fge-204-w-089-accessibility-order` | Prepared; green checks                 |
| [#2839](https://github.com/JesusFilm/forge/pull/2839) | `5ebf36986` | `main`                                            | Prepared; green checks                 |
| [#2840](https://github.com/JesusFilm/forge/pull/2840) | `68a84a26c` | `fix/watch-home-hero-pause-reduced-motion`        | Prepared; green checks                 |
| [#2841](https://github.com/JesusFilm/forge/pull/2841) | `f37bcd1c9` | `main`                                            | Prepared; green checks                 |
| [#2845](https://github.com/JesusFilm/forge/pull/2845) | `58b6b76cb` | `main`                                            | Hold: draft/layout regression          |
| [#2846](https://github.com/JesusFilm/forge/pull/2846) | `9810fc3f4` | `main`                                            | Prepared; green checks                 |
| [#2847](https://github.com/JesusFilm/forge/pull/2847) | `3ad6f3305` | `main`                                            | Prepared; green checks                 |
| [#2848](https://github.com/JesusFilm/forge/pull/2848) | `e3c96c9db` | `fix/watch-error-retry-focus`                     | Hold: draft/live manifest              |
| [#2849](https://github.com/JesusFilm/forge/pull/2849) | `e58de48d8` | `fix/watch-route-error-state`                     | Prepared; green checks                 |
| [#2850](https://github.com/JesusFilm/forge/pull/2850) | `a7434348d` | `main`                                            | Prepared; green checks                 |
| [#2851](https://github.com/JesusFilm/forge/pull/2851) | `8dc83660b` | `main`                                            | Prepared; green checks                 |
| [#2852](https://github.com/JesusFilm/forge/pull/2852) | `778a221a3` | `fix/qa-player-keyboard-and-srclang`              | Prepared; green checks                 |
| [#2853](https://github.com/JesusFilm/forge/pull/2853) | `dcec964e7` | `main`                                            | Prepared; green checks                 |
| [#2855](https://github.com/JesusFilm/forge/pull/2855) | `35ddf4c5a` | `main`                                            | Pre-final-report head; new CI required |

## Durable learnings

Review against current main and the intended combined tree. Individually green
PRs still conflicted in shared section-renderer props, focus hooks, DOM order,
and moved test imports. Put repairs in the owning PR, then rebuild the local
candidate from those published heads. Preserve owner decisions that retire UI
and reconcile colliding roadmap IDs instead of restoring historical code.

Keep performance evidence tied to exact refs, real content, and the metric
actually observed. A fast recovery page is not a fast film page; a steady reader
position is not necessarily lower CLS; passing synthetic authority tests is not
an authenticated live-manifest check. Keep held experiments out of the
mergeable set and validate that subset separately.
