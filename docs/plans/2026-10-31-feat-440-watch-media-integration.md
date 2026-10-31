---
title: "feat-440 Watch media current-main source integration"
type: fix
date: "2026-10-31"
status: source-preparation
---

# Watch media source integration

This phase prepares a staged, uncommitted candidate for PR
<https://github.com/JesusFilm/forge/pull/2622>. It does not establish runtime
acceptance, approval, publication, or readiness. Whole-PR merge confidence is
**LOW** until independent review and the deferred validation below are complete.

## Authority and identities

- Published PR/named head: `43da266920645ff371802a681506b37da0775fb3`, branch
  `vladmitkovsky/fge-61-offload-watch-media-work`.
- Actual main and intended second parent:
  `c2e4bd3aec94198fc074ec7c37e546469d6001d1`.
- Computed graph merge base: `d30d461c47c5953d8a4a9ab93efdce54786a416d`.
  GitHub's historical PR base happens to match it; neither substitutes for main.
- The T3-created isolated checkout starts at unrelated PR #2646 head
  `2fdee1e246dca655f743f715a84be920bc9e5216`. It is neither a source baseline
  nor an intended parent. Detach to the published PR head and integrate only
  actual main with `rerere.enabled=false`, `--no-commit`, and `--no-ff`.
- Canonical issue: [FGE-61](https://linear.app/jesus-film-project/issue/FGE-61).
  Its complete fresh description and four owner comments govern this narrowed
  mitigation. Comments `b77cc895` and `895ad727` bind the pinned recipe and
  collapsed-versus-manual retry behavior; `88914fec` discloses Cloudflare's
  retained Next sizing; `aecf7476` preserves historical incident boundaries.
  The original July observer is unknown. JC's forwarded August report does not
  establish that attribution. Historical traces, metrics and Search Console
  alerts are dated evidence, not a reproduced current outage.
- Existing roadmap ticket:
  `docs/roadmap/topic-experiences/feat-440-watch-video-thumbnail-indexing.md`.
  Keep `status: "in-progress"`, its owner, body, criteria and empty dependencies.
  Distinct inherited feat-440 identities are not new dependencies or allocations.
  Do not regenerate the roadmap README or mark the broader issue complete.

The August plan at
`docs/plans/2026-08-28-2301-fix-watch-video-thumbnail-indexing-plan.md` remains
historical broader planning context. Its metadata/probe/Cloudflare work is not
silently imported into this 17-path integration.

## Bounded source scope

Only these 16 offered paths and this plan may differ from actual main:

1. `apps/web/src/components/search/VideoCard.tsx`
2. `apps/web/src/components/watch/CollectionDownloadModal.tsx`
3. `apps/web/src/components/watch/DownloadModal.tsx`
4. `apps/web/src/components/watch/SeriesEpisodeCard.tsx`
5. `apps/web/src/components/watch/SeriesHero.tsx`
6. `apps/web/src/components/watch/ShareModal.tsx`
7. `apps/web/src/components/watch/SiblingCarousel.tsx`
8. `apps/web/src/components/watch/SubtitleTranscript.tsx`
9. `apps/web/src/components/watch/WatchHistoryClient.tsx`
10. `apps/web/src/components/watch/WatchUnavailableLanguageClient.tsx`
11. `apps/web/src/components/watch/__tests__/SubtitleTranscript.render.test.tsx`
12. `apps/web/src/lib/provider-image.ts`
13. `apps/web/src/lib/provider-image.test.ts`
14. `apps/web/src/lib/watch-transcript.ts`
15. `apps/web/src/lib/watch-transcript.test.ts`
16. `docs/roadmap/topic-experiences/feat-440-watch-video-thumbnail-indexing.md`

Compare the complete candidate/main trees by path, mode, object type and blob;
all outside entries must be identical. Preserve all other test files, generated
contracts, schema, settings, telemetry, and app boundaries.

## Integration decisions

### Provider images

Preserve Admin's exact
`thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2` recipe byte for
byte and select `unoptimized`; do not run it through a responsive loader. The
loader also returns this source unchanged if called directly. This retains
the cache/blur identity described in
`docs/solutions/best-practices/missing-artwork-frame-fallback-derivative-recipe-and-authored-first-20260826.md`.

Eligible public Mux thumbnail URLs use provider-generated WebP widths, capped
at 1920, scaling an existing paired height proportionally. Keep authored time,
fit mode and quality. Conservative eligibility rejects signed/unknown-query,
duplicate-transform, non-thumbnail, malformed-dimension, height-only,
credential-bearing and nonstandard-port URLs. Ineligible inputs retain their
existing source and delivery selection. Cloudflare Images retain Next sizing;
this explicitly leaves FGE-61's broader offload criterion unresolved.

The nine consumer changes only select loader/unoptimized props and import the
helper. Preserve current image resolution order, blank/null guards, dimensions,
sizes, priority, loading, alt, crop, hover preview and blur placeholders. Do not
repair the separate SeriesHero missing-artwork decision in `todos/023`.

### Optional transcript dependency

Retain the existing SSR cache/tag/parser/selection architecture. Only the
optional VTT fetch gains `AbortSignal.timeout(5000)` and failure logging with
finite reason, elapsed time and deadline; no source URL or exception payload
is logged. Existing `{ vttSrc, compactText: null }` fallback survives.

Only the selected initial source with null SSR compact text may retry while
collapsed. The five-second browser timer aborts it and records a source-keyed
failure, leaving pending state. Explicit expansion clears a failed entry and
starts a fresh request without that timer. Expansion claims manual ownership
for that source, so subsequent collapse still cancels pending work and cannot
restart background loading. Source changes/unmount clear timers and abort the
old controller; late completions check that controller before storing cues.

Preserve current-main native language markup/isolation, slug selection and
reset rules, successful per-source cache reuse, VTT parsing/timestamp offsets,
text selection/multi-click behavior, links, seeking, persistent disclosure
focus, and lazy cue controls/listeners. Cached static HTML may still lack
transcript text until revalidation; client recovery does not prove SEO success.

### Current-main and unmerged ownership

The normal no-commit merge automatically composes five overlapping production
files. Review the resulting deltas rather than replacing components: preserve
translated Terms grammar/accessibility, localized Share labels, slim chapter
progress styling, transcript language markup, approved recovery-language
identity, modal cancellation/stale/error/progress/request generations, typed
events, queue semantics and modal-owned search/q URL policy. Configured GA and
Datadog remain governed by `docs/analytics-and-recommendation-policy.md` without
a consent prerequisite; accepted recommendation coverage is separate from
server failure.

Immutable overlap inspection is planning evidence only. No source from these
unmerged branches enters this minimal main candidate:

| PR    | Inspected identity                         | Future composition ownership                                                                         |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| #2630 | `a7e06f9228a3d20cd0e044b48af0eeb91dd2fddb` | Home pinned recipes/source projection; home files stay unchanged here                                |
| #2646 | `2fdee1e246dca655f743f715a84be920bc9e5216` | Extra GA4/current-attempt analytics and late player repairs; retain on future composition            |
| #2647 | `269d843a28a5690af61e4ed173ffa76fa941c6ba` | Account/CTA/progress bootstrap and its recovery boundaries                                           |
| #2685 | `6ec38f53377de2f5a17271e5c828dc88d7c9793a` | Prefix guard and disabled search-card routing; compose image props without restoring old card bodies |
| #2383 | `ec76b919ab837756d76c4bac2b9bc7aec9f7dbfd` | CTA and shared unmodified-navigation helper                                                          |
| #2384 | `a88571e77459c6c96d142b2196edfebfee0cad5b` | Independent History reliability/account-bucket work; image props only here                           |

PR #2617's requested-versus-completed download reporting remains separate.
No outcome-copy, queue semantics, or feature port belongs here. Minimal
current-main validation will not certify the prospective unmerged composition.

## Validation contract

### Permitted in this phase

Static inspection, complete outside-scope mode/blob equality, staged/working
tree equality, no untracked/unmerged files, whitespace checks, and scoped
Prettier from a positively qualified existing version matching the lockfile.
Use an owned `TMPDIR`, no installation/bootstrap/download or formatter cache.
Save exact commands, exits, immutable source/diff pins and preservation receipts
atomically outside the source checkout. Leave the intended candidate staged
and uncommitted with HEAD at the published head and MERGE_HEAD at actual main.

The CE loop here is explicit plan, bounded source work, writer static review,
and durable integration decisions recorded in this plan/roadmap. Writer review
is not independent review. No test/type/lint/build/server/browser/device/media,
provider/Auth/DB or production setting request is authorized in this phase.

### Deferred automated and independent gates

- Fresh independent review of the frozen candidate and every owner objection.
- Focused `provider-image.test.ts`, `watch-transcript.test.ts`, and
  `SubtitleTranscript.render.test.tsx`; then current consumer image/card/modal,
  routing, selection and language-label controls. Existing tests and the added
  source adjustments remain unexecuted now.
- Discriminating controls: healthy SSR; five-second SSR abort including delayed
  body reads; HTTP/network fallback; URL-free reason/elapsed log; collapsed
  success, failure, expiry and no automatic loop; expiry then a new expansion
  request; expansion before expiry without a timer; collapse after manual
  takeover; source/reset/unmount/StrictMode cancellation; abort-ignoring stale
  completion; cache reuse, language switch and timestamp/selection behavior.
  Use main-old RED/new GREEN only for a real behavioral discriminator, not a
  synthetic assertion against a newly introduced symbol.
- Full Web types, scoped lint, locale format, roadmap checks, normal hooks,
  build and current integrated CI before normal publication. Limit supported
  runner pools initially to two; the parent coordinates heavy-command capacity.
  Future TSX execution must use `TSX_DISABLE_CACHE=1`/`--no-cache` and an owned
  `TMPDIR`; the historical R4 shared temporary-cache audit gap remains open.

### Deferred browser and loading gates

- On an attested new-head preview, inspect actual image requests, src/srcset,
  native dimensions, format, quality, crop, blur transition, lazy/eager behavior
  and CLS at 390px and 1280px, DPR 1/2. Include exact Admin JPG bytes, responsive
  public Mux, Cloudflare art, signed/unknown/non-image/non-provider/local/data
  controls. Verify no recipe priority, layout or authored-first regression.
- Compare matched same-ID, same-cache-state, same-viewport runs interleaved
  between actual main and candidate. Keep exact source/tree/build, browser,
  query, viewport, timing setup, request counts/bytes, initial response, paint,
  LCP candidates, CLS, errors, raw failures and outliers. Compare slow/unreachable
  optional VTT and responsive image paths separately; measure collapsed
  background requests and interactive mount windows as well as initial load.
  Do not reuse unqualified R7 two-film/random-media builds or infer speed from
  screenshots. Native acceptance waits for a compatible platform; historical
  CoreSimulator 1174.9.2 is below required 1174.21.0, so do not retry unchanged.

### Separate operator acceptance

FGE-61 remains open for exact-query Cloudflare cache/bot policy, replica CPU
headroom, provider reachability, test-triggered Datadog monitors/synthetics,
controlled 30-minute crawler load, 24-hour TCP/CPU observation, and Search Console
thumbnail crawl/recrawl/indexing counts with post-deployment crawl timestamps.
Historical root 200, recovery or green CI is not current health evidence.
No production publication/configuration/secret change is performed here.

## Handoff and protected work

Atomic outputs live at
`/home/lado/.t3/userdata/forge-orchestrator/resume-20261031-pr2622-integration-r1/`:
`plan.json`, `result.json`, `frozen-candidate.json`, `handoff.md`, and `raw/`.
They pin intended parents, HEAD/MERGE_HEAD, the immutable staged tree, all
mode/type/blob/SHA256 identities, main-relative paths, outside equality,
format/static receipts, unresolved objections and every NOT RUN gate.

Only this checkout's source/index/HEAD may change. Preserve protected #2615's
staged tree beginning `65fa`, #2384's published tree beginning `0fa`, and the
coordinator's `2fdee1e` source/index/private artifacts. Compare only read-only
metadata and scoped bytes; record concurrent drift without attribution or
restoration. Do not inspect other active workers' outcomes or private data.
The parent's #2615 eligibility repair waits for this writer's terminal handoff;
its SQL R4 completion is supplied provenance, not validation performed here.

No commit, push, PR link/watch, approval, merge/close/auto-merge, deployment,
external state/queue write, schedule, polling, nested worker or retired guard/
quota tool belongs to this assignment. Normal hooks, publication and new-head
review remain the parent's later work.

# Independent review repair R2 — 2026-10-31

Source review of frozen `c028c40065b045027efc6ebd19af8e48d0e0fe49`
found that same-language VTT replacement while expanded did not transfer manual
retry ownership. Collapse could start another five-second background request
and show pending UI. Closing now claims the active replacement source in the
same update as collapse. Expanded requests remain untimed; source-keyed caches,
abort guards and existing expansion identity are preserved.

The added render control replaces source A with B while expanded, verifies B
survives the background deadline, collapses without another fetch or pending UI,
ignores an abort-ignoring late completion, then explicitly reopens a fresh
untimed B request. This test source has not executed in the repair pass.
The concurrent validator remains pinned to the earlier immutable c028 tree;
its outcomes cannot certify this repair. Fresh independent source review and
discriminating old-source RED/new-source GREEN checks are required. Broader
normal hooks, current CI, browser/loading and operator gates remain open.

## Current-main conflict composition — October 31

External PR2824 advanced main to `f7a4f189635b5c4713be50cf7cbc4f914692b4de`.
Published2622 remains `4a199138052eba37dbba8f15e425455562d15e6b`. Object-only
analysis established one conflicting path, SeriesEpisodeCard. The owned
checkout integrates those exact parents without rewriting the published branch.
The resolution retains the provider loader/unoptimized props and main's
localized episodeLabel alt fallback, translated eyebrow/container labels and
decorative icon treatment. Normal rerere was disabled for this operation to
avoid incidental shared preimage writes.

The existing SeriesEpisodeCard test is the one additional main-relative path
within this conflict repair's scope. Two focused integration controls combine
Spanish missing-title labels with exact Admin derivative pass-through and
responsive Mux loader selection. They inspect real component props through the
existing Next Image test double; they do not establish provider delivery,
image decoding, browser layout or page-loading performance. Prior4a/c2CI, R2
source review/local349/HTTP and R5 offline fixture receipts remain separate
from this new integrated candidate. Validation and independent source review
must be recorded against its exact tree before any publication. Broader
feat440/FGE61 and all actual browser/loading/provider/operator gates stay open.

The current composed candidate passed353 focused cases in19 files, including
the two new composition controls and incoming main's label tests. The same
Admin/Spanish control fails against old4a at the localized alt assertion and
against mainf7a at the unoptimized assertion; restored composition passes.
Normal UI-locale generation, full nonincremental Web types with the declared
8192MiB heap, scoped app ESLint/Prettier and current-main whitespace checks pass.
The initial offline fetch instrumentation threw synchronously and caused two
unhandled progress-subscription errors despite passing assertions; its original
receipt is retained. The harness now rejects fetch asynchronously like native
fetch while still denying all network. Two blocked relative progress-fetch
invocations in the focused run are recorded; no socket request was admitted.
Existing jsdom navigation and test-double unoptimized warnings remain disclosed.
Independent integrated-source review, hooks/new-headCI and actual browser/image/
loading/provider/operator acceptance remain open; no readiness is claimed.
