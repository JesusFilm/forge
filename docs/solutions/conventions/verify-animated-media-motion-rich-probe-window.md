---
module: "apps/tv"
date: 2026-07-13
problem_type: convention
component: development_workflow
severity: medium
resolution_type: workflow_improvement
applies_when:
  - "Verifying an animated media asset (animated.webp/gif) actually animates on a real device or emulator"
  - "Deciding whether a renderer animates by md5-diffing sequential adb screencap frames"
  - "Choosing a sample time window for a Mux animated preview or its poster thumbnail"
  - "Byte-identical sequential frames could mean static SOURCE content, not a static renderer"
symptoms:
  - "12 sequential screencap frames returned byte-identical md5s, suggesting the webp never animated"
  - "Preview and poster looked visually identical because both sampled the same title-card timestamp"
  - "Nearly concluded Glide does not animate webp on Android and built an unnecessary fallback ladder"
tags:
  - "apps-tv"
  - "android-tv"
  - "expo-image"
  - "mux"
  - "animated-webp"
  - "on-device-verification"
  - "frame-diffing"
  - "screencap"
related_components:
  - "testing_framework"
  - "tooling"
title: "Frame-diffing to verify on-device animation needs a motion-rich sample window"
---

# Frame-diffing to verify on-device animation needs a motion-rich sample window

## Context

Verifying that an animated media asset _actually animates_ on a device is deceptively hard. The usual tool is a screenshot burst plus a frame diff: capture a series of frames while the asset should be playing, hash each one, and check whether the hashes change. If they change, the renderer is animating; if they're identical, it isn't. That logic is sound — but it has a silent failure mode. Byte-identical frames only tell you that _nothing on screen changed_, not that _the renderer is static_. If you happen to sample a window where the source material itself holds still — a title card, an intro hold, a fade — you get identical frames whether or not the renderer is doing its job. The diff reports "static," and you conclude the feature is broken when it is working perfectly.

