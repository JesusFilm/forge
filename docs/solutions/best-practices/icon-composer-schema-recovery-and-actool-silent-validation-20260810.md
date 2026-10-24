---
title: "Hand-authoring Apple's Icon Composer icon.json, and the actool command that only looks like it validates"
date: 2026-08-10
problem_type: best_practice
component: tooling
root_cause: missing_validation
resolution_type: documentation_update
severity: high
module: apps/mobile
applies_when:
  - "Authoring or editing an iOS 26 Icon Composer .icon bundle by hand"
  - "Validating an asset catalog with actool outside an Xcode build"
  - "Reverse-engineering an undocumented Apple Codable format"
  - "Writing SVG whose elements carry both a transform and a gradient fill"
  - "Relying on any CLI validator you have not yet seen return non-zero"
tags:
  - icon-composer
  - actool
  - ios-26
  - liquid-glass
  - app-icon
  - xcode-26
  - expo
  - reverse-engineering
  - svg
  - meta-pattern
related:
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md"
  - "docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md"
  - "docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md"
---

# Hand-authoring Apple's Icon Composer `icon.json`, and the `actool` command that only looks like it validates

## Context

`apps/mobile` shipped Expo's placeholder icon. Replacing it with a flat PNG was
the easy path, but iOS 26 composes an app icon from _layers_ — the system draws
the glass container, the specular highlight, the drop shadow, and derives the
dark and tinted renditions itself, given a layered source. A flat PNG opts out
of all of that and gets a static rounded square instead.

The layered source is an Icon Composer bundle: a directory named `*.icon`
holding an `icon.json` document plus an `Assets/` directory of layer artwork.
Apple ships the GUI (Icon Composer.app, inside Xcode) but publishes no schema
for the document it writes, and there is no sample bundle anywhere on disk to
copy — verified on this machine, `find /Applications/Xcode.app -name '*.icon'`
returns **zero** results.

That left two problems. First, how do you author a document for a format whose
key names and value shapes are undocumented? Second — and this is the part that
nearly shipped a broken bundle — how do you _check_ your answer, when the
obvious way to run the validator silently passes on anything?

Everything empirical below was measured by running the commands in this session
on **macOS 26.5.1 with Xcode 26.5 (build 17F42)**, on **2026-08-10**. Apple can
change any of it in a point release; re-run the probes rather than trusting the
numbers if you are on a different Xcode.

## Guidance

### 1. Know where the bundle plugs into the toolchain before authoring it

A `.icon` is a directory package, not a file. Expo SDK 54 supports it directly,
and the support is a plain directory copy — worth knowing, because it means
**Expo never inspects or validates your `icon.json`**. In
`@expo/prebuild-config@54.0.9` (the version resolved for `expo@54.0.36`, which
is what `apps/mobile` pins at `~54.0.36`):

- `withIosIcons.js:107-109` — if `ios.icon` is a _string_ whose extension is
  `.icon`, `setIconsAsync` calls `addLiquidGlassIcon` and **returns**. That
  `return` short-circuits the entire `AppIcon.appiconset` branch at
  `withIosIcons.js:111-125`, so prebuild emits no appiconset at all.
- `withIosIcons.js:223-234` — `addLiquidGlassIcon` is a recursive `fs.cp` of
  your bundle into `ios/<Project>/<Name>.icon`. It checks only that the source
  path exists. A malformed `icon.json` is copied through untouched.
- `withIosIcons.js:239-246` and `:251-260` — the bundle is registered as a
  build resource and `ASSETCATALOG_COMPILER_APPICON_NAME` is set to its
  basename, so Xcode's own `actool` compiles it at build time.

The consequence: **the first thing that ever validates your document is the
Xcode build**, or EAS. If you do not validate locally, you find out in CI.

One config trap this creates: the `.icon` path must go on `ios.icon`, _not_ the
root `icon` property. `withIosIcons.js:91-93` warns and ignores it there. So
`app.json` carries both — a PNG at `app.json:7` for Android legacy launchers,
Expo Go, and web, and the bundle at `app.json:17` for iOS.

