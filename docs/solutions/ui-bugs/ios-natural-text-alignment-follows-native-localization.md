---
title: "iOS aligns React Native text by the app's native localization, not by the UI Locale"
date: "2026-09-30"
category: "ui-bugs"
module: "apps/mobile"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "On an Arabic, Farsi, or Urdu phone, Text with no explicit textAlign right-aligns even though the React Native layout stays left-to-right"
  - "English fallback text inside a right-to-left UI right-aligns, including Admin content with no translation and English homepage headings under the en-fallback homepage"
  - "Before the first translation run, an Arabic phone resolves the English catalog while iOS still applies the ar native localization, so all English text right-aligns in dev and preview builds"
  - "I18nManager.isRTL and the RCTI18nUtil keys read false while the text aligns right"
root_cause: "wrong_api"
resolution_type: "code_fix"
framework_version: "expo 57.0.25 / react-native 0.86.3 / expo-localization 57.0.2"
related_components:
  - "apps/mobile/src/i18n/textDirection.ts"
  - "apps/mobile/src/lib/watchHome/experienceAdapter.ts"
  - "apps/mobile/src/components/home/HomeShelf.tsx"
  - "apps/mobile/app.json"
  - "apps/mobile/plugins/withIosLeftToRightAppearance.js"
tags:
  - "ios"
  - "rtl"
  - "i18n"
  - "text-alignment"
  - "expo-localization"
  - "native-localization"
  - "simulator"
  - "dev-client"
---

# iOS aligns React Native text by the app's native localization, not by the UI Locale

## Problem

On iOS, a React Native `<Text>` with no `textAlign` uses natural alignment.
iOS resolves natural alignment from the app's native localization. The native
localization is the localization that iOS picks for the app from its
`CFBundleLocalizations`. iOS does not use the JS UI Locale (the catalog tag),
and it does not use React Native's `I18nManager`.

The mobile UI localization branch (unmerged as of 2026-09-30) declares 225
locales natively. `apps/mobile/app.json:138-370` carries the
`expo-localization` plugin with `supportedLocales`, `supportsRTL: false`
(`app.json:367`), and `allowDynamicLocaleChangesAndroid: true`. Of these
locales, 13 are right-to-left by `isRtlTag` (`apps/mobile/src/i18n/resolveLocale.ts:124`):
`ar`, `az-Arab`, `ckb`, `dv`, `fa`, `he`, `ks`, `ms-Arab`, `ps`, `sd`, `ug`,
`ur`, and `uz-Arab`.

A phone in one of these languages gets a right-to-left native localization.
The layout stays left-to-right, because of `supportsRTL: false` and
`apps/mobile/plugins/withIosLeftToRightAppearance.js`. But every `<Text>` with
natural alignment aligns right, whatever the language of its text. English
text in a right-to-left UI then aligns right, which is incorrect.

## Symptoms

This session used an iPhone 17 Pro simulator (iOS 26.5) with a dev client, and
tested `ar` only. It did not test Android.

- A fresh launch in `en-US` showed the watch page left-aligned.
- A launch with `-AppleLanguages "(ar)" -AppleLocale ar_SA` showed the same
  English text right-aligned: "SEGMENT", the title, the description, "Up
  Next", and "Study Questions".
- In the same launch, the pills row, the player chrome, and the layout stayed
  left-to-right. The Cast, AirPlay, and Video settings buttons stayed at
  x=234..390 pt.
- The app container plist held `RCTI18nUtil_allowRTL = false` and
  `RCTI18nUtil_forceRTL = false`. React Native did not mirror the layout.

The defect has two cases:

1. **English fallback text in a right-to-left UI Locale.** Examples are Admin
   content with no Arabic translation, and English Home shelf headings from
   the `en-fallback` homepage. The branch commit "fix(mobile): align Home shelf
   headings by their homepage's language" records the shelf case: "On an
   Arabic simulator, English shelf headings from the English fallback homepage
   aligned right".
2. **All English text before the first full translation run (U16).** Only
   `apps/mobile/messages/en.json` ships (checked 2026-09-30). An Arabic phone
   resolves the `en` catalog, but iOS still picks the `ar` native
   localization. All English text right-aligns in dev and preview builds.

## What Didn't Work

- **`I18nManager.isRTL` and the `RCTI18nUtil_*` keys.** Both were false while
  the text aligned right. They describe the layout, not the text alignment.
  The plan's U3 check (`docs/plans/2026-09-28-1016-feat-mobile-ui-localization-plan.md:514`)
  looks for `isRTL` false and unmirrored containers. That check passes while
  this defect is present.
