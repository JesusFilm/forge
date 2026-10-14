---
id: "feat-699"
title: "Use native Liquid Glass consistently in the mobile app"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-15"
duration: 10
depends_on: []
blocks: []
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