### 2. Recover the schema from the framework binary — in two passes, not one

Icon Composer's model types live in
`Xcode.app/Contents/Applications/Icon Composer.app/Contents/Frameworks/IconComposerFoundation.framework/Versions/A/IconComposerFoundation`.
They are Swift `Codable` types, which means the names you need are split across
two places in the binary, and **you need both passes**.

**Pass A — Swift property names, from the reflection metadata.** Dump the
`__TEXT,__swift5_reflstr` section and decode it. The trick is that `otool -s`
prints the section as 32-bit words in hex, and on a little-endian target the
bytes within each word are reversed. Concatenating them naively produces
garbage; you must reverse each 4-byte group before decoding:

```bash
B="/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Frameworks/IconComposerFoundation.framework/Versions/A/IconComposerFoundation"
otool -s __TEXT __swift5_reflstr "$B" | tail -n +3 | python3 -c "
import sys, re
out = bytearray()
for line in sys.stdin:
    for w in line.split()[1:]:
        if len(w) == 8 and re.fullmatch(r'[0-9a-f]{8}', w):
            out += bytes.fromhex(w)[::-1]   # little-endian: reverse each word
print('\n'.join(t for t in out.decode('utf-8','replace').split('\x00') if t))
"
```

The difference the reversal makes, on the first few words of the real section:

```
NAIVE     : 'esabiraV\x00tna\x00\x00\x00\x00acolezilraVdtnaiab\x00stskcoCpo\x00roltnoc…'
REVERSED  : 'baseVariant\x00\x00\x00\x00\x00localizedVariants\x00backstopColor\x00context\x00size\x00sca…'
```

This yields 476 strings, among them the model's field names: `fill`, `groups`,
`layers`, `position`, `lighting`, `shadow`, `translucency`, `specular`,
`hidden`, `material`, `opacity`, `appearance`, `specializations`, `components`,
and the enum vocabulary `solid`, `neutral`, `automatic`, `circles`, `squares`,
`light`, `dark`, `tinted`.

**Pass B — the JSON wire keys, from the C-string literals.** Reflection gives
you Swift _property_ names, which are camelCase. The hyphenated keys that
actually go in the file are `CodingKeys` raw values, and those are ordinary
string literals — invisible to pass A. Confirmed on this binary: pass A yields
`imageName`, `blurMaterial`, `blendMode`, `supportedPlatforms`,
`linearGradient`, `displayP3`, `sRGB`; the hyphenated forms appear only under
`strings`:

```bash
strings -a "$B" | grep -xE "image-name|blur-material|blend-mode|supported-platforms|linear-gradient|display-p3|srgb"
```

Each returns exactly one hit. **Run both passes.** A pass-A-only reading gives
you `imageName` and a document actool rejects.

One correction worth carrying forward: `color-space` does **not** exist as a
bare wire key in this binary. `srgb` and `display-p3` appear only as the
colour-space _token_ at the head of a colour string (see below).

### 3. Reflection gives you names. Value shapes come from probing actool

Nothing in the binary tells you whether `linear-gradient` takes an array, an
object, or how a colour is encoded. Those come from writing candidate documents
and running the validator. The results, each verified by a separate `actool`
run against the real bundle:

| Variant                                   | Exit  | Message                                                             |
| ----------------------------------------- | ----- | ------------------------------------------------------------------- |
| shipped document                          | 0     | compiles, `Assets.car` written                                      |
| `{}` (empty document)                     | 1     | `The data couldn't be read because it is missing.`                  |
| `{"groups": […]}` only, no `fill`         | **0** | compiles — `fill` is optional, `groups` is not                      |
| `{"solid": "srgb:…"}` as fill             | **0** | compiles — `solid` is a valid fill kind                             |
| colour as `"#2A231F"`                     | 1     | `Invalid color encoding, missing ':' delimiter`                     |
| colour as `"srgb:r,g,b"` (no alpha)       | 1     | _no message_ — opaque backtrace only                                |
| colour as `{color-space, components:{…}}` | 1     | `The data couldn't be read because it isn't in the correct format.` |
| gradient as `{"colors": […]}`             | 1     | `The data couldn't be read because it isn't in the correct format.` |
| gradient with 1 colour                    | 1     | `Linear gradients require exactly 2 colors`                         |
| gradient with 3 colours                   | 1     | `Linear gradients require exactly 2 colors`                         |

