# Daily Bible Pause Preview Build

This guide delivers the Daily Bible Pause review build to the product lead's
iPhone. The product lead installs the build from a link, outside TestFlight.
Later JavaScript and asset changes reach that build as EAS Updates on its own
channel. The branch `Ur-imazing/pause-devo-feature` never merges to `main`.

The operator is the mobile owner. Run every operator command from
`apps/mobile` unless the step says otherwise.

## The parts

| Part                    | What it does                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pause-preview` profile | The build profile in `apps/mobile/eas.json`. It extends `base`, uses internal distribution and the `preview` EAS environment, and puts the build on the `pause-preview` channel. |
| `pause-preview` channel | The update channel. No other build uses it, so an update on it reaches only this build.                                                                                          |
| `build:pause`           | `scripts/build-pause.sh`. It stops on an unclean git tree, then runs `EAS_NO_VCS=1 eas build --platform ios --profile pause-preview`.                                            |
| `update:pause`          | `scripts/publish-pause-update.sh`. It compares the runtime versions, then publishes an iOS update to the `pause-preview` channel.                                                |
| `.easignore` (root)     | The upload rules for `build:pause`. It lets the two git-ignored devotional videos into the upload.                                                                               |
| Devotional videos       | `apps/mobile/assets/devotionals/pharisee.mp4` and `lamp.mp4`. `scripts/encode-devotionals.sh` makes them. They are not in git.                                                   |

The build has the same bundle identifier as Watch, `org.jesusfilm.forgewatch`.
So the preview build and the TestFlight build replace each other on the phone.

## 1. Register the product lead's iPhone

Do this section before the first build. The ad hoc provisioning profile holds
only the devices that EAS knows when the build runs. A device that you add
later needs a new build.

1. Operator: run `eas device:create` and choose the website option.
2. Operator: send the link or the QR code to the product lead.
3. Product lead: open the link on the iPhone in Safari, and allow the profile
   download.
4. Product lead: open Settings, tap "Profile Downloaded", and tap Install.
5. Operator: run `eas device:list` and make sure that the iPhone is in the
   list.

## 2. Turn off TestFlight automatic updates for Watch

The product lead does this section before the first install.

1. Open the TestFlight app.
2. Tap Jesus Film Watch.
3. Turn off Automatic Updates.

During the review, do not tap Install or Update for Watch in TestFlight. A
TestFlight install replaces the preview build, because both builds use the same
bundle identifier.

## 3. Check the upload before each build

`build:pause` uploads the working tree through the root `.easignore`. When
`.easignore` exists, eas-cli reads no `.gitignore` file. So a missing rule can
upload a file that git ignores. Inspect the upload before every build:

```bash
EAS_NO_VCS=1 eas build:inspect -p ios -e pause-preview --stage archive \
  -o "$TMPDIR/pause-preview-archive" --force
```

`-o` is required. Keep the output folder outside the repository, or the next
upload will contain it. Then run these checks:

```bash
A="$TMPDIR/pause-preview-archive"
ls -l "$A/apps/mobile/assets/devotionals/pharisee.mp4" \
  "$A/apps/mobile/assets/devotionals/lamp.mp4"