This bit us verifying TV hover-previews (PR #1537): a Mux `animated.webp` crossfaded over a poster via `expo-image` on focus dwell, across five card surfaces in `apps/tv`. tvOS (SDWebImage) was already confirmed animating. The open question was Android: does `expo-image`/Glide render the `animated.webp` as motion, or freeze on its first frame? The verification loop was an Android TV emulator (`Television_1080p_API_36`), `adb exec-out screencap -p` bursts, and `md5` diffing.

The first probe pointed at the _Life of Jesus_ preview URL `.../animated.webp?start=2&end=6&width=448&fps=8`. That film's 2–6s window is a **static title-card hold** — the source frames are genuinely identical. Twelve screencaps over ~6 seconds produced exactly **one distinct md5**. Read naively, that says "Glide renders `animated.webp` as a static first frame on Android," and it nearly triggered the plan's fallback ladder: swap to `animated.gif`, then a single muted `expo-video`, then descope the feature entirely. All of that would have been work to fix a bug that did not exist.

A second confound compounded the trap. The poster is `thumbnail.jpg?time=2`, which samples the **same title card** as the preview's first frame (`start=2`). So "preview is showing" and "poster is showing" were pixel-identical — there was no visual way to tell an active preview from a torn-down one, or from a still poster.

## Guidance

**Pick a probe window with guaranteed visible motion before you diff anything.** The whole method rests on the source material changing frame-to-frame within your sample window. Do not sample the asset's opening seconds by default — intros, title cards, and logo holds are exactly where source motion is lowest. For a film clip, jump minutes in (we used `start=600&end=604`, ten minutes deep) to a window with obvious movement: a head turning, a gaze shifting, a camera pan.

**Treat byte-identical frames as "no visible change," never as "the renderer is static."** Those are different claims. Identical frames are consistent with both a frozen renderer AND a correctly-animating renderer fed a static window. A "static" result is only meaningful once you've independently established the window contains motion — otherwise it's uninterpretable.

**Avoid the poster/preview same-timestamp confound.** When an animated asset crossfades over a fallback poster, make sure the poster and the preview's first frame don't sample the same source timestamp. If they do, you cannot visually distinguish "preview active" from "poster only," and every downstream observation is ambiguous. Either compare a window where the two diverge, or isolate the preview region.

**The burst + md5 + re-trigger recipe:**

1. Re-trigger the render cleanly so playback restarts from frame 0. On TV, move focus off the card and back (blur → refocus remounts the `expo-image`); add a second focusable card to a throwaway harness so the D-pad has somewhere to go. Drive it with `adb shell input keyevent <21|22|20|19>` (left/right/down/up).
2. Burst-capture at ~0.4–0.5s intervals with `adb exec-out screencap -p > frame-NN.png`.
3. Count distinct hashes: `md5 -q frame-*.png | sort -u | wc -l`. Greater than 1 ⇒ something animated; exactly 1 ⇒ nothing changed _in that window_ (inconclusive until you've confirmed the window has motion).
4. Whole-frame md5 only proves _something somewhere_ changed. To attribute the motion to a specific region (the preview card, not an unrelated UI tick), either isolate that region full-screen, or stack the candidates and compare two spaced frames visually.

## Why This Matters

A false-static negative doesn't just cost a re-run — it points you at a fix for a non-bug. Here it nearly launched an entire fallback implementation (animated.gif → single muted `expo-video` → descope), each rung of which is real engineering time spent making the product _worse_ (heavier gif, a second video decoder on a memory-constrained TV, or dropping a shipped feature) to route around a renderer that was working the whole time. The correct conclusion — `expo-image` animates the Mux `animated.webp` on Android TV via Glide, no fallback needed, the shipped `448/8` webp works on both platforms — was one motion-rich window away. The cost of the trap is asymmetric: a few minutes to re-probe correctly versus days chasing a phantom, and a shipped solution that's strictly worse than the one you already had.

## When to Apply

Any time you verify that an animated asset _actually plays_ by screenshot or frame diffing — on an emulator or a real device, on any platform:

- animated WebP / GIF, Lottie, sprite-sheet animations, video posters/previews, autoplaying loops, shimmer/skeleton loaders;
- especially when the asset's **early frames may be static** (title cards, fade-ins, intro holds) — don't default to sampling `t=0`;
- especially when a **fallback poster** sits under the animation and may share a source timestamp with the animation's first frame;
- whenever a "static" frame-diff result would trigger a fallback, a bug ticket, or a descope decision — that's exactly when a false negative is most expensive, so confirm the window has motion first.

## Examples

**Before — the static-window false negative.** URL `.../animated.webp?start=2&end=6&width=448&fps=8`. The film's 2–6s span is a title-card hold; source frames are identical. 12 screencaps over ~6s → **1 distinct md5**. Nearly-drawn conclusion: "Glide renders `animated.webp` as a static first frame on Android." Nearly-triggered action: the gif/video/descope fallback ladder.

**After — the motion-rich window.** Same asset, window moved to `start=600&end=604` (ten minutes into the film). 12 sequential frames → **12 distinct md5s**, with visible frame-to-frame motion (head turning, gaze lowering). A stacked webp-vs-gif A/B confirmed BOTH formats animate. Conclusion: `expo-image` animates the Mux `animated.webp` on Android TV via Glide — no fallback needed.

**The confound in isolation.** Poster `thumbnail.jpg?time=2` vs preview first frame `start=2` — same source timestamp, therefore pixel-identical. "Preview showing" and "poster showing" were indistinguishable until the probe window moved to a region where the two diverge. Same-timestamp poster/preview pairs defeat the diff before the renderer is even in question.

## Related Learnings

This is a device-side instance of the broader **prove the mechanism, not a proxy** testing discipline: a whole-frame md5 is a proxy for "the animation is playing," and a proxy passes (or here, fails) for reasons unrelated to the thing you meant to test. The remedy is to construct the observation so that ONLY the mechanism under test can produce the signal — sample a window where a static renderer and an animating one MUST diverge — rather than trusting a measurement both states can satisfy.

- [mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — the META home for "construct the fixture/probe so only the target outcome can match." A static sample window is a probe both an animated and a static asset satisfy; this is that law applied on-device.
- [base-ui-dialog-state-attribute-detection](../best-practices/base-ui-dialog-state-attribute-detection-20260520.md) — same failure shape on a different surface: an element-presence probe can't separate "open" from "closing" during a CSS transition, just as a frame-diff can't separate "static asset" from "static window." Fix both by changing _what_ you sample.
- [verify-infra-writes-via-independent-read-path](../best-practices/verify-infra-writes-via-independent-read-path-20260420.md) — the md5 frame-diff IS the independent read path for animation, but it's only trustworthy if the sample window can reveal the outcome.
- [idempotence-property-test-vacuous-on-malformed-fixed-point](../best-practices/idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md) — analog of a vacuous pass on a fixed-point input; a title-card window is the "fixed point" where the diff succeeds trivially.
- [verifying-mobile-expo-worktree-changes-in-simulator](../developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md) — sibling in the "how to actually confirm a TV/mobile change on hardware" family (this adds the Android TV `adb screencap` + `md5` technique).
- [android-tv-density-scaling-and-native-view-clipping](../ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md) — same app + platform + component (expo-image on Android TV) where visual verification is subtle and platform-specific painting bites.