The two rules that bite:

**A colour is a string, `"<color-space>:r,g,b,a"`, and alpha is required.** The
components are normalised floats. `apps/mobile/scripts/generate-app-icon.mjs:172-176`
encodes this, with alpha pinned to `1`:

```js
function iconColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  const c = (shift) => (((n >> shift) & 255) / 255).toFixed(5)
  return `srgb:${c(16)},${c(8)},${c(0)},1`
}
```

**`linear-gradient` takes a bare array of exactly two colour strings.** No
wrapper object, no `stops`, and no angle parameter — the gradient runs
top-to-bottom, full stop. That constraint is load-bearing on the design, which
is why it is pinned as a two-stop constant at
`generate-app-icon.mjs:73-75` with the reason attached, so the rasters and the
bundle cannot drift apart.

### 4. Validate with the full flag set — the abbreviated form _cannot_ fail

This is the sting. The natural way to reach for the validator is:

```bash
xcrun actool --compile /tmp/iconcheck assets/AppIcon.icon    # DO NOT TRUST THIS
```

Measured on Xcode 26.5 against the known-good bundle: **exit 0, and zero files
written.** It emits only a notices plist:

```xml
<key>com.apple.actool.notices</key>
<array>
  <dict><key>description</key>
    <string>Compiling requires passing "--minimum-deployment-target [value]".</string></dict>
  <dict><key>description</key>
    <string>Compiling requires passing "--platform [platform-name]".</string></dict>
</array>
```

It declined to compile and reported success. Run that against a bundle with a
three-stop gradient and it still exits 0. **The obvious invocation is incapable
of failing**, which is worse than having no check at all — it manufactures
confidence.

The working command, with every flag load-bearing:

```bash
mkdir -p /tmp/iconcheck
xcrun actool --compile /tmp/iconcheck --platform iphoneos \
  --minimum-deployment-target 26.0 --app-icon AppIcon \
  --output-partial-info-plist /tmp/iconcheck/p.plist assets/AppIcon.icon
```

Verified three ways on Xcode 26.5:

| Invocation  | Bundle          | Exit  | Output                                     |
| ----------- | --------------- | ----- | ------------------------------------------ |
| abbreviated | valid           | 0     | **0 files**                                |
| full flags  | valid           | 0     | 4 files, incl. `Assets.car`                |
| full flags  | 3-stop gradient | **1** | 0 files, `com.apple.actool.errors` present |

Two gotchas when running it:

- **`--app-icon AppIcon` must match the bundle's directory name.** Validating a
  copy named `bad.icon` produced a completely different and misleading error —
  `None of the input catalogs contained a matching stickers icon set, app icon
set, or icon stack named "AppIcon"` — which reads like a schema problem and
  is not. Keep the copy named `AppIcon.icon`.
- **Successful runs print alarming stderr noise.** Expect lines like
  `AssetCatalogSimulatorAgent[…] The filter 'CIPortraitEffectSpillCorrection' is
not implemented in the bundle at …`. Benign. Gate on the exit code, not on
  whether the output looks clean.

The command is recorded in `apps/mobile/CLAUDE.md` under "App icon", with the
flags marked as load-bearing.

### 5. Read the failure signature correctly — the useful message is not in the plist

When it does fail, actool's error reporting is split, and the informative half
is the half a parser will miss. For the three-stop gradient:

```
Linear gradients require exactly 2 colors        <- bare line, printed FIRST
<?xml version="1.0" encoding="UTF-8"?>           <- plist starts here
…
<key>com.apple.actool.errors</key>
  <string>Exception while running actool: *** -[__NSPlaceholderArray initWithObjects:count:]:
   attempt to insert nil object from objects[0]
   Backtrace: …</string>
```

