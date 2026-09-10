---
title: Prove the artifact and prove the instrument before diagnosing a mobile defect from a device
date: 2026-09-11
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
applies_when:
  - Verifying a cold-launch or splash-screen change in an Expo dev client build
  - A Debug build renders a different font, image, or layout than a Release build of the same tree
  - "`expo run:ios` (or `xcodebuild`/`devicectl`) reports install success but the app does not appear, or appears stale, on the device or simulator"
  - Judging a timed animation (a splash, a transition) from a screenshot or a low-frame-rate screen recording
  - Deciding whether a visual defect belongs to product code or to the dev-build toolchain around it
symptoms:
  - A static app-icon splash appears before the real animated splash, and reads as an extra leftover splash screen
  - A Debug build shows the system font where a custom embedded font was expected, even though the font file, Info.plist entry, and Xcode build phase all look correct
  - '`expo run:ios` prints "Build Succeeded", "0 error(s)", and 100% install complete, but the app is not on the device'
  - A ~2.5s splash animation looks like it is missing a beat in a 6fps screen recording, but is not missing it
severity: medium
tags:
  [
    expo-dev-client,
    splash-screen,
    xcode,
    devicectl,
    simulator,
    dev-build,
    verification,
    ios,
  ]
---

# Prove the artifact and prove the instrument before diagnosing a mobile defect from a device

## Context

