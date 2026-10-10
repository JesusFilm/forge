Build the Jesus Film TV app (EAS Android `preview` APK) and install + launch it on both physical Android TV test devices — the Chromecast with Google TV and the Xiaomi Mi Box S — over wireless adb.

Constants: app package `org.jesusfilm.forgetv`, app name "Jesus Film Watch", profile `preview` (points at prod admin `admin.jesusfilm.org`), APK saved to `apps/tv/forgetv.apk`. The two test devices identify by `ro.product.model`: `Chromecast` and `MiTV_*`. A running emulator (`sdk_gphone*`) must always be skipped.

`$ARGUMENTS`: if it contains `no-build`, `skip-build`, or `latest`, SKIP the EAS build (Step 2) and reuse the existing `apps/tv/forgetv.apk`. Any other value — or no argument at all — means build fresh.

## Steps

1. **Connect check — are both TVs reachable?** From `apps/tv`, run `adb devices -l` and confirm both `model:Chromecast` and `model:MiTV_*` show state `device` (ignore any `emulator-*`).

   If a TV is **missing**, it almost always slept or rebooted — Android 14 turns Wireless debugging OFF and randomizes its port on reboot. Do NOT proceed to install on a missing device. Ask the user to, on that TV: **Settings → System → Developer options → Wireless debugging → ON**, then read you the **"IP address & Port"** shown there. Run `adb connect <ip>:<port>`. Only if that returns `unauthorized`/`failed` is the pairing trust gone — then ask for a fresh **"Pair device with pairing code"** (6-digit code + its own ip:port) and run `adb pair <ip>:<pairport> <code>` before reconnecting. Re-run the connect check, then continue. (You never need to re-pair after a normal reboot — pairing trust persists; only a factory reset or cleared `~/.android/adbkey*` loses it.)

2. **Build the preview APK** (skip if `$ARGUMENTS` says so). From `apps/tv`:

   ```bash
   eas build --platform android --profile preview --non-interactive
   ```

   Run this **in the background** (~15 min) and wait for it to finish. If it fails complaining it needs to generate an Android keystore, `--non-interactive` can't answer that prompt — tell the user to run it once themselves interactively (`!eas build -p android --profile preview`), then re-run this command with `latest` to skip straight to install. On success, fetch the direct artifact URL and download it:

   ```bash
   # --limit 1 takes the most recent FINISHED build; if several branches build this
   # app concurrently, fetch by the build id eas printed above instead of by recency.
   URL=$(eas build:list --platform android --profile preview --limit 1 --json --non-interactive \
     | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['artifacts']['applicationArchiveUrl'])")
   [ -n "$URL" ] || { echo "ERROR: could not resolve the APK artifact URL from 'eas build:list' (output shape changed?)"; exit 1; }
   curl -fL -o forgetv.apk "$URL"   # -f fails on an HTTP error instead of saving an error page as the apk
   file forgetv.apk | grep -q 'Zip archive' || { echo "ERROR: downloaded forgetv.apk is not a valid APK"; exit 1; }
   ```

3. **Install + launch on both TVs.** From `apps/tv`, this loop targets only the two TV models, installs (`-r` keeps app data; works while the signing key is stable, which EAS preview guarantees), launches by package (the standalone APK has no `exp+` scheme — launch via the LAUNCHER intent), and confirms the process is alive:

   ```bash
   [ -f forgetv.apk ] || { echo "ERROR: forgetv.apk not found — re-run without 'latest'/'no-build' to build it first"; exit 1; }
   # Feed the loop on FD 3, NOT `adb devices | while read`. The pipe form is broken:
   # `adb shell` reads stdin and swallows the remaining device lines, so the loop
   # runs on only the first device. FD 3 keeps the device list away from adb's stdin.
   # The `3< "$DL"` redirect MUST stay on `done` (not `do`): it scopes FD 3 to the whole
   # compound AND keeps the loop in the current shell so `installed` survives. Moving it breaks silently.
   DL=$(mktemp); adb devices | awk 'NR>1 && $2=="device"{print $1}' > "$DL"
   installed=0
   while read -r s <&3; do
     m=$(adb -s "$s" shell getprop ro.product.model | tr -d '\r')
     case "$m" in
       Chromecast*|MiTV*)
         echo ">> $m ($s): installing"; adb -s "$s" install -r forgetv.apk
         adb -s "$s" shell monkey -p org.jesusfilm.forgetv -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
         echo ">> $m: launched, pid=$(adb -s "$s" shell pidof org.jesusfilm.forgetv | tr -d '\r')"
         installed=$((installed+1)) ;;
       *) echo "-- skip $m ($s)" ;;
     esac
   done 3< "$DL"; rm -f "$DL"
   [ "$installed" -eq 0 ] && echo "WARNING: no TV matched Chromecast*/MiTV* — check 'adb devices -l' models; nothing was installed."
   ```

   (Do not "simplify" this into `for s in $(adb devices ...)` — under zsh, unquoted expansion does not word-split, so the whole list becomes one bogus serial.)

4. **Verify + report.** For each TV confirm: `adb -s <serial> shell pm list packages | grep jesusfilm` prints the package, `pidof` returned a PID (a number = alive; empty = it died — relaunch and check `adb -s <serial> logcat -d *:E | grep -E 'FATAL EXCEPTION|AndroidRuntime'`). Report a short per-device pass/fail table. Optionally grab a screenshot to eyeball with `adb -s <serial> exec-out screencap -p > shot.png` (use `exec-out`, not `shell` — the latter corrupts the PNG).

## Notes

- Every adb command MUST use `-s <serial>` so the emulator (and the other TV) are never hit by accident.
- The `preview` APK is wired to **production** data — fine for stakeholder smoke/e2e, not a local-dev build.
- For a fast code-iteration loop (not test builds) use a one-time `--profile development` dev-client + Metro instead; that's out of scope for this command.