The plain-string diagnosis is emitted _before_ the plist, which means the
combined stream is **not valid plist** — `plistlib.load` on it raises
`InvalidFileException`. Anything that parses only the structured output sees
just a generic Objective-C nil-insertion backtrace.

And the alpha-less colour string is worse: exit 1 with the ObjC backtrace and
**no plain-string message at all**. If you get a bare nil-insertion exception
and no explanation, suspect a malformed value that decoded to `nil` — a colour
missing its alpha component is the known instance.

Practical rule: **capture combined stdout+stderr, gate on the exit code, and
read the first line as prose.**

## Why This Matters

An app icon is the one asset that is guaranteed to be seen by every user and is
expensive to fix after the fact — it rides in App Store metadata, not just the
binary. A silently broken bundle fails at Xcode compile time, which in this
setup means it fails inside an EAS build: a long, remote, expensive feedback
loop, at the point where you are least able to iterate.

The specific hazard is not "the format is undocumented" — that is merely
tedious, and section 2 dissolves it in about ten minutes. The hazard is that the
_natural_ validation gesture returns success unconditionally. Every property
of a healthy check is present: a real tool, a plausible command, exit 0, no
error output. The only tell is that nothing was written, and nobody checks
`ls` on a directory they just told a compiler to fill. This is the same shape as
the repo's standing mocked-vs-real discipline: a check that cannot go red is not
evidence, and its greenness is actively misleading.

The payoff for getting it right is concrete. Compiling the shipped bundle and
inspecting the result with `xcrun assetutil --info Assets.car` shows iOS derived
the full appearance matrix from the single layered source:

- 3 × `IconImageStack` — `UIAppearanceLight`, `UIAppearanceDark`, `ISAppearanceTintable`
- 3 × `IconGroup` at the same three appearances
- 1024×1024 `Icon Image` renditions across those appearances
- a `Vector` rendition, `AppIcon_Assets/Mark` — the SVG layer is preserved as
  vector, not rasterised
- 2 × `Named Gradient`, 5 × `Color`

One source, three renditions, artwork still vector. That is what the flat-PNG
path forfeits.

## When to Apply

- Authoring or editing an iOS 26 Icon Composer `.icon` bundle by hand, in any
  Expo or bare React Native project.
- Any time you change `apps/mobile/assets/AppIcon.icon/icon.json` — run the
  full-flag `actool` before pushing. It takes about a second.
- Reverse-engineering any undocumented Apple `Codable` format: the two-pass
  binary read (reflection for property names, `strings` for `CodingKeys` raw
  values) generalises, as does the byte-reversal decode of `otool -s` output.
- Before trusting _any_ CLI validator you have not seen fail. Prove it can
  return non-zero on a deliberately broken input before you rely on its zero.
- Writing SVG where an element carries both a `transform` and a gradient fill
  (see the second example below).

## Examples

### The shipped document

`apps/mobile/assets/AppIcon.icon/icon.json`, generated by
`generate-app-icon.mjs:178-204` — every value shape here is one the probe matrix
above confirmed:

```json
{
  "fill": {
    "linear-gradient": [
      "srgb:0.16471,0.13725,0.12157,1",
      "srgb:0.06275,0.05098,0.04706,1"
    ]
  },
  "groups": [
    {
      "layers": [{ "image-name": "Mark.svg", "name": "Mark", "hidden": false }],
      "shadow": { "kind": "neutral", "opacity": 0.5 },
      "specular": true,
      "translucency": { "enabled": false, "value": 0.5 },
      "blur-material": 0
    }
  ],
  "supported-platforms": { "circles": ["watchOS"], "squares": ["macOS"] }
}
```

Note what is _absent_: no baked highlight, no baked shadow. The layer
(`apps/mobile/assets/AppIcon.icon/Assets/Mark.svg`) is flat artwork. iOS adds the glass — asking for `specular`
and `shadow` here is asking the _system_ to draw them. Baking them into the SVG
double-applies them.