On 2026-09-11 an agent verified a visual change to the `apps/mobile` cold-start
splash — the **Splash Cover**, in this project's vocabulary — on branch
`fix/mobile-splash-beam` (PR #2228, OPEN and unmerged at the time of writing;
the splash itself landed in PR #2216, merged 2026-09-09).
Three separate layers of the iOS development loop each showed something that
looked like the product and was not. Two of the three reached a wrong diagnosis
before the correct check ran, and the user reported the set as "so many
regressions". None of the three was a defect in the app.

The three layers were:

1. The `expo-dev-client` launcher painted the app icon before any JavaScript
   ran, and that frame read as the app's own splash.
2. The installed `.app` did not contain the embedded font, although every
   configuration file that names the font was correct.
3. `expo run:ios --device` printed `Build Succeeded` and an `› Installing …`
   line, exited 0, and left nothing installed on the device.

A fourth, softer failure ran across all three: a single screenshot, and then a
6 fps video sample, both misread a ~2.5s animation as a regression.

Four existing memory notes in this repo record earlier instances of the same
theme, and one existing solution doc states the Metro-side half of it:
`docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md`.
The general rule was never written down, so each instance cost a fresh
diagnosis.

The session that built this splash had already met the same class of problem
and had already built partial defences (session history):

- It verified the embedded font by introspecting configuration —
  `expo config --type introspect` showing `UIAppFonts: ['NotoSerif-SemiBold.ttf']`.
  **That is precisely the check that passes while the font is absent from the
  built app.** Instance 2 below is therefore a correction to that prior
  approach, not a new topic: configuration introspection answers what the
  build was asked to do, never what it produced.
- It had already found that a burst of screenshots bunches up near the trigger
  and misses the tail of a sequence, and switched to video for that reason.
  The instrument half below extends that finding rather than discovering it.
- It nearly accepted a stale app as current, after an interrupted
  `expo run:ios --configuration Release` finished installing in the
  background. It caught this by comparing the installed binary's timestamp
  against its own commit timestamps. That is a fourth artifact-identity
  check, and it catches the case where a build _did_ land but is older than
  your work:

  ```bash
  # Is the thing on the device newer than the change you are verifying?
  stat -f '%Sm' "$APP"; git log -1 --format=%cd
  ```

- It chose the `expo-font` plugin's object form over its array form precisely
  because the array form makes Android derive the family name from the
  sanitized filename, so one `fontFamily` string resolves on iOS and silently
  falls back on Android. Font absence has more than one silent mode.

## Guidance

### The general rule

Before you diagnose a defect from what a device shows, answer two questions,
and read each answer from the device or the artifact itself — never from the
tool that built, installed, or launched it.

1. **Artifact identity.** Is the device running the code and the resources you
   think it is?
2. **Instrument adequacy.** Can the capture you are about to take actually
   contain the thing you are looking for?

A build tool, an installer, and a launcher each report on their own step. None
of them reports on the state you are about to judge. A success-shaped message
from any of them is an acknowledgement, not evidence. This repo already carries
the same law for infrastructure writes:
`docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`.
The rule here is that law applied to a device, and it transfers to Android, to
tvOS, and to any platform where a build step, an install step, and a launch
step are three separate programs.

Each question below leads with its discriminating check. Run the check first.
Read configuration files only after the check disagrees with them.

### Instance 1 — a native pre-JavaScript surface can look like your JavaScript

**Discriminating check: stop Metro, then cold-launch the app. No JavaScript can
run, so every pixel you then see is native.**

```bash
# Stop the packager that serves this app, then relaunch and sample frames.
xcrun simctl terminate <udid> org.jesusfilm.forgewatch
xcrun simctl launch <udid> org.jesusfilm.forgewatch
xcrun simctl io <udid> screenshot --type=png /tmp/native-only.png
```

In this session that check returned a single flat colour, `(28,25,23)`, with
zero pixels of the crimson mark, at every sample. The crimson frame therefore
could not be the app's native splash. It was `EXDevLauncher.bundle` rendering
the app icon while it downloaded the JS bundle from Metro.

The app's native splash is genuinely flat, and the current tree proves it three
ways. `apps/mobile/app.json:106-113` configures `expo-splash-screen` with
`"image": "./assets/splash-icon.png"` and `"backgroundColor": "#1c1917"`.
`apps/mobile/scripts/generate-app-icon.mjs:371-377` emits that PNG from
`flatSvg(SIZE, SPLASH_GROUND)` (`flatSvg` at line 151, `SPLASH_GROUND =
"#1c1917"` at line 88), so the file is one rectangle of one colour by
construction. Decoding the committed
`apps/mobile/assets/splash-icon.png` today gives 1024x1024, colour type 2, and
exactly **1 distinct colour, `(28,25,23)`** — which is `#1c1917`.
`generate-app-icon.mjs:304` also defines `verifySplashGround()`, called at
line 329, which re-reads `app.json` and exits non-zero if the two declarations
of the ground colour drift apart. Line 328 is `if (explicit) return`, so an
ordinary generate run makes this check and a `--verify-centroid` run skips it.

Three weaker signals pointed the same way and are worth knowing, because they
cost nothing when you already have a recording:

- The crimson frame carried no dev-client "Tools" bubble.
- Its mark sat higher and smaller than the animation's mark. The animation's
  mark is exactly 55% of the frame width, because
  `apps/mobile/src/components/splash/SplashSequence.tsx:19` sets
  `MARK_WIDTH_RATIO = 0.55` and line 185 applies it as
  `frame.width * MARK_WIDTH_RATIO`. Measure the mark's width in a frame and you
  can tell the two renderers apart.
- A Release build (`expo run:ios --configuration Release`) produced no
  crimson-without-beam frames at all.

Treat all three as corroboration. The Metro-off launch is the check that
settles it, because it removes the whole JavaScript layer instead of arguing
about pixels.

### Instance 2 — the installed app can lack a resource that every config file declares

**Discriminating check: search the INSTALLED `.app` for the resource, and read
the BUILT `Info.plist`, not the source one.**

```bash
APP=~/Library/Developer/Xcode/DerivedData/forgewatch-<hash>/Build/Products/<config>/forgewatch.app
find "$APP" -iname "*NotoSerif*"
plutil -extract UIAppFonts json -o - "$APP/Info.plist"
```

The symptom was that the splash word "Jesus" rendered in the iOS system face.
Every configuration in the tree is correct, and still is:

- `apps/mobile/src/components/splash/SplashSequence.tsx` declares
  `const WORD_FAMILY = "NotoSerif-SemiBold"` and applies it in the word's
  style as `fontFamily: WORD_FAMILY`.
- Parsing the `name` table of `apps/mobile/assets/fonts/NotoSerif-SemiBold.ttf`
  gives PostScript name `NotoSerif-SemiBold` and family `Noto Serif SemiBold`.
  `WORD_FAMILY` matches the PostScript name, which is what iOS resolves.
- `apps/mobile/app.json:84-105` registers the file with `expo-font` for iOS and
  Android.
- `apps/mobile/ios/forgewatch/Info.plist:72-75` lists
  `NotoSerif-SemiBold.ttf` under `UIAppFonts`.
- `apps/mobile/ios/forgewatch.xcodeproj/project.pbxproj` references the file
  four times, including in the app target's Resources build phase (line 215).

The font was still absent from the built app. iOS cannot load a font that is
not in the bundle, and it falls back to the system face without a warning.

**The current tree still reproduces the divergence, and it identifies a cause
that this session did not find.** Two `forgewatch-*` DerivedData roots exist
right now, and each records a different workspace in its own `info.plist`:

| DerivedData root                          | Workspace it belongs to                                                               | Products                                  | `NotoSerif-SemiBold.ttf` | `UIAppFonts` in built `Info.plist` |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------ | ---------------------------------- |
| `forgewatch-brxylmknkllqqrgmumgifbgbzlpo` | `apps/mobile/ios/forgewatch.xcworkspace` (main checkout)                              | `Release-iphoneos`                        | present                  | `["NotoSerif-SemiBold.ttf"]`       |
| `forgewatch-hdcfukheasypoucyslvhtplugjds` | `.claude/worktrees/feat-mobile-download-sheet/apps/mobile/ios/forgewatch.xcworkspace` | `Debug-iphoneos`, `Debug-iphonesimulator` | **absent**               | **key absent**                     |

The Debug products are the newer ones (`Debug-iphonesimulator` at
2026-09-10 17:12, against the Release product at 16:55), so staleness in time
does not explain them. They were built from a different checkout. That
worktree's own `apps/mobile/ios/` predates the font: its
`ios/forgewatch/Info.plist` has no `UIAppFonts` key, and its
`project.pbxproj` contains zero occurrences of `NotoSerif`, even though its
source tree does carry `apps/mobile/assets/fonts/NotoSerif-SemiBold.ttf`.

The mechanism is that `apps/mobile/ios/` is untracked, generated output
(`git ls-files apps/mobile/ios` returns nothing). A config plugin writes the
font into `Info.plist` and into the Xcode project at `expo prebuild` time. A
worktree whose `ios/` was generated before the font landed keeps a project that
never mentions the font, however current its JavaScript is. So the divergence
is not Debug-versus-Release. It is checkout-versus-checkout.

So the practical rule has two parts. Search the installed `.app` first, because
that answers the question in one command. Then, if the resource is missing,
check which checkout produced the product before you touch any configuration
file. After a `git pull` or a rebase that brings in a new native resource, run
`expo prebuild` in that checkout, or the resource stays out of that checkout's
builds.

### Instance 3 — the installer can report success against a path that does not exist

**Discriminating check: ask the DEVICE which apps it has. Do not read the
installer's output.**

```bash
xcrun devicectl device info apps --device <device-id> \
  --bundle-id org.jesusfilm.forgewatch
```

An empty `Apps installed:` list means the app is not there, whatever the
installer printed. In this session `expo run:ios --device <udid>` printed
`Build Succeeded`, `0 error(s)`, an `› Installing
/…/DerivedData/forgewatch-brxylmknkllqqrgmumgifbgbzlpo/Build/Products/Debug-iphoneos/forgewatch.app`
line, `- CreatingStagingDirectory`, `✔ Complete 100%`, and exited 0. The device
had no such app.

The install step pointed at a `.app` that did not exist. Installing the stale
path by hand failed with `CoreDeviceError 3002` and `NSCocoaErrorDomain 260`
("The file couldn't be opened because it doesn't exist"). Installing the
correct path by hand succeeded and returned a container URL:

```bash
xcrun devicectl device install app --device <device-id> <correct .app>
```

Xcode names a DerivedData root from the path of the workspace or project it
builds. The table above shows this directly: two roots, two different
`WorkspacePath` values, one app. This session concluded that `expo prebuild`
changed the hash. That explanation is not supported by path-based naming — the
hash follows the path, and prebuild recreates the same path. The supported
explanation is that this repo has 48 active worktrees, each with
its own `apps/mobile/ios/forgewatch.xcworkspace`, so "the DerivedData root for
`apps/mobile`" is a multi-valued thing. A build in one checkout and an install
resolved against another produce exactly the observed output. Building the
`.xcodeproj` instead of the `.xcworkspace` would also produce a third root,
because that is a different path; both roots present today are workspace roots,
so this session gives no evidence either way for that variant.

When a mobile install looks wrong, resolve the root from the workspace rather
than from a remembered hash:

```bash
for r in ~/Library/Developer/Xcode/DerivedData/forgewatch-*; do
  echo "$(basename "$r") -> $(plutil -p "$r/info.plist" | grep -o '/Users.*xcworkspace')"
done
```

### The instrument half: choose a capture that can contain the thing

Artifact identity is only the first question. A correct artifact still gives a
wrong diagnosis when the capture cannot hold the evidence.

**This half is not new.** `docs/solutions/conventions/verify-animated-media-motion-rich-probe-window.md`
already states the governing law, and states it more carefully than a summary
usually does: a sample window that cannot contain the discriminating frame
makes the reading UNINTERPRETABLE, not merely doubtful. Byte-identical frames
are equally consistent with a frozen renderer and with a correct one fed a
static window. So you establish that the window holds the thing BEFORE you
read the diff at all. That doc reaches the law through an Android TV animated
webp; this one reaches it through an iOS splash. Read it for the general form.
Two of the axes below are new members of that family rather than platform
translations of it: capture RESOLUTION, the frame rate against the beat, and
capture FIDELITY, the codec's loss against the detail.

**A single screenshot cannot verify a timed animation.** The splash runs 2100ms
of motion inside a 2500ms hold. `SPLASH_SEQUENCE_MS` at
`apps/mobile/src/components/splash/SplashSequence.tsx:70-75` is the maximum of
four beat sums, and the word beat is the largest: `SPLASH_WORD_DELAY_MS = 1400`
(line 65) plus `SPLASH_WORD_MS = 700` (line 66) is 2100.
`SPLASH_HOLD_MS = 2_500` sits at `apps/mobile/src/lib/splash/splashSession.ts:63`.
The 400ms of slack runs against `SPLASH_MOUNT_LAG_ALLOWANCE_MS = 300`
(`splashSession.ts:87`), whose own comment records about 200ms of mount lag
measured on an iPhone 17 Pro Max simulator from a Release build. Development
builds mount more slowly, so in a development build the word beat lands during
the exit fade. A 6 fps capture missed the word beat completely and read as a
regression.

Use these, in this order:

1. **Record and step through frames** for sequencing questions:

   ```bash
   xcrun simctl io <udid> recordVideo --codec=h264 /tmp/splash.mov
   ffmpeg -i /tmp/splash.mov -vf fps=12 /tmp/frames/%03d.png
   ```

   Sample at 12 fps or higher. Classify frames by pixel content — for example,
   count crimson pixels against white pixels inside the mark's tile — instead
   of judging them by eye.

2. **Burst lossless screenshots** for measurement questions. `recordVideo`
   emits H.264, and its compression is too lossy to measure fine detail such as
   the wobble of a gradient band. Use repeated
   `xcrun simctl io <udid> screenshot --type=png` instead.

3. **Force Reduce Motion to photograph an end state.** Under Reduce Motion the
   sequence seeds every animated value at its end and runs no timing:
   `SplashSequence.tsx` sets `const rest = reduceMotion ? 1 : 0`, and the
   animation effect returns on `if (reduceMotion) return` before it starts
   anything. The
   finished frame therefore holds for the whole hold, and one screenshot is
   enough.

   ```bash
   xcrun simctl spawn <udid> defaults write com.apple.Accessibility \
     ReduceMotionEnabled -bool true
   xcrun simctl spawn <udid> notifyutil -p \
     com.apple.Accessibility.ReduceMotionChangedNotification
   ```

### What is not established

- The trigger for the missing font in the session's own Debug build is not
  proven. This session's conclusion was that an aborted first build reused a
  stale resource manifest. The current tree does not support that: the newest
  Debug product was rewritten at 17:12 and still lacks both the font and the
  `UIAppFonts` key, and it belongs to a worktree whose `ios/` project never
  mentioned the font. Checkout divergence explains everything now visible.
  Whether a stale manifest also contributed cannot be checked, because no Debug
  product for the main checkout survives on disk.
- This session also reported that a clean Debug rebuild, after deleting the
  Debug product, did contain the font. No such product exists now, so that
  observation stands as this session's report only.
- Layer 1's identification of `EXDevLauncher.bundle` as the renderer is
  consistent with the tree: `EXDevLauncher.bundle` is present in both Debug
  products and absent from the Release product, which also carries a baked
  `main.jsbundle`. That is strong corroboration, not a direct observation of
  the launcher drawing that frame.
- All measurements here come from iOS simulators, one physical iPhone, and one
  macOS host. The two questions transfer to Android and tvOS; the exact
  commands do not.

## Why This Matters

Each of the three layers converts a healthy build into a bug report. That is
expensive in three ways.

It costs diagnosis time on a defect that does not exist. Layer 1 alone produced
a user-visible claim of a regression in a merged feature.

It damages trust in the verification loop. Once one screenshot has lied, every
later screenshot needs its own argument, and the reviewer cannot tell a real
regression from another instrument fault.

It hides real defects. A capture that misses a beat reports a regression that
is not there, and the same capture would miss a beat that really was broken.
The 6 fps sample in this session had both failure modes at once.

The cost is asymmetric, and that is the whole argument for running the checks
first. Each discriminating check above is one command and a few seconds.
Reading `app.json`, `Info.plist`, and the `pbxproj` took much longer in this
session and pointed at success three times while the font was absent from the
bundle.

## When to Apply

Run the artifact-identity check before you file, fix, or report any of these:

- A visual or behavioural defect you saw on a simulator, an emulator, or a
  physical device.
- A change that "does not work" after you edited source and relaunched.
- A missing font, image, sound, or native module.
- Any install, launch, or deploy step whose only evidence of success is its own
  output.

Run the instrument-adequacy check before you judge:

- An animation, a transition, or any behaviour shorter than about 3 seconds.
- A handover between two renderers, such as a native splash to a React tree.
- A fine visual measurement, such as a gradient, a band edge, or a sub-pixel
  offset.

The checks are most valuable in this repo when you work from a worktree, when
you have just pulled or rebased, or when you have more than one checkout of
`apps/mobile` on the machine. All three of this session's layers involved one
of those conditions.

## Examples

**Confirm what renders before JavaScript exists.**

```bash
# Stop the packager for this app first, so no JS bundle can be served.
xcrun simctl terminate <udid> org.jesusfilm.forgewatch
xcrun simctl launch <udid> org.jesusfilm.forgewatch
xcrun simctl io <udid> screenshot --type=png /tmp/native-only.png
```

Everything in `/tmp/native-only.png` is native. Compare it against the frame
you suspected of being the app's own splash.

**Confirm a resource reached the built app.**

```bash
# Resolve the root from its own recorded workspace path, never a remembered
# hash — the hash follows the workspace path, so it differs per checkout.
WS="$(git rev-parse --show-toplevel)/apps/mobile/ios/forgewatch.xcworkspace"
APP=$(for r in ~/Library/Developer/Xcode/DerivedData/forgewatch-*; do
  plutil -p "$r/info.plist" | grep -qF "$WS" &&
    echo "$r/Build/Products/Release-iphoneos/forgewatch.app"
done)
find "$APP" -iname "*NotoSerif*"
plutil -extract UIAppFonts json -o - "$APP/Info.plist"
```

Today this prints the font path and `["NotoSerif-SemiBold.ttf"]`. The same two
commands against the `feat-mobile-download-sheet` worktree's
`Debug-iphonesimulator` product print nothing and report
`No value at that key path`.

**Confirm the app is on the device.**

```bash
xcrun devicectl device info apps --device <device-id> \
  --bundle-id org.jesusfilm.forgewatch
```

**Find the right DerivedData root instead of trusting an installer's path.**

```bash
for r in ~/Library/Developer/Xcode/DerivedData/forgewatch-*; do
  echo "$(basename "$r") -> $(plutil -p "$r/info.plist" | grep -o '/Users.*xcworkspace')"
done
```

**Photograph the end state of a timed animation.**

```bash
xcrun simctl spawn <udid> defaults write com.apple.Accessibility \
  ReduceMotionEnabled -bool true
xcrun simctl spawn <udid> notifyutil -p \
  com.apple.Accessibility.ReduceMotionChangedNotification
xcrun simctl terminate <udid> org.jesusfilm.forgewatch
xcrun simctl launch <udid> org.jesusfilm.forgewatch
xcrun simctl io <udid> screenshot --type=png /tmp/splash-end.png
```

**Verify a flat asset is flat, rather than assuming it.** Decode the PNG and
count distinct colours. `apps/mobile/assets/splash-icon.png` returns one
colour, `(28,25,23)`, which matches `backgroundColor` at
`apps/mobile/app.json:111` and `SPLASH_GROUND` at
`apps/mobile/scripts/generate-app-icon.mjs:88`.

### Related

- `docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md`
  — the Metro-side half: prove your edit is in the served bundle.
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`
  — the same law for infrastructure writes.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home. This learning is a row in its worked-instance table: a check
  that reads the declaration layer passes while the built artifact lacks the
  thing declared.
- `docs/solutions/best-practices/icon-composer-schema-recovery-and-actool-silent-validation-20260810.md`
  — an Apple CLI validator that returns 0 without validating.
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`
  — running a worktree's own Metro when you verify from a worktree.
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md`
  — reading device state from the app container.
- `docs/solutions/conventions/verify-animated-media-motion-rich-probe-window.md`
  — the general form of the instrument half, via a different asset type.
- `docs/solutions/integration-issues/expo-screen-orientation-rnscreens-deferral-blocks-fullscreen-rotate.md`
  — the same actor, `expo-dev-launcher`, nests the view controller the dev
  client answers UIKit from. Rotation turned out NOT to need a Release
  comparison. The window traits that nesting still blocks do: the status bar
  and the home indicator. It supersedes
  `expo-dev-launcher-root-vc-blocks-fullscreen-rotate.md`; do not cite that
  doc's conclusion on its own.
- `docs/solutions/best-practices/nextjs-hmr-reload-breaks-stateful-browser-verification.md`
  — the non-mobile sibling: a verification instrument that invalidates the
  state it was meant to observe.
