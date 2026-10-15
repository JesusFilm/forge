---
id: "feat-699"
title: "Use native Liquid Glass consistently in the mobile app"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-10-15"
duration: 10
depends_on: []
blocks:
  - "feat-704"
tags:
  - "mobile"
---

## Problem

On iOS 26, only five parts of `apps/mobile` use native Liquid Glass: the tab bar (`NativeTabs`), the Home header, the floating back button, the Bible reader's buttons, and the Downloads selection bar. Every other floating control draws its own surface: flat black fills, an `expo-blur` blur, or an opaque panel. The app therefore mixes two visual languages on one screen, for example a glass back button beside blurred Cast and AirPlay buttons on the watch page.

An audit on 2026-10-14 listed each non-glass element, drew it with and without glass, and gave each one a feasibility verdict. The audit page is `docs/design-qa/mobile-liquid-glass-audit/index.html`. The session context is in `docs/handoffs/2026-10-14-mobile-liquid-glass-consistency-handoff.md`. This ticket points to them and does not repeat the drawings.

## Entry Points — Read These First

1. `docs/design-qa/mobile-liquid-glass-audit/index.html` — the summary table and the verdict for each element. Open it in a browser.
2. `docs/solutions/best-practices/expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md` — `GlassView` draws nothing under a parent whose opacity animates. Read "The scope boundary" before you generalize.
3. `docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md` — never set `isInteractive` on a `GlassView` inside a `Pressable`.
4. `apps/mobile/CLAUDE.md`, section "Tab bar — UIKit's own bar on iOS, a flush JS bar on Android" — the bullets "No test can see the RENDERED material", "A fade is not available on the material", and "Fast Refresh does not reliably apply changes to the material".
5. `apps/mobile/src/components/ui/TabBarBackground.tsx:17-40` — the reference pattern: `isLiquidGlassAvailable() && isGlassEffectAPIAvailable()`, then `GlassView`, else `PlatformBlur`, and `null` off iOS.
6. `apps/mobile/src/components/bible/ReaderGlassButton.tsx:38,69,87-119` — the second reference pattern. It dims the content, not the glass, because `GlassView` ignores opacity.
7. `apps/mobile/src/components/ui/PlatformBlur.tsx:18-36` — the iOS blur and Android dim fallback that every glass element keeps.

## Grep These

- `GlassView|isLiquidGlassAvailable|isGlassEffectAPIAvailable` — the current glass call sites.
- `PlatformBlur|Frosted|BlurView` — the blur stand-ins.
- `hexToRgba\(BLACK, 0\.[0-9]+\)` in `apps/mobile/src/components/explore/` — the flat Explore fills.
- `controls\.opacityAnim|scrollTopOpacity|chromeOpacity` — the three fades that block glass on the watch page and Home.
- `sheetCornerRadius|contentStyle: \{ backgroundColor` in `apps/mobile/app/` — the options that turn the native sheet glass off.
- `<Modal` in `apps/mobile/src/` — the four sheets drawn in JavaScript.

## What To Build

Work in the audit's order of risk. Each step is one reviewable change.

1. **Ready (no known blocker).**
   - Explore: the Mute and Share circles (`ClipOverlay.tsx` `railCircle`), the Keep watching circle (`thumbCircle`, glass rim around the thumbnail), the paused glyph (`glyph`), and the message pill (`ExploreStates.tsx:156`).
   - Watch: the skip-amount pill (`VideoPlayer.tsx:809`, outside the controls fade) and the "Keep watching" offer card (`KeepWatchingOffer.tsx`, no animation).
   - The back button of `ScreenTopBar.tsx` (Downloads, More, Account): reuse the `GlassView` of `FloatingBackButton.tsx:60`.
2. **Needs a spike, then build.**
   - Native form sheets: on one sheet, remove the opaque `contentStyle` and `sheetCornerRadius: 16` on iOS 26 only (`app/watch/_layout.tsx:13-35`), and check that `react-native-screens` 4.26.2 shows UIKit's own glass sheet. If it does, apply the same to `app/series/_layout.tsx` and `FEEDBACK_SHEET_OPTIONS` in `app/_layout.tsx:311`.
   - The JavaScript sheets: a `GlassView` panel inside the existing `Modal` of `PlayerSettingsSheet.tsx` and `FeedbackModal.tsx` (both `animationType="none"`, the panel slides on its own layer), then `DownloadSheet.tsx` and `QuizButtonRenderer.tsx` (`animationType="slide"`).
   - The Explore scrub pill (`ClipProgressBar.tsx:283-293`): it hides with `opacity: 0` until measured, so use `glassEffectStyle: 'none'` until its width is known.
   - The mini player buttons (`MiniPlayerWindow.tsx`): check glass inside the window's native-driven shrink and exit transforms.