find "$A" -name '.env*' ! -name '.env.example' ! -name '.env.ci'
find "$A" -name node_modules -prune -print
ls -d "$A/apps/mobile/ios" "$A/apps/mobile/android"
```

The upload is correct only when all of these are true:

- The `ls -l` command shows both videos, at about 100 MB in total.
- The first `find` command prints nothing. Expo inlines `EXPO_PUBLIC_*` values
  from a `.env` file into the bundle, so a local `.env.local` must never reach
  the build. The tracked `.env.example` and `.env.ci` files are allowed.
- The second `find` command prints nothing. eas-cli always leaves
  out `node_modules`, so a hit means that the archive is wrong.
- The last `ls -d` command reports "No such file or directory" for both
  folders.

The native folders must stay out for this reason. With `EAS_NO_VCS=1`, eas-cli
uses the `.easignore` rules to decide whether `apps/mobile` is a managed
project. A local `apps/mobile/ios` folder comes from `expo prebuild` or
`expo run:ios`. If that folder is in the upload, EAS builds it as it is and
does not run prebuild. The build's runtime version then includes the native
folder. `update:pause` measures with git, which ignores the folder, so every
update stops with a runtime mismatch.

## 4. Build

1. Commit all changes. `build:pause` stops on any modified or untracked file,
   because the upload is the working tree.
2. Make sure that the two videos are in `apps/mobile/assets/devotionals/`.
3. Do the upload check in section 3.
4. Run `pnpm --filter @forge/mobile build:pause`.

The first build is interactive. Do not add `--non-interactive`. eas-cli asks
you to log in to the Apple developer account, to select the devices for the ad
hoc profile, and to set up the widget extension and its App Group. Select the
product lead's iPhone.

EAS records no git commit for a `pause-preview` build, because `EAS_NO_VCS=1`
turns off the git client. Write down the commit that you built.

## 5. Install the build

When the build finishes, eas-cli prints an install link and a QR code. The
build page on expo.dev also shows an install QR code.

1. Operator: send the QR code or the link to the product lead.
2. Product lead: scan the QR code with the iPhone camera, open the link in
   Safari, and tap Install.
3. Product lead: turn on Developer Mode. Open Settings, then Privacy &
   Security, then Developer Mode, and turn it on. Tap Restart. After the
   restart, tap Turn On and enter the passcode.
4. Product lead: open Jesus Film Watch.

iOS 16 and later runs an internal-distribution build only with Developer Mode
on. If the Developer Mode item is not in Settings, try to open the app once. iOS
then shows the item. Developer Mode stays on after the first time.

## 6. Publish an update

Use an update for JavaScript and asset changes only.

1. Commit all changes. `eas update` stops on an unclean tree
   (`requireCommit`). Do not answer yes to its "Commit changes to git?" prompt,
   because it runs `git add -A` across the whole repository.
2. Make sure that the two videos are in `apps/mobile/assets/devotionals/`. The
   update bundles them, and the export fails without them.
3. Run `pnpm --filter @forge/mobile update:pause`.
4. Tell the product lead that an update is ready. Send the steps in section 7.

`update:pause` stops and publishes nothing in these cases:

- EAS has no finished `pause-preview` iOS build. Do sections 3 to 5 first.
- The local iOS runtime version is not the same as the runtime version of the
  last finished `pause-preview` build. The script prints both values.

The app uses the fingerprint runtime policy. An update reaches only a build with
the same runtime version, and `eas update` reports success even when no build
has it. That is why the script compares the two values first.

## 7. Take an update (product lead)

The app looks for an update only when it starts from closed. It downloads the
update during that start, and it runs the update at the next start from closed.

1. Connect the iPhone to Wi-Fi.
2. Swipe Jesus Film Watch away in the app switcher.
3. Open Jesus Film Watch. The old version still shows. Leave the app open so
   that the download can finish.
4. Swipe the app away again.
5. Open the app again. The new version now runs.

A return to the app from the background does not look for an update. Only a
start from closed does.

The first update downloads the two videos again, about 100 MB. For the first
update, keep the iPhone on Wi-Fi and leave the app open for a few minutes in
step 3 above.

## 8. Rebuild after a native change

A native change moves the runtime version. A native change is a change to a
native module, a config plugin, `app.json`, or `eas.json`. After such a change,
`update:pause` stops with a runtime mismatch, and only a new build can carry the
change.

1. If you changed no native code, run `pnpm install` from the repository root
   and run `update:pause` again. A stale local `node_modules` also moves the
   local runtime version.
2. If you changed native code, do sections 3 to 5 again. The product lead
   installs the new build over the old build.
3. Publish later changes with `update:pause` as before.

An update for the old runtime version does not reach the new build, and an
update for the new runtime version does not reach the old build.

To see the two values by hand, use these commands:

```bash
eas fingerprint:generate --platform ios --environment preview --json
eas build:list --platform ios --build-profile pause-preview --status finished \
  --limit 1 --json --non-interactive
```

Compare `hash` from the first command with `runtimeVersion` from the second.
Do not use `npx expo-updates fingerprint:generate` or
`npx expo-updates runtimeversion:resolve` for this. The pnpm `.bin` shim sets
`NODE_PATH`, so `react-dom` resolves from the workspace and the config gets a
`web` platform. That gives a different hash from the one that `eas build` and
`eas update` use.

## 9. Production iOS builds during the review

Until the review ends, run every production iOS build with
`EXPO_NO_CAPABILITY_SYNC=1`:

```bash
EXPO_NO_CAPABILITY_SYNC=1 eas build --platform ios --profile production
```

The widget adds the App Groups capability to the `org.jesusfilm.forgewatch` App
ID. When the first `pause-preview` build turns on App Groups, Apple invalidates
the existing profiles for that App ID, the App Store profile included. EAS makes
a new App Store profile at the next production build. A production build from
`main` has no App Group. With capability sync on, an Apple-authenticated
production build would turn App Groups off again. The widget needs that
capability.

## 10. After the review

The product lead does these steps:

1. Open TestFlight and install Jesus Film Watch. The TestFlight build replaces
   the preview build.
2. Turn on Automatic Updates for Watch again.