- **`withIosLeftToRightAppearance`.** The plugin puts
  `UIView.appearance().semanticContentAttribute = .forceLeftToRight` first in
  `didFinishLaunchingWithOptions`
  (`apps/mobile/plugins/withIosLeftToRightAppearance.js:14-15`, `:28-43`). It
  keeps UIKit containers left-to-right. This session saw right-aligned text
  in a left-to-right layout, so the plugin does not control natural text
  alignment.
- **A `forcesRTL` key, even `false`.** The plugin writes the key for any
  non-null value, and iOS then forces right-to-left on a right-to-left phone
  (`apps/mobile/CLAUDE.md`, "Native configuration and the native-build
  window"). The plan review found this by reading the plugin source before any
  code existed (session history).
  `apps/mobile/app/__tests__/localizationConfig.guard.test.js:70-77` rejects
  the key.
- **A copy of web's direction helper.** `textDirectionForLocale` in
  `apps/web/src/lib/locale.ts:148` reads `Intl.Locale` text info. The plan
  review chose a mobile-owned right-to-left list instead, because Hermes does
  not provide that `Intl.Locale` text info (session history). Mobile uses
  `isRtlTag`.
- **A fixed `textAlign: "left"` (rejected by design, not tried).** R6 in the
  plan (line 92) says each right-to-left text keeps its natural right-to-left
  direction and alignment. A fixed left alignment also left-aligns Arabic
  text.

## Solution

Give each left-aligned `<Text>` an explicit direction from the language of its
own text. `useTextDirection()` in `apps/mobile/src/i18n/textDirection.ts:96-106`
returns two helpers for the current UI Locale:

- `ui` (line 101): the style for UI catalog text, from
  `textDirectionStyle(uiTag, uiTag)`.
- `text(lang, options)` (line 102): the style and the screen-reader language
  for text in `lang`, such as Admin text with its `*Lang` field.

`textDirectionStyle` (lines 48-56) makes the decision:

- It returns nothing for centered text or for an unknown `lang` (line 53).
- It returns `rtl` for text in a right-to-left language (line 54).
- It returns `ltr` for other text only when the UI Locale is right-to-left
  (line 55). In a left-to-right UI Locale it returns nothing.

Each style sets both `direction` and `writingDirection`, because "Android reads
`direction` and iOS reads `writingDirection`" (lines 9-23).
`textAccessibilityLanguage` (lines 61-68) returns `lang` on iOS when its
primary language differs from the UI Locale's. English fallback text in an
Arabic UI thus gets `accessibilityLanguage="en"`.

The Home shelf fix gives each Experience section the homepage's language.
`apps/mobile/src/lib/watchHome/experienceAdapter.ts:266-269` sets `titleLang`:

```ts
titleLang:
  context.homepageSource === "en-fallback"
    ? ENGLISH_TEXT_LANG
    : context.forms.catalogTag,
```

`WatchHomeSection.titleLang` is optional (`apps/mobile/src/lib/watchHome/model.ts:129-131`).
The app's own shelves have no `titleLang`, because their titles are UI text.
`apps/mobile/src/components/home/HomeShelf.tsx:35-38` and `:57-65` apply the
direction:

```tsx
const direction = useTextDirection()
const heading = section.titleLang
  ? direction.text(section.titleLang)
  : { style: direction.ui, accessibilityLanguage: undefined }

<Text
  style={[text.sectionHeadingPadded, typography.titleSmall, heading.style]}
  accessibilityRole="header"
  accessibilityLanguage={heading.accessibilityLanguage}
>
  {section.title}
</Text>
```

The tests pin both halves:

- `apps/mobile/src/lib/watchHome/__tests__/experienceAdapter.test.ts:1014`
  pins `titleLang` for each homepage source.
- `apps/mobile/src/components/__tests__/textDirection.render.test.tsx` has
  "an Arabic UI (AE5)" (line 233) and "an English UI" (line 314). The Arabic
  block renders an English fallback shelf heading as `ltr` with the `en` mark
  (line 281), and an app shelf heading as `rtl` (line 287). The English block
  asserts that no covered surface gets a style or a mark.

## Why This Works

React Native 0.86.3 sets a paragraph alignment only when the style has
`textAlign` (`apps/mobile/node_modules/react-native/ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm:198`).
With no `textAlign`, the `NSParagraphStyle` default applies, which is natural
alignment. React Native sets `baseWritingDirection` only when the style has
`writingDirection` (same file, lines 212-216). Apple's documentation for
`NSTextAlignment.natural` describes it as the default alignment for the app's
current localization (an external source, not checked in this repo).

So a `<Text>` with no direction style follows the native localization. The fix
gives the paragraph an explicit base writing direction from the language of
the text. Natural alignment then follows the text, not the native
localization. The render tests prove the style prop only. This session saw the
defect on a simulator, so confirm the fixed alignment on a simulator too. This
session did not run a build without the native locale list.

Before U16, the fix does not change the result. `useUiTag()` returns
`getCatalogTag()` (`apps/mobile/src/hooks/useUiTag.ts:5-9`), and the only
shipped catalog is `en`. `textDirectionStyle(lang, "en")` returns nothing for
any left-to-right `lang` (line 55). No English text gets a style, so all
English text keeps natural alignment and aligns right under the `ar` native
localization.

This pre-U16 state is known and accepted. `apps/mobile/CLAUDE.md` ("Native
configuration and the native-build window") says the production native build
that carries U3 waits for U16. The plan (line 342) lists the interim effects
that make the build wait: the per-app language row with 225 English entries,
UIKit strings in the phone language, and the App Store Connect language list.
Neither file lists the text alignment effect. The auto memory records it as
one more reason for the same wait (auto memory [claude]).

## Prevention

- **Give every `<Text>` a direction source.** Text that can be in a language
  other than the UI Locale uses `useTextDirection().text(lang)`. UI catalog
  text uses `useTextDirection().ui`. Centered text passes `{ centered: true }`
  or no style.
- **Carry a `*Lang` field beside Admin text.** A model field that carries Admin
  text needs a language field, as `WatchHomeSection.titleLang` has. Without
  it, the component cannot choose a direction.
- **Add each new surface to both render-test blocks.** Use "an Arabic UI
  (AE5)" and "an English UI" in `textDirection.render.test.tsx`.
- **Do not use `isRTL` false as proof of left alignment.** Check alignment on
  an iOS simulator in `ar` and in `en`.
- **Record the pre-U16 alignment effect.** Add it to the interim-effects list
  in the plan (line 342) and in the `apps/mobile/CLAUDE.md` native-build
  window section. Until U16, do not report right-aligned English in a dev or
  preview build as a new defect.
- **Know one limit after U16.** A pending key shows English in the other
  catalogs (`apps/mobile/CLAUDE.md`, "Pending list"). In an Arabic UI, that
  English text gets the `ui` style `rtl` (`textDirection.ts:101`) and aligns
  right. `apps/mobile/scripts/i18n/check-pending-gate.mjs` stops a production release
  while the pending list is not empty, unless `I18N_ALLOW_PENDING=1` is set.

### Simulator checks and two traps

`apps/mobile/app.json:13` sets the iOS bundle identifier. Use the identifier
of the installed app.

```sh
UDID=<simulator udid>
APP=org.jesusfilm.forgewatch
# Arabic check: a new process with Arabic as the app language.
xcrun simctl terminate "$UDID" "$APP"
xcrun simctl launch "$UDID" "$APP" -AppleLanguages "(ar)" -AppleLocale ar_SA
# English check: terminate first (trap 1), then launch with no language arguments.
xcrun simctl terminate "$UDID" "$APP"
xcrun simctl launch "$UDID" "$APP"
```

**Trap 1: `openurl` reuses the running process.** `xcrun simctl openurl` into
a running app keeps that process. This includes a process launched earlier
with `-AppleLanguages "(ar)"`. A check meant to be English then shows
right-aligned text. Terminate the app and launch it again before each English
check.

`xcrun simctl spawn "$UDID" defaults read "$APP" AppleLanguages` cannot read
the app's domain ("domain does not exist"). Read the app container plist:

```sh
plutil -p "$(xcrun simctl get_app_container "$UDID" "$APP" data)/Library/Preferences/$APP.plist"
```

The plist shows stored preferences, such as the `RCTI18nUtil_*` keys. Foundation
keeps a launch argument in the process only, not in this plist (this session
did not test this). So a plist with no `AppleLanguages` does not prove that the
running process is English.

**Trap 2: the gear at the top-left is the Expo dev menu.** In a dev build on a
right-to-left simulator, this session saw a gear icon at the top-left, over the
back button. It is not the app's Video settings button in a mirrored position.
The `expo-dev-menu` 57.0.18 package draws its floating button as
`Image(systemName: "gearshape.fill")` (line 94 of its `DevMenuFABView.swift`)
in its own window (its `DevMenuFABWindow.swift`). Confirm with idb:

```sh
idb ui describe-all --udid "$UDID"
```

The app's "Video settings" button stays at the top-right. The extra element is
`gearshape.fill`.

## Related Issues

- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`
  uses the same `xcrun simctl openurl` re-point and `idb ui describe-all`
  checks. Its recipe does not warn that `openurl` reuses the running process.
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md`
  reads the simulator app container as ground truth, as trap 1 does for the
  preferences plist.
- `apps/mobile/CLAUDE.md`, "Localization" > "Text direction (KTD13)" and
  "Native configuration and the native-build window".
- `docs/plans/2026-09-28-1016-feat-mobile-ui-localization-plan.md`: R6, KTD4,
  KTD13, U3, U14, and U16.