That claim is directly observable in actool's own output. Sampling the centre
column of the compiled legacy rendition `AppIcon76x76@2x~ipad.png` (152×152):
the symbol's colour runs monotonically from green 137 / blue 151 at the top to
green 63 / blue 76 at the bottom — but the topmost band reads `#ff8997`,
_brighter than the source SVG's own top stop_ `#F65360`. actool baked the system
specular treatment in. The source did not contain it.

### The second trap: `userSpaceOnUse` gradients under a transform

Found in the same work, in the generator's SVG rather than in `icon.json` — but
it is the same class of error, a wrong thing that passes every automated check.

The symbol's gradient first used `gradientUnits="userSpaceOnUse"` with
canvas-space coordinates. Those coordinates resolve in **the element's own
coordinate space, after its `transform`**. The symbol is drawn with
`transform="translate(180.961,325.370) scale(12.748475)"`
(`apps/mobile/assets/AppIcon.icon/Assets/Mark.svg:6`), into a local box of 48×35 units — so
canvas-space endpoints landed far outside it and the entire shape flattened to
the first stop.

The output was a structurally valid PNG of the correct dimensions with the
correct alpha channel. It passed every check. It was the wrong art. It was
caught only by sampling pixels.

```diff
- <linearGradient id="mark" gradientUnits="userSpaceOnUse"
-   x1="0" y1="0" x2="0" y2="1024">
+ <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
```

`objectBoundingBox` is the SVG default and is transform-independent: `0..1`
means "across this element's own box", wherever the element ends up. The rule
is recorded at `generate-app-icon.mjs:94-104`.

The contrast inside the same file is the crisp statement of when each is
correct. `fieldSvg` legitimately uses `userSpaceOnUse`
(`generate-app-icon.mjs:130`) with computed canvas endpoints from
`gradientEndpoints` (`:110-122`) — because it fills a `<rect>` at the canvas
origin with **no transform**, so element space and canvas space coincide.
**`userSpaceOnUse` is safe only on an untransformed, canvas-aligned element.**

### The guardrail worth copying

Both traps share a shape: a wrong value produces a well-formed artifact. The
generator's answer is to re-derive rather than trust. The symbol is centred on
its measured alpha centroid, not its bounding box (the sliced corner removes
weight, so a box-centred symbol visibly sags), and
`generate-app-icon.mjs:265-271` re-measures that centroid from the rasterised
path on **every** run — not behind the `--verify-centroid` flag — aborting
before writing anything if it has drifted past 0.001:

```js
// Re-derive the centroid on EVERY run, not just behind the flag. These two
// constants place the symbol in every output, so a guard that only fires when
// someone remembers to ask for it is not guarding anything.
```

The same reasoning applies to the `actool` check. A validation step that only
runs when someone remembers is not a validation step — which is why the exact
command lives in `apps/mobile/CLAUDE.md` rather than in a commit message.

## Related

- `apps/mobile/CLAUDE.md` — "App icon" section: the canonical `actool` command
  and the regenerate-never-hand-edit rule.
- `apps/mobile/scripts/generate-app-icon.mjs` — single source for every icon
  asset (`pnpm icons:generate`). Borrows `apps/admin`'s `sharp` deliberately, to
  keep a native binary out of every EAS build (`:34-52`).
- PR **#1883** (`feat(mobile): replace placeholder app icon with generated Kin
design`) — **open, mergeable, CI green (13 success / 3 skipped) as of
  2026-08-10**; not yet merged.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the general law this is an instance of: a check that cannot go red is not
  evidence. Falsify every guard once. The abbreviated `actool` invocation is a
  textbook case, since it fails _open_ on a bundle Xcode will reject.
- Outstanding, unrelated to correctness: the JFP symbol on near-black is not one
  of the four symbol-on-background combinations `brandpad.io/jfp` permits. It
  matches the existing tvOS tile, which has the same issue. Pending a waiver
  from the brand owner.
