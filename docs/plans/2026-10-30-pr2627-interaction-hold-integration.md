# PR2627 interaction hold integration

## Scope and evidence

FGE-146 / W-008 records the collective September 13 automated Watch audit: the
hero CTA changed film while a viewer read it. The original human reporter is
unknown. R3-2627-1 is a separate coordinator P2: the 12-second buffering watchdog
bypasses the interaction hold. Its earlier effect-snippet diagnostic is not a
full-hook or browser reproduction.

Integrate incoming `6a22c1b2a0c2591f2a2679fec79dbd9b9682438d` with the main snapshot
`067a1c27b53590db9d384b608e0a352b7847e090`, retaining incoming lineage and main's
complete player behavior. Port only the interaction/deferred-ended delta onto
main's `WatchHomeTvCarousel.tsx`, `useWatchHomeTvCarousel.ts`, and focused tests.
Rename only the owned ticket to feat-915 after a fresh all-author, fully paginated
open-PR/local-ref/worktree/reservation audit. Preserve main README ordering.

## Work and validation

- Reproduce watchdog escape using the actual offered hook under React and fake
  timers, then exercise the integrated component for mouse and keyboard holds
  across never-canplay and waiting streams beyond 36 seconds. Assert title,
  slide identity, and complete href stability; release must recover.
- Make watchdog recovery respect interaction without pausing playback. Preserve
  remaining image dwell, final-release deferred ended, touch/non-visible focus,
  combined holds, removed CTA cleanup, and deliberate selection.
- Preserve main's modal, pause, visibility, autoplay refusal, duration/backstop,
  deferred playback, poster, turn token, subtitles, and prefetch contracts.
- Audit portrait/invalid-media recovery separately: metadata-driven rejection of
  an ineligible portrait is a bounded recovery policy, not normal timed advance.
  Document and test that policy rather than assert a universal interaction hold.
- Run focused homepage/hook/prefetch/modal tests (at most two workers), Web
  typecheck, scoped lint/format/whitespace and roadmap delta checks. Preserve
  original failure logs. Inspect source/loading effects; browser/device/load
  acceptance belongs to the parent and is explicitly unverified here.

## Composition boundaries

PR2383 owns exact raw href stability and live activation time; this candidate
owns film/slide identity while held and retains main's running time-query
behavior. PR2840 owns additional media-start/modal/attachment behavior.
PR2829 owns pause/reduced-motion behavior. PR2853 owns initial-poster fade
removal. Read their published current
contracts, record exact overlaps and landing-order needs in the evidence, and do
not import those separate unmerged scopes or claim their composed acceptance.

The publication check found main at
`a3a8f8796a8c25749c4cd02432397772dbf93cef`, after the external PR2967 merge.
That commit changes Manager files and related documentation only.
It changes no owned Web path, shared dependency manifest, or roadmap index.
Keep the reviewed integration snapshot; validate the actual PR composition in CI.

## Review and compound

Self-review the diff against both parents; simplify changes and retain all
current-main focused tests. Record why every automatic advance path does or does
not honor interaction. Store durable lessons in the owned ticket and this plan.
Freeze a staged, uncommitted tree with exact index/tree/diff/blob receipts for
independent parent review. No external writes, commit, push, or deployment.
