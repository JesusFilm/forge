---
title: "Kill-switch reach follows its slowest artifact channel — a flag whose off state needs a regenerated native asset cannot ship over the air"
date: "2026-09-15"
category: "architecture-patterns"
module: "apps/mobile (src/lib/splash/animatedSplashEnabled.ts, src/lib/splash/splashSession.ts, scripts/generate-app-icon.mjs, app.json) — the animated-splash kill switch, PR #2296 (open as of this writing)"
problem_type: "architecture_pattern"
component: "tooling"
severity: "high"
root_cause: "incorrect_assumption"
related_components:
  - "apps/mobile"
  - "expo-splash-screen"
  - "eas-update"
  - "@expo/fingerprint"
  - "apps/mobile/scripts/generate-app-icon.mjs"
applies_when:
  - "A feature flag's off state needs both a JS change and a regenerated native asset (splash image, app icon, launch screen, bundled font)"
  - 'The app sets runtimeVersion.policy to "fingerprint", so every asset a config plugin names is a hashed input to the runtime version'
  - "Deciding whether merging a disable is enough, or whether installed builds keep the feature until a new native build ships"
  - "A committed-artifact guard (md5, checksum, content hash) pins the asset to the flag state and so forecloses an asset-only shortcut"
  - "Planning a rollback whose halves travel on different release channels — an OTA bundle and a store or TestFlight binary"
symptoms:
  - "`eas update` exits 0 and reports success while the published update reaches no installed build"
  - "Installed testers keep an unapproved feature after the disabling PR merges with green CI"
  - "Unrelated JS hotfixes published in the same window are silently unreachable, and nothing reports it"
  - "A local simulator keeps showing the old native asset because `expo run:ios` skips prebuild when `ios/` already exists"
tags:
  - "kill-switch"
  - "feature-flag"
  - "eas-update"
  - "runtime-version"
  - "fingerprint"
  - "expo"
  - "native-asset"
  - "rollback"
---

# Kill-switch reach follows its slowest artifact channel

## Context

