---
title: "A physical-iPhone dev build of apps/mobile signs with the wrong Apple team, because mobile's app.json names no appleTeamId"
date: 2026-10-06
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
root_cause: config_error
resolution_type: environment_setup
applies_when:
  - "Building an apps/mobile development client onto a physical iPhone with npx expo run:ios --device"
  - "The Mac's Xcode holds more than one Apple team, or more than one Apple Development certificate"
  - "Running expo run:ios from a non-interactive shell, such as an agent's tool or a script"
  - "Launching an installed dev client on a physical iPhone at a Metro server on the Mac"
  - "Deciding whether to set ios.appleTeamId in apps/mobile/app.json"
symptoms:
  - "xcodebuild stops with No Account for Team followed by a personal team id, and finds no development profile for org.jesusfilm.forgewatch"
  - "expo run:ios prints Build Succeeded and Installing, then stops at '- Connecting to: <phone>' with no more output while the app is already installed"
  - "devicectl device process launch fails with BSErrorCodeDescription = Locked"
  - "npx expo run:ios --device <CoreDevice id> answers No device UDID or name matching"
  - "A second expo run:ios signs for the same wrong team with no prompt, because the first run wrote that team into the project"
tags:
  [
    mobile,
    ios,
    physical-device,
    code-signing,
    development-team,
    devicectl,
    expo-dev-client,
    feat-604,
  ]
---

# A physical-iPhone dev build of apps/mobile signs with the wrong Apple team, because mobile's app.json names no appleTeamId

## Context

