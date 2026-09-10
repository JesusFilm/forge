# Embedded fonts

## NotoSerif-SemiBold.ttf

The animated splash sets the word `Jesus` in this face (R12). The face is
embedded at build time through the `expo-font` config plugin, so it is available
at the first frame and can never render in a fallback face and then swap.

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
