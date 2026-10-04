# Embedded fonts

## NotoSerif-SemiBold.ttf

The animated splash sets the word `Jesus` in this face (R12). The face is
embedded at build time through the `expo-font` config plugin, so it is available
at the first frame and can never render in a fallback face and then swap.

> **Note added 2026-09-15:** the animated splash is disabled behind
> `ANIMATED_SPLASH_ENABLED` (`src/lib/splash/animatedSplashEnabled.ts`), so this
> face has no default-path consumer today. It stays embedded by decision:
> removing the `expo-font` plugin entry moves the fingerprint runtime version
> and strands OTA updates, and re-enabling the splash needs it present.

- **Source:** the Noto Project's hinted TTF release,
  `fonts/NotoSerif/hinted/ttf/NotoSerif-SemiBold.ttf` from
  `notofonts/notofonts.github.io`, downloaded 2026-09-09.
- **Licence:** SIL Open Font License, Version 1.1. The licence permits
  embedding in an application binary. The full text is in `OFL.txt` beside the
  font, copied from the same upstream repository.
- **Brand:** `brandpad.io/jfp` sanctions Noto Serif as the brand's secondary
  typeface, in Semibold, Medium and Regular.

### The name to write in `fontFamily`

Use the string **`NotoSerif-SemiBold`** on both platforms.

The two platforms resolve that string differently, so the name is recorded here
rather than derived:

- **Android** uses the name we declare. `app.json` gives the `expo-font` plugin
  the object form with an explicit `fontFamily`, and the plugin emits
  `ReactFontManager.getInstance().addCustomFont(this, "NotoSerif-SemiBold", …)`.
  Without the object form, Android would derive a name from the file name
  instead.
- **iOS** reads the name from inside the file. The plugin only copies the file
  and lists it in `UIAppFonts`. The file's own name table reports:
  - PostScript name: `NotoSerif-SemiBold`
  - Family name: `Noto Serif SemiBold`
  - Typographic family and subfamily: `Noto Serif` / `SemiBold`

  React Native accepts the PostScript name, so `NotoSerif-SemiBold` matches on
  iOS as well.

One platform rendering the face correctly proves nothing about the other. Check
both on a development build before you trust the name.

## Daily Bible Pause faces (Pass 2)

The pause route sets its text in the eight faces that the Figma frame
"Pass 2 · Dark, pill stepper" uses (file `0x3kAiEt7C7kSHpg0f4wiD`, node
`343:2`). These faces are **not** embedded through the `expo-font` config
plugin. `src/lib/dailyPause/fonts.ts` loads them at run time with
`Font.loadAsync`, so a font change ships as an update and does not move the
fingerprint runtime version. The splash entry in `app.json` stays as it is.

Each file name is the face's PostScript name, and each `fontFamily` string is
that same name. `Font.loadAsync` registers a face under its key on both
platforms, and the key is the PostScript name, so iOS and Android agree.
Write the face by its family name only. Do not add `fontWeight` or
`fontStyle`: a static face already carries its weight and style.

| File                          | PostScript name           | Bytes   | Licence                   |
| ----------------------------- | ------------------------- | ------- | ------------------------- |
| `InstrumentSerif-Regular.ttf` | `InstrumentSerif-Regular` | 70,012  | `InstrumentSerif-OFL.txt` |
| `SourceSerif4-Light.ttf`      | `SourceSerif4-Light`      | 266,492 | `SourceSerif4-OFL.txt`    |
| `SourceSerif4-LightIt.ttf`    | `SourceSerif4-LightIt`    | 190,108 | `SourceSerif4-OFL.txt`    |
| `SourceSerif4-It.ttf`         | `SourceSerif4-It`         | 187,808 | `SourceSerif4-OFL.txt`    |
| `Inter-Regular.ttf`           | `Inter-Regular`           | 411,640 | `Inter-OFL.txt`           |
| `Inter-Medium.ttf`            | `Inter-Medium`            | 417,300 | `Inter-OFL.txt`           |
| `Inter-SemiBold.ttf`          | `Inter-SemiBold`          | 419,744 | `Inter-OFL.txt`           |
| `Inter-Bold.ttf`              | `Inter-Bold`              | 420,428 | `Inter-OFL.txt`           |

- **Instrument Serif:** `ofl/instrumentserif/InstrumentSerif-Regular.ttf` and
  `OFL.txt` from `google/fonts`, `main` branch, downloaded 2026-10-05. The
  file is a static TTF, version 1.000.
- **Source Serif 4:** the static TTFs in `TTF/` of
  `source-serif-4.005_Desktop.zip`, from the `adobe-fonts/source-serif`
  release `4.005R`, downloaded 2026-10-05. These are the Text optical size.
  The licence text is that release's `LICENSE.md`, saved as `.txt` so that
  Prettier does not reformat it. The licence reserves the font name "Source",
  so never ship a modified copy under that name.
- **Inter:** `extras/ttf/` and `LICENSE.txt` of `Inter-4.1.zip`, from the
  `rsms/inter` release `v4.1`, downloaded 2026-10-05 (font version 4.001).
- **Licence:** all three are under the SIL Open Font License, Version 1.1,
  which permits bundling the fonts in an application.

The names were read from each file's `name` table with `fontTools` (name ID 6).
No file has a variation table (`fvar`), so each file is a static instance.

If a load fails, the hook still reports ready and gives a system face instead:
Georgia on iOS (iOS has no family named `serif`) and `serif` on Android for
the two serif roles, and the system sans for Inter. Text then renders in the
fallback face. It never renders blank.