3. **Needs rework (a fade blocks glass).** Prove the fade mechanism once, then apply it:
   - Cast, AirPlay and settings (`PlayerControls.tsx:119-135`, `Frosted`). They render inside `VideoPlayer.tsx:903` (`opacity: controls.opacityAnim`). Move them out of that layer, hide the material with `glassEffectStyle: { style: 'none', animate: true }`, and fade only the glyphs.
   - The watch page's scroll-to-top button (`app/watch/[slug].tsx:160,644-652`, `scrollTopOpacity`).
   - The Home hero mute button (`HomeScreen.tsx:358,631,676,716`, `chromeOpacity`). Switch to `'none'` where the controls stop taking touches (opacity under 0.5).
   - The snackbar (`Snackbar.tsx:44-45`): keep the `translateY` slide, drop the opacity fade.

Every glass element keeps its current look as the Android fallback and as the fallback for iOS without `isLiquidGlassAvailable()`.

## Constraints

- Never put a `GlassView` under a parent whose opacity animates or is set below 1. It draws nothing there, and it ignores its own `opacity`.
- The `'none'` style with `animate: true` comes from the `expo-glass-effect` 57.0.4 type definitions only. No one has tried it on a device in this app. Prove it on one element before step 3 depends on it.
- Never set `isInteractive` on a `GlassView` inside a `Pressable`.
- Leave content-layer elements as they are: card badges, captions, scrims, the hero scroll blurs, and the red Watch Now button. Leave the Cast SDK dialogs (the SDK draws them) and the Home pager dots.
- The Bible reader sheets follow the reader's own light, dark and true dark themes (`app/reader-*.tsx` set `contentStyle` from `tokens.background`). Glass there needs an owner decision first.
- The native search tab (`NativeTabs` `role: "search"`) and a native action sheet for the Downloads delete confirmation are design changes. Ask the owner before you build either.
- The settings and feedback sheets must keep the two-Modal order in `apps/mobile/CLAUDE.md` ("Two RN Modals from one player") and `supportedOrientations={["portrait", "landscape"]}`.
- Stay JavaScript-only where possible. `expo-glass-effect` is already in the dev client and in every build. A change to `app.json`, a plugin, or a native module moves the fingerprint runtime version.

## Verification

- `pnpm --filter @forge/mobile typecheck`, `pnpm --filter @forge/mobile lint`, and `npx jest` in `apps/mobile`. Render suites mock `GlassView` and `PlatformBlur` to `null`, so jest proves the branch choice and props only, never the material.
- For each changed element, take an iOS 26 simulator screenshot before and after the change. Prove that the new code path is live with a temporary loud `tintColor` (for example magenta) first, because Fast Refresh does not always apply material changes. Terminate and reopen the dev client after each change.
- Check every changed element on Android (the Pixel 9a emulator) and confirm that it shows its old fallback look.
- For the native sheets, also check list text contrast over a bright video at the partial detent.

## Results (2026-10-15)

The plan is `docs/plans/2026-10-15-1036-feat-mobile-native-liquid-glass-plan.md`. It replaces "What To Build" above, and it records the owner decisions on the questions that this ticket left open:

- Bible reader sheets: glass only in the reader's Dark theme. Light and True Dark keep their solid fill.
- The native search tab: yes, on iOS 26 and later, with the native field at the bottom.
- The Downloads delete confirmation: the native iOS action sheet on iOS 26.
- The mini player controls: no glass.
- The whole iOS app shows a dark interface style, through a runtime window override.

Built and checked on the iOS 26.5 simulator (see the pull request for the evidence):

- Every floating control in the plan shows `GlassSurface`. A temporary loud tint proved the material on each reachable surface. The player plates passed 10 of 10 trials for hide and reveal, return from the background, and return from the reader.
- The watch, series and feedback sheets show the native iOS 26 sheet: dark glass at a partial height, iOS's solid sheet at full height. The reader sheets follow the Dark-only rule.
- The delete confirmation, the search tab and the dark override work as planned. iOS 18.6 shows no change apart from the dark system parts.
- Contrast passed with no tint on every reachable surface.

Still open:

- The Android "no change" check. The shared Pixel 9a emulator did not start the dev client (an ANR at the splash, with 94% of its storage full). Unit tests cover every Android branch.
- The device check on the first TestFlight build: the separate search circle, the delete sheet and the dark sheets.
- The quiz window and the Experience hero mute could not be reached on local data. Unit tests cover both.
- The `react-native-screens` upgrade for Xcode 27 is `feat-704`.