`apps/mobile` shipped a branded animated cold-start splash (PR #2216, with fixes
in #2228). It reached TestFlight build 1.0.0 (7). The product lead then did not
approve it. The task was to disable the animation without deleting the code, and
to restore the original JFP logo on the native splash. That work is
PR #2296 on branch `fix/mobile-disable-animated-splash`, open as of this writing.

The disable looks like one line. The flag file is one line:

```ts
// apps/mobile/src/lib/splash/animatedSplashEnabled.ts:4
export const ANIMATED_SPLASH_ENABLED = false
```

It is not one line, because the flag's surface is not only JavaScript. The
animation opens on an empty field, so the native splash it hands over from must
be flat. Turn the animation off and that flat field becomes a logo-less launch.
The correct disable therefore also changes a committed PNG,
`apps/mobile/assets/splash-icon.png`, which `app.json` names as the
`expo-splash-screen` plugin image (`apps/mobile/app.json:106-114`).

`apps/mobile` ships through two channels with very different latency. `eas update`
pushes a JavaScript bundle in minutes (`apps/mobile/package.json:16-17` define
`update:preview` and `update:production`). `eas build` produces a native binary in
hours, plus store review. The app sets `runtimeVersion.policy: "fingerprint"`
(`apps/mobile/app.json:46-48`), and an update only reaches a build that carries the
same runtime version.

So the flag's two halves travel on different channels at different speeds. Nothing
in the tree said so before this session. The Tier-2 code review's adversarial lens
raised the reach gap late, as a P2, and synthesis demoted it to a residual risk.
Every earlier reviewer read the change as complete. That is the gap this learning
closes: engineers reason about a kill switch as one act, and this one is two acts
with different reach, with the fast channel dark in between.

**The same surface had already hit this once, six days earlier (session history).**
When PR #2216 first shipped the animation, that session measured the divergence
rather than assuming it: the production build every tester carried, 1.0.0 (5), was
on runtime version `2f6c1e79…`, while `main` after the merge computed `d1618f49…`.
The conclusion recorded then was that the next `eas update` would reach zero
devices — it "exits 0, prints nothing, reaching nobody". A native build, 1.0.0 (7)
from the beam-fix commit, cleared that gate and moved the installed baseline onto
`d1618f49…`. So the trap is not novel to the disable. It is a property of this
flag's surface, and it recurred the moment the surface was touched again. A team
that met it once and did not write down the shape met it again six days later.

## Guidance

**A kill switch reaches only as far as its slowest-shipping artifact. Split the
flag's surface by deployment channel before you merge, not during the release.**

Four steps, in order.

### 1. List every artifact the flag touches

Include generated and binary artifacts, not only source files. For the splash
kill switch the list is: the flag file, the session call site, the icon generator,
and the committed `splash-icon.png`. Three of the four are text. The fourth is the
one that changes the answer.

### 2. Map each artifact to the channel that carries it — by reading the tool

Do not infer the channel. For an Expo app on the fingerprint policy, the list of
hashed inputs is readable code. In `@expo/fingerprint` 0.20.13 — the version
`expo@57.0.22` depends on, and `apps/mobile/package.json:36` pins `expo` at
`~57.0.22` — the Expo config sourcer does this. The file is
`build/sourcer/Expo.js` inside the installed package, not a repo path; on a pnpm
checkout it resolves under
`node_modules/.pnpm/@expo+fingerprint@0.20.13/node_modules/@expo/fingerprint/`.

- `Expo.js:36` reads the `expo-splash-screen` plugin props.
- `Expo.js:52` puts `splashScreenPluginProps?.image` into the external-file list,
  beside the `expo-font` font files (`:39-44`) and the app icons (`:45-50`).
- `Expo.js:76` hashes each external file with the reason
  `expoConfigExternalFile`.
- `Expo.js:185-198` sets `overrideHashKey =
'expoConfigExternalFile:contentsOnly'` on each one (`:195`). The comment beside
  it states the intent: the config contents are already in the fingerprint, so the
  file _path_ is ignored and only the _contents_ count.

That last line is the whole mechanism. The bytes of
`apps/mobile/assets/splash-icon.png` are a fingerprint input. Change the bytes and the runtime version moves. The asset
cannot travel by `eas update`, because the update it travels in targets a runtime
version that no installed build carries.

The same sourcer hashes `eas.json` and `.easignore` separately at
`Expo.js:201-203`, with the reason `easBuild`. So an `eas.json` edit
moves the runtime version too. Re-read this file after an Expo SDK bump; the list
is versioned, not permanent.

### 3. Decide what the fast channel does during the gap, and say it out loud

Name the dark window before you merge. Two facts belong in that statement.

**A success exit code is not a reach report.** `eas update` publishes under the
runtime version it computes from the branch. It does not check that any installed
build carries that version. Per this session's conclusion, written into
`apps/mobile/CLAUDE.md:248-259`, the command still exits 0 and reports success
while reaching nobody.

**The dark window is not feature-scoped.** Every unrelated JavaScript hotfix
published to that channel in the same window targets the same moved runtime
version, so it reaches nobody either, and nothing says so. A feature-scoped review
cannot see this, because it is not about the feature.

### 4. Record the reach where the next agent reads it

Put it in the app instruction file, not in the PR description. PR #2296 writes it
into `apps/mobile/CLAUDE.md:179-259` on its branch. That section states what a cold launch does
now, which binaries are affected, the exact steps to reverse the change, and the
open decision with a named owner and a default posture
(`apps/mobile/CLAUDE.md:255-259`).

### A consequence to state, not to discover

Once the two halves must agree, a guard usually enforces that agreement — and the
same guard forecloses the split-channel shortcut.

The only OTA that could reach installed builds here is "flag off plus the OLD flat
asset". `apps/mobile/src/lib/splash/__tests__/splashKillSwitch.guard.test.js`
rejects exactly that pairing: it pins the committed PNG to the flag state by md5
and IHDR colour type (`:30-34`, `:149-158`). No committed tree can hold it.

That is correct behaviour, not a defect. But write it down. An operator who meets
this guard for the first time during a rollback, under time pressure, will read it
as an obstacle and may delete it. A team that wants the split OTA should take it on
a deliberate throwaway branch, as a named release decision. Nobody should improvise
it from `main`.

### A second consequence: the off state changes which code path runs

Splitting the surface by channel is the reach question. There is a liveness
question beside it, and the same session history supplies the case.

When the animation first shipped, a reviewer found that the native splash was held
unconditionally at module scope but released only when the cover reported its first
painted frame. On the deep-link path the cover draws nothing, so the release never
fired and the held splash covered the destination screen indefinitely. The flat
asset made the hang indistinguishable from a slow load. It was fixed in-branch with
an unconditional backstop on the same line that takes the hold (session history).

An off mode is that same shape by construction: it makes a component draw nothing,
so it inherits every path that assumed the component would draw something. Before
merging a flag that silences a surface, follow the resource that surface was
responsible for releasing, and confirm something still releases it when the surface
never appears. Here the off state reuses the deep-link path deliberately, and the
review of this change added a source guard pinning the one call the release depends
on, because deleting it would have looked like dead-code cleanup:
`apps/mobile/app/__tests__/splashHostOwnership.guard.test.js:143-149` asserts that
`getSplashSession?.().start()` sits in the module-scope require block and follows
`preventNativeSplashAutoHide()`.

## Why This Matters

Getting this wrong produces two failures, and only the first one is visible.

The first failure: the team believes the feature is off, and it is off on no
installed device. Every tester keeps the unapproved behaviour. The disable PR is
merged, CI is green, and the report says "shipped".

The second failure has no symptom at the publish site. The channel is silently
dark, so every unrelated hotfix published in that window also reaches nobody. A
team does not usually discover this by watching the channel. It discovers it when
a later incident fix does not take effect, and then spends the incident debugging
the wrong thing.

Timing makes it worse. A kill switch runs at the moment a team has the least
patience for a surprise. Discovering split reach during a rollback is the worst
time to discover it. Naming the reach before merge converts an unbounded risk into
a bounded decision with an owner and a default answer.

It also protects the guard that makes the change safe. A guard whose consequence is
undocumented reads as an obstacle. A guard whose consequence is documented reads as
the design.

**The error runs both ways, so state the split rather than a blanket.** When the
animation shipped, the plan first claimed the whole feature "cannot ship as an OTA
update"
(`docs/plans/2026-09-09-1059-feat-mobile-animated-splash-plan.md:189`); plan review
corrected it in the same document, because JavaScript-only changes under
`apps/mobile/src/` and `apps/mobile/app/` do not move the fingerprint runtime
version (`:194`, and the same rule at `apps/mobile/CLAUDE.md:319`). Both the blanket "nothing
can ship" and the blanket "it's just a flag" are wrong for the same reason: they
answer for the change instead of for each artifact. Split the surface and the
answer falls out — the JavaScript half is OTA-deliverable today, the regenerated
asset is not, and the disable is only correct with both.

This is the third member of a family already in the corpus. Each member says that a
flag's coverage has a boundary, and that the boundary is never the flag file:

- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
  — the boundary in **data lifetime**. A flag that gates production does not gate
  replay of what it already produced.
- This learning — the boundary in **artifact reach**. A flag that gates the source
  does not gate a fleet running an older binary.
- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
  — the boundary in **rollback capability**. Where you enforce depends on what you
  can undo.

## When to Apply

A feature flag on its own is not the trigger. The trigger is narrower. Apply this
when **both** conditions hold:

1. The product decision is reversible by changing a value, and
2. The flag's **correct** surface includes at least one artifact the fast
   deployment channel cannot carry.

Condition 2 is the one people skip. Ask it as: "if I flip only the value, is the
result correct on an already-installed build?" If the answer is no, the surface
spans a channel boundary.

**For Expo apps on a fingerprint runtime version policy**, "cannot carry" means the
artifact is a fingerprint input. In `apps/mobile` today that includes any file
named by the `expo-splash-screen` block (`apps/mobile/app.json:106-114`) or the
`expo-font` block (`apps/mobile/app.json:84-105`), the app icons, any config plugin
module, `app.json` itself, and `eas.json`. Read
`build/sourcer/Expo.js` in the installed `@expo/fingerprint` package to confirm the
list for your version, and measure with `npx eas-cli fingerprint:generate` from
`apps/mobile`. Two cautions on that measurement come
from the earlier build round and were not re-measured here (session history):

- **Prefer `eas-cli`.** `npx expo-updates fingerprint:generate` is not a faithful
  stand-in — on that tree it reported a third value that matched neither the local
  nor the server-side fingerprint.
- **Install from the lockfile first.** A stale `node_modules` moves the local
  fingerprint, because the pnpm virtual-store paths carry resolved versions. It
  fails at the far end and badly: build 1.0.0 (6) died in `CONFIGURE_EXPO_UPDATES`
  reporting only `UNKNOWN_ERROR`, with the fatal log line empty and the real signal
  in a warning above it. A failed build still burns the version counter. The
  pre-flight that worked was `pnpm install --frozen-lockfile` at the repo root,
  then `npx eas-cli fingerprint:compare --build-id <id>`, then
  `npx eas-cli fingerprint:generate --platform ios`, launching only on an exact
  match.

**Outside Expo**, the same shape appears wherever a flag's surface spans two
channels with different latency:

- a server flag whose correct behaviour also needs a database migration;
- a web flag whose correct rendering also needs a CDN asset or a service-worker
  precache entry;
- a config-service flag paired with a compiled-in constant or a container image;
- any mobile flag paired with a store-reviewed binary.

**Do not apply** when the flag's whole surface lives in the fast channel. A pure
JavaScript flag with no asset change is one act. Ship it.

**Apply in both directions.** Re-enabling has the same split, and it fails the
other way: the flag turns on while the old native asset still carries the symbol,
so the launch shows a symbol and then blanks it. `apps/mobile/CLAUDE.md:235-246`
records the three re-enable steps as one PR for exactly this reason.

## Examples

### Before — the shape that looks complete

```ts
// The whole "disable", as it is tempting to write it.
export const ANIMATED_SPLASH_ENABLED = false
```

Merge it, run `update:production`, report "disabled". The command exits 0. Every
installed build still animates. Nothing reports the gap, and the next unrelated JS
hotfix on that channel is unreachable too.

The mirror-image mistake is just as easy: flip the flag, leave the generated asset
alone, and ship a native build. The JavaScript never draws the animation, so the
native splash hands over from a flat `#1c1917` field straight to Home. Users get a
launch with no logo anywhere.

### After — what PR #2296 ties together on its branch

**One flag, one line, one bare literal.**
`apps/mobile/src/lib/splash/animatedSplashEnabled.ts:1-4`. The comment above it
states why the shape is fixed: two other tools parse this line by regex.

**A required dependency, so no call site can inherit a default.**

```ts
// apps/mobile/src/lib/splash/splashSession.ts:32-34
export type SplashSessionDeps = {
  /** The kill-switch. Required, so no call site can inherit a default. */
  animatedSplashEnabled: boolean
```

The branch settles the never-plays snapshot synchronously
(`apps/mobile/src/lib/splash/splashSession.ts:221-231`), reusing
`endWithoutPlaying()` (`:142-145`) — the same shape the deep-link launch already
took. `SplashHost` then lowers the native splash on its first commit
(`apps/mobile/src/components/splash/SplashHost.tsx:124-126`). The app-wide session
passes the constant, never a literal (`:276-281`). `apps/mobile/app/_layout.tsx`
and `apps/mobile/app.json` are unchanged.

**The generator reads the same file with the same pattern.**

```js
// apps/mobile/scripts/generate-app-icon.mjs:93-96
const ANIMATED_SPLASH_FLAG = path.join(
  MOBILE,
  "src/lib/splash/animatedSplashEnabled.ts",
)
```

`readAnimatedSplashEnabled()` (`:332-350`) matches
`/^export const ANIMATED_SPLASH_ENABLED = (true|false)$/gm` and exits non-zero
unless it finds exactly one declaration, so a second copy inside a comment cannot
make the script and the app disagree. The branch at `:400-416` emits
`flatSvg(SIZE, SPLASH_GROUND)` when the flag is on and
`markSvg(SIZE, WIDTH_SPLASH)` when it is off.

**A guard ties all four artifacts together.**
`apps/mobile/src/lib/splash/__tests__/splashKillSwitch.guard.test.js` pins the flag
file's single declaration (`:109-111`), the session call site (`:113-121`), the
generator's file path and regex (`:123-127`), which emission each half of the
generator branch calls (`:140-147`), and the committed PNG's md5 and IHDR colour
type per flag state (`:30-34`, `:149-158`). The committed asset on this branch has the md5
checksum `b3b28de172a24275e72f0e6abd3a45cf`, which is the `off` pin. That is
byte-identical to the asset as it stood before #2216: the pre-#2216 copy is not in
the working tree, so check it from history with
`git show d9e215d8c~1:apps/mobile/assets/splash-icon.png | md5`, which returns the
same checksum.

### The paragraph that is the actual learning

The four artifacts above are all recoverable from the code. The reach is not. This
is what PR #2296 adds to `apps/mobile/CLAUDE.md:248-259`, and it is the shape to
copy (quoted from that branch; the PR is open as of this writing):

> **Until that native build ships, the production channel is dark.** Every
> `update:production` from `main` targets a runtime version no installed build
> carries. `eas update` still exits 0 and reports success, so an unrelated JS
> hotfix published in this window reaches nobody and nothing says so. Installed
> testers keep the animation until they install the new build. The only OTA that
> could reach them is the flag off with the OLD flat asset, and
> `splashKillSwitch.guard.test.js` rejects that pairing by md5 on any committed
> tree, by design. **Open decision, owner: the release caller.** The default
> posture is to wait for the build. Taking the animation off installed devices
> sooner needs a deliberate throwaway-branch OTA and an explicit call; do not
> improvise it from `main`.

Four things make it work, and each is portable to another flag: it names the dark
window, it says that the success exit code proves nothing, it explains why the
shortcut is foreclosed and that this is deliberate, and it assigns the residual
decision to a person with a stated default.

### Two adjacent traps this session met

Both are verification traps, not reach traps, and both have homes elsewhere in the
corpus. They are listed here only so a reader of this doc does not repeat them.

- **The binary lags the tree.** `expo run:ios` skips prebuild when
  `apps/mobile/ios/` already exists (a gitignored prebuild output directory), so
  the simulator kept showing the old asset until
  `npx expo prebuild --platform ios` ran. Every `apps/mobile` binary built between
  2026-09-10 and 2026-09-15 carries the flat field. See
  `apps/mobile/CLAUDE.md:222-234`.
- **A warm dev server is not a bundler check.** A live Metro served a
  byte-identical cached bundle after a statically imported asset was deleted, while
  `npx expo export --platform ios` exited 1 and named the importing file
  (`apps/mobile/src/components/splash/SplashSequence.tsx:13-14`). Assert a
  bundler-resolution claim against `expo export`, never against a running dev
  server. This belongs as a refresh to
  `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`.

One corpus doc is now stale on a related point and is a separate refresh candidate:
`docs/solutions/mobile/eas-update-stakeholder-preview-setup.md:55-70` still
documents `runtimeVersion.policy: "sdkVersion"` for this app, which
`apps/mobile/app.json:46-48` has since changed to `"fingerprint"`. Its
"what needs a rebuild" table is correct in spirit but does not name asset contents
as an input.

## Related learnings

- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
  — the same family, a different boundary. That one's boundary is **data
  lifetime**: a flag that gates production does not gate replay of what it
  already produced. This one's is **artifact reach**: a flag that gates the
  source does not gate a fleet running an older binary.
- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
  — the third member: **where** to enforce follows what you can undo. All three
  say a flag's meaning is a property of the surrounding system, not of the flag.
- `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md`
  — flag wiring discipline. Threading the constant as a required dependency, so
  no call site can inherit a default, is that law applied here.
- `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`
  — the same instinct applied to teardown: write the reversal recipe while the
  map is fresh. The three-step re-enable recipe exists for that reason.
- `docs/solutions/build-errors/eas-build-macos-image-bump-sharp-global-libvips-install-failure.md`
  and `docs/solutions/ui-bugs/android-nav-bar-edge-to-edge-contrast-scrim.md`
  — prior art. Each already records this mechanism as a one-line caution for a
  different hashed input (`eas.json`, an Android theme change).
- `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`
  — the same failure signature from an unrelated cause: `eas update` reports
  success and ships something that cannot work.
- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`
  — where the two verification traps named above belong in full.
- `docs/solutions/ui-bugs/expo-splash-screen-sdk57-full-bleed-default-change.md`
  — why `enableFullScreenImage_legacy` is load-bearing again now that the
  committed asset carries the symbol.
