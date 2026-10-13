---
id: "feat-695"
title: "Mirror the mobile layout for right-to-left UI languages"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-10-13"
duration: 10
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

The mobile app shows 12 translated right-to-left catalogs (`ar`, `az-Arab`, `ckb`, `dv`, `fa`, `he`, `ms-Arab`, `ps`, `sd`, `ug`, `ur`, `uz-Arab`), but every screen keeps a left-to-right layout. KD3 of `docs/plans/2026-09-28-1016-feat-mobile-ui-localization-plan.md` chose this on purpose and made mirrored layout later work. An Arabic viewer reads right-aligned Arabic text in screens whose back chevron, rails, tab order, and swipes go against that reading direction.

The requirements live in `docs/plans/2026-10-12-1325-feat-mobile-rtl-mirrored-layout-plan.md` (R1–R19, AE1–AE7). This ticket points to them and does not repeat them.

## Entry Points — Read These First

1. `docs/plans/2026-10-12-1325-feat-mobile-rtl-mirrored-layout-plan.md`: the Product Contract, the Key Decisions with their session-settled labels, and the Deferred to Planning questions.
2. `apps/mobile/app.json`: the `expo-localization` plugin options (`supportsRTL: false`, `allowDynamicLocaleChangesAndroid: true`) and the `supportedLocales` list, which includes `ks`.
3. `apps/mobile/plugins/withIosLeftToRightAppearance.js`: forces UIKit to left-to-right at launch.
4. `apps/mobile/app/(tabs)/_layout.ios.tsx`: `unstable_nativeProps={{ direction: "ltr" }}` on the iOS tabs.
5. `apps/mobile/app/__tests__/localizationConfig.guard.test.js`: pins `supportsRTL: false` and the absence of `forcesRTL`.
6. `apps/mobile/src/i18n/localeStore.ts` (`startLocaleSync`, `refreshLocale`, the `AppState` and `addLocaleListener` listeners) and `apps/mobile/src/i18n/resolveLocale.ts` (`isRtlTag`, `RTL_LANGUAGES`, `RTL_SCRIPTS`).
7. `apps/mobile/src/i18n/textDirection.ts`: the per-text direction helper (KTD13) that the alignment rule (R15–R17) replaces.
8. `apps/mobile/CLAUDE.md`, section "Native configuration and the native-build window".
9. `docs/solutions/ui-bugs/ios-natural-text-alignment-follows-native-localization.md`.

## Grep These

```bash
rg -n "supportsRTL|forcesRTL|I18nManager|allowRTL|forceRTL|forceLeftToRight|semanticContentAttribute" apps/mobile --glob '!**/node_modules/**' --glob '!apps/mobile/ios/**' --glob '!apps/mobile/android/**'
rg -n "useTextDirection|textDirectionStyle|textDirectionProps" apps/mobile/src apps/mobile/app
rg -n "marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|\bleft:|\bright:" apps/mobile/src apps/mobile/app --glob '!**/__tests__/**'
rg -n "transformOrigin: \"left|translateX|scaleX" apps/mobile/src --glob '!**/__tests__/**'
rg -n "chevron-back|chevron-forward|arrow-back|arrow-forward" apps/mobile/src apps/mobile/app
rg -n "\bhorizontal\b" apps/mobile/src/components --glob '!**/__tests__/**'
rg -n "BACK_SWIPE_EDGE_WIDTH|DEFAULT_CORNER|readerCornerPolicy|next chapter" apps/mobile/src/lib
```

## What To Build

Follow the plan's Requirements. In short:

- Direction from the UI Locale, applied by the platform before the first visible screen, with at most one reload per start (R1–R4, R8).
- An Android reload when the viewer comes back after a direction change (R5–R7).
- An OTA-controlled off switch that restores today's screens for every viewer (R9, R10).
- Mirroring for order and movement, with playback controls, images, and non-directional icons unchanged (R11–R14).
- The two-way alignment rule: short text with the layout, paragraphs by their own language (R15–R17).
- Dated supersession notes on the docs that describe the left-to-right layout as current (R18).
- A source guard against new direction-bound code that React Native does not mirror (directional icon names, horizontal transforms, x-coordinate gesture math, measured x positions), modeled on `apps/mobile/src/i18n/__tests__/noHardcodedCopy.guard.test.js` (R19). React Native already swaps plain left and right styles in a right-to-left layout.

## Constraints

- Do not edit `apps/admin`, `apps/web`, or `apps/tv`.
- The change moves the fingerprint runtime version. A native build must ship before any OTA update that depends on it, and no production OTA update may go out between the merge and that build.
- Do not let the phone language alone set the direction. An English-only `ks` phone stays left-to-right (R2).
- Never reload for direction more than once in a row (R8).
- Playback controls keep their left-to-right direction (R12).

## Verification

- `pnpm --filter @forge/mobile test`, `pnpm --filter @forge/mobile lint`, and `pnpm --filter @forge/mobile typecheck` pass.
- An agent goes through every screen on an iOS Simulator and an Android emulator in Arabic, one more right-to-left language, and English, and records a screenshot of each screen in each direction (plan Success Criteria).
- Surfaces that the simulators cannot show (Cast expanded controls, the Local Network alert, iPhone picture-in-picture) get a device check, or the verification record lists them as not checked.
- AE1–AE7 of the plan pass, including a fresh install on an Arabic phone and the Android language-change reload.
- The OTA switch is tested by turning mirroring off in a local build and confirming today's screens after one reload.
- Cold start on a release build: no extra reload on a left-to-right phone, and at most one reload behind the splash on a right-to-left phone (`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`).