The `feat-604` device check (PRs #2583 and #2584, open as of 2026-10-06)
needed a development client of `apps/mobile` on a physical iPhone. The Mac's
Xcode holds three Apple teams: Cru Global, Inc (`DQ48D9BF2V`, the team that
owns `org.jesusfilm.forgewatch`), a second organization, and a personal team.
The keychain holds an Apple Development certificate for each.

An earlier attempt on 2026-10-02 stopped at signing. `xcodebuild` reported
`No Account for Team "<personal team id>"` and found no development profile
for `org.jesusfilm.forgewatch` (auto memory [claude]). Whatever accounts
Xcode holds, the team that the build signs for comes from the config:

- `apps/tv/app.json:24` sets `"appleTeamId": "DQ48D9BF2V"`. `apps/mobile/app.json`
  sets no `ios.appleTeamId`.
- Prebuild writes `DEVELOPMENT_TEAM` only from `ios.appleTeamId`, and with
  no value it changes nothing (`withDevelopmentTeam` in
  `@expo/config-plugins` 57.0.9, `build/ios/DevelopmentTeam.js:62-71`, which
  `@expo/prebuild-config` 57.0.16 runs from
  `build/plugins/withDefaultPlugins.js:132`). The template has no team, so a
  new `ios/` folder, from a first prebuild or from `prebuild --clean`, has
  none. A plain prebuild reuses an existing `ios/` folder (`@expo/cli`
  57.0.27, `build/src/prebuild/copyTemplateFiles.js:77`), so a hand edit
  survives it.
- When the project has no team, `npx expo run:ios --device` chooses one
  (`ensureDeviceIsCodeSignedForDeploymentAsync`,
  `build/src/run/ios/codeSigning/configureCodeSigning.js:68`). In a
  non-interactive shell, it takes the FIRST Apple Development identity that
  `security find-identity` lists, with no prompt
  (`resolveCertificateSigningIdentity.js:121`; `Security.js:95` keeps only
  development identities). On this Mac that identity is the personal
  certificate, so the build signs for the personal team. Then it writes that
  team into the project (`configureCodeSigning.js:104`). The next run finds a
  team in every target and uses it with no prompt
  (`configureCodeSigning.js:69-71`), so a failed run leaves the wrong team
  behind.
- In an interactive terminal it prompts with "Development team for signing
  the app" (`resolveCertificateSigningIdentity.js:151`). When `app.json` has
  no `ios.appleTeamId`, it then WRITES the chosen team into `app.json`
  (`resolveCertificateSigningIdentity.js:142`). `apps/mobile/CLAUDE.md`
  treats `app.json` as a fingerprint input, so that edit can move the OTA
  runtime version if someone commits it.

## Guidance

### 1. Set the team in the generated project

`apps/mobile/ios/` is gitignored prebuild output. Set the team in every build
configuration of the app target after a first or clean prebuild, and after any
`expo run:ios` that signed for the wrong team. The script replaces a team that
is already there:

```bash
cd apps/mobile
python3 - <<'EOF'
import re
f = "ios/forgewatch.xcodeproj/project.pbxproj"
s = open(f).read()
count = 0
def set_team(m):
    global count
    block = m.group(0)
    if "PRODUCT_BUNDLE_IDENTIFIER = org.jesusfilm.forgewatch;" not in block:
        return block
    count += 1
    block = re.sub(r"\n\t*DEVELOPMENT_TEAM = [^;]*;", "", block)
    return block.replace("buildSettings = {", "buildSettings = {\n\t\t\t\tDEVELOPMENT_TEAM = DQ48D9BF2V;", 1)
s = re.sub(r"buildSettings = \{.*?\n\t\t\t\};", set_team, s, flags=re.S)
open(f, "w").write(s)
print("app target configurations set:", count)
EOF
grep -c "DEVELOPMENT_TEAM = DQ48D9BF2V" ios/forgewatch.xcodeproj/project.pbxproj
```

The `feat-604` run set two configurations (Debug and Release). The script was
also run on a copy with a wrong team and on a copy with no team, and both came
out the same as the working project. The build log then names the team before
it plans the build:

```text
› Auto signing app using team(s): DQ48D9BF2V
```

That line comes from `configureCodeSigning.js:88`, which runs only when every
target already has a team. If you see a team prompt or another team id
instead, the edit did not land.

The durable fix is `"ios": { "appleTeamId": "DQ48D9BF2V" }` in
`apps/mobile/app.json`, as `apps/tv` has. Prebuild then writes the team
itself. It is a change to a fingerprint input, so make it in a PR that ships
a native build, by the owner's decision. It is not part of `feat-604`.

### 2. Build with the hardware UDID

`npx expo run:ios --device` takes the hardware UDID (25 characters, such as
`00008130-` followed by 16 hex digits) or the device name. The CoreDevice id that `devicectl`
uses is a UUID, and `expo run:ios` answers `No device UDID or name matching`
for it (auto memory [claude]). Read both ids from `devicectl`:

```bash
xcrun devicectl list devices                     # CoreDevice id, name, state
xcrun devicectl device info details --device <coredevice-id> \
  --json-output /tmp/details.json >/dev/null
python3 -c "import json; print(json.load(open('/tmp/details.json'))['result']['hardwareProperties']['udid'])"

npx expo run:ios --device <hardware-udid> --no-bundler
```

The local build signed and installed without the phone in EAS's device list.
`eas device:list --apple-team-id DQ48D9BF2V` answered `Could not find devices
on Apple team`, and Xcode's signing still succeeded.

### 3. Stop `expo run:ios` after the install, then launch with devicectl

After `Build Succeeded`, the log printed these three lines and then nothing
more for 14 minutes:

```text
Waiting on http://localhost:8081
› Installing .../Debug-iphoneos/forgewatch.app
- Connecting to: <phone name>
```

The app was already installed. Ask the phone, not the installer:

```bash
xcrun devicectl device info apps --device <coredevice-id> \
  --bundle-id org.jesusfilm.forgewatch
```

When the app is listed, stop the `expo run:ios` process. Then start the
worktree's Metro on a free port and launch the dev client at it. The phone
reaches the Mac by its LAN address, so the `url` holds that address, and the
whole `url` value is percent-encoded:

```bash
pkill -f 'expo run:ios --device <hardware-udid>'
xcrun devicectl device process launch --device <coredevice-id> \
  --terminate-existing \
  --payload-url 'forgemobile://expo-development-client/?url=http%3A%2F%2F<mac-lan-ip>%3A<metro-port>' \
  org.jesusfilm.forgewatch
```

Success prints `Launched application with org.jesusfilm.forgewatch bundle
identifier.` The admin URL is a separate setting: a phone needs the Mac's LAN
address in `apps/mobile/.env.development.local`, as `apps/mobile/CLAUDE.md`
describes, and Metro needs `--clear` after that file changes.

### 4. Unlock the phone before the launch

A locked phone refuses the launch:

```text
Unable to launch org.jesusfilm.forgewatch because the device was not, or could not be, unlocked. (FBSOpenApplicationErrorDomain error 7 (0x07))
BSErrorCodeDescription = Locked
```

Unlock it and run the same command again. Nothing else needs to change.

### 5. Put the TestFlight build back afterwards

The dev client has the same bundle id as the TestFlight build, so the install
replaces it. When the check is done, reinstall the TestFlight build from the
TestFlight app.

## Why This Matters

Each failure here looks like a different problem than it is.
The 2026-10-02 attempt ended with the conclusion that Xcode on this Mac was
not signed in to the Jesus Film team, and the fix was routed to the owner
(auto memory [claude]). The team was in Xcode by 2026-10-06. The build
still needed the explicit team, because `expo run:ios` chose a team from the
certificate list and not from the bundle id. The hang after the install
looks like a stuck install, so a reader waits or retries the build. The lock
error reads as a broken install.

The root cause stays in the tree: `apps/mobile/app.json` names no team, so
every new `ios/` folder and every machine with more than one team meets the
same choice.

## When to Apply

- Any `npx expo run:ios --device` build of `apps/mobile` onto a physical
  iPhone, until `apps/mobile/app.json` sets `ios.appleTeamId`.
- Any `expo run:ios` from an agent or a script: it never prompts, so the
  first development certificate that `security find-identity` lists decides
  the team.
- An interactive run that offers the team prompt: choose Cru Global, Inc,
  then check `git diff apps/mobile/app.json`. Revert the `appleTeamId` line
  unless you mean to make the durable change in step 1.
- A simulator build skips this team choice while the app has no entitlement
  that needs signing on a simulator (`XcodeBuild.js:279`,
  `simulatorBuildRequiresCodeSigning`).

## Examples

The `feat-604` sequence on 2026-10-05 (UTC), from a clean `apps/mobile/ios/`:

```bash
cd apps/mobile
npx expo prebuild --platform ios                 # writes ios/, no team
# step 1: set DEVELOPMENT_TEAM = DQ48D9BF2V in the app target (2 configurations)
npx expo run:ios --device <hardware-udid> --no-bundler
# log: "Auto signing app using team(s): DQ48D9BF2V" ... "Build Succeeded"
# log stops at "- Connecting to: <phone name>"
xcrun devicectl device info apps --device <coredevice-id> --bundle-id org.jesusfilm.forgewatch
# -> Jesus Film Watch 1.0.0 (1) is installed
pkill -f 'expo run:ios --device <hardware-udid>'
xcrun devicectl device process launch --device <coredevice-id> --terminate-existing \
  --payload-url 'forgemobile://expo-development-client/?url=http%3A%2F%2F<mac-lan-ip>%3A<metro-port>' \
  org.jesusfilm.forgewatch
# -> "BSErrorCodeDescription = Locked"; unlock the phone, run it again
# -> "Launched application with org.jesusfilm.forgewatch bundle identifier."
```

## Related

- [Prove the artifact and prove the instrument](./mobile-dev-build-verification-false-signals.md):
  the same law for this toolchain. Its Instance 3 is an installer that
  reports success for an app that is not on the device. Here the installer
  stops reporting while the app is installed. In both cases,
  `devicectl device info apps` is the evidence.
- [Physical Android dev build and local admin](./physical-android-dev-build-local-admin-emulator-alias.md):
  the Android counterpart for a physical phone, and why a phone needs the
  Mac's LAN address.
- [Verifying mobile worktree changes in the iOS simulator](./verifying-mobile-expo-worktree-changes-in-simulator-20260608.md):
  the simulator form of the same dev-client deep link
  (`xcrun simctl openurl`).
- [Smoke a mobile write path through a fake-admin proxy](./mobile-write-path-smoke-via-fake-admin-proxy.md):
  the `feat-604` phone run used this dev build against that proxy.
- [Change the app display name without renaming expo.name](../best-practices/expo-app-display-name-without-renaming-expo-name.md):
  how an `app.json` change moves the fingerprint runtime version.
