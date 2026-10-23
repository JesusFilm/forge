# Mobile release check runner

This folder holds the release check runner for `apps/mobile`. Before a
TestFlight build or an over-the-air update goes out, a person runs one command
on their own Mac. The runner builds the app from the current commit, runs fixed
Maestro journeys on five runner-owned test devices behind a local read-only
server, and writes one local report. The plan is
`docs/plans/2026-10-21-1206-feat-mobile-release-check-runner-plan.md`, and the
ticket is `docs/roadmap/platform/feat-787-mobile-release-check-runner.md`.

The runner gives no release decision. The mobile owner reads the report,
decides the release, and tells the QA engineers.

## Before the first run

You need an Apple silicon Mac with these tools:

- **Xcode** with the iOS 26.5 simulator runtime.
- **The Android SDK** at `$ANDROID_HOME` or `~/Library/Android/sdk`, with
  `cmdline-tools/latest`.
- **Java 17** (`/usr/libexec/java_home -v 17` must answer).
- **Maestro 2.11.0.** Install it with
  `curl -fsSL "https://get.maestro.mobile.dev" | MAESTRO_VERSION=2.11.0 bash`,
  or set `MAESTRO_BIN` to a 2.11.0 binary when another version must stay on
  `PATH`.
- **Node 24** and the repo's packages (`pnpm install` at the repo root).

Then run these two commands from the repo root:

1. `node apps/mobile/release-check/cli.mjs setup --check` lists each missing
   item with the one command that fixes it. It changes nothing.
2. `node apps/mobile/release-check/cli.mjs setup` downloads the Android
   `system-images;android-35;google_apis;arm64-v8a` image (about 1.7 GB) and
   creates the five test devices.

The five test devices belong to the runner. Their names start with `Forge RC`
(simulators) or `forge_rc_` (emulators):

| Device id           | Device                     | Lane, host port       |
| ------------------- | -------------------------- | --------------------- |
| `iphone-se`         | iPhone SE (3rd generation) | iOS, 38211            |
| `iphone-17-pro-max` | iPhone 17 Pro Max          | iOS, 38211            |
| `ipad-pro-13`       | iPad Pro 13-inch (M5)      | iOS, 38211            |
| `android-phone`     | Pixel 7 profile            | Android phone, 38212  |
| `android-tablet`    | Pixel Tablet profile       | Android tablet, 38213 |

The runner never uses, stops, or erases any other simulator or emulator on the
Mac, and it never restarts the adb server or CoreSimulatorService.

## Run a release check

The easy way is the repo Claude command `/release-check`. It shows the consent
text, asks for a yes, starts the run, waits for the report, and summarizes it.
Without Claude, use the same steps from the repo root:

1. `node apps/mobile/release-check/cli.mjs plan` shows the commit, any
   uncommitted build inputs, the devices, the other devices that run, the setup
   downloads, disk, memory and load, the lock, a check that production admin
   answers, the estimate, and the exact run command. It changes nothing. When
   it lists a refusal, fix that first. `plan --json` gives the same facts as
   JSON, and its `text` field holds the text that `plan` prints, from the same
   reading.
2. Run the exact command that `plan` shows, for example
   `node apps/mobile/release-check/cli.mjs run --yes --expect-commit <sha> --detach`.
   With `--detach` it returns at once and prints the run folder.
3. `node apps/mobile/release-check/cli.mjs status` shows the phase and, when
   the run ends, the paths of `report.html` and `summary.md`.
4. To stop a run, use `node apps/mobile/release-check/cli.mjs stop`. The run
   then ends the same way as every other run: it stops its server and its own
   devices, and it writes the report.

A full release check takes about 2.5 to 3 hours, because only one iOS
simulator runs at a time. A partial check uses `--journey <ids>`,
`--device <ids>`, `--platform <ios|android>`, `--skip-speed-pass`, or
`--reuse-build`; its report says that it is not a release result.

The runner needs a lot of memory and CPU. It starts a device only when free
memory and the load average allow it, and `plan` refuses when the Mac cannot
run one simulator and one emulator. `plan` shows the load with those two
devices added, and the limit. `run` makes the same check when it starts, with
a new reading. When other work keeps the load high, finish that work first.
When your shell runs commands in a sandbox, run the runner outside it: it boots
devices, binds local ports, and writes under
`~/Library/Caches/forge-release-check`.

## What a run does

1. **Consent and lock.** `run` refuses before any side effect, with exit code
   2 and no report, when the build inputs have uncommitted changes, `HEAD` is
   not the commit you agreed to, another run holds the lock, a tool is missing,
   the Mac has too little memory or disk, production admin does not answer, or
   the selection matches nothing.
2. **Hold the ports.** It binds ports 38211, 38212, and 38213 on `127.0.0.1`
   and `::1` for its read-only server, and holds them through the builds.
3. **Build.** It builds one release app for each platform in its own git
   worktree under the runner home, reset to the tested commit. Your `ios/`,
   `android/`, and env files never change. The test build takes its settings
   from `config/test-settings.json`: production's values that are not secret,
   the read-only server's address, recommendations off, and no analytics keys.
   Firebase Analytics is turned off for good in the native settings.
4. **Check the build.** It reads each built app and stops the run when it finds
   a Datadog token, a listed Mux Data key, the production update channel, or a
   missing Firebase off setting, or when the server address is missing.
5. **Probe and journeys.** The settings probe runs first on each device, and a
   failed probe stops the run. Then each journey runs on every device of each
   platform that shows its screens, from cleared app data. A failed journey
   runs once more, unless it matches a Known-Bug entry.
6. **Speed pass.** It measures cold launch, time to Home content, time to the
   first video frame, and peak memory, on fresh installs, one device at a time.
   These numbers are information only.
7. **Log check.** It reads the read-only server's log with its own code and
   fails the run when a device sent no traffic, or when a write, a search, or a
   field off the read-only list reached production.
8. **End.** It stops its server and its own devices, and writes `summary.json`,
   `report.html`, and `summary.md`. After an early stop, it runs the log check
   before it stops the devices. Only a device that started a journey must show
   traffic.

### How production stays safe

The app in a test build sends every admin request to the local read-only
server. The server forwards to production, with no credential, only a query
whose root fields are all on the read-only list in `config/operations.json`.
It answers searches from `config/search-answers.json`, answers the feedback
form with a success reply, and blocks every other request. A repeated read gets
the first answer again, and the server keeps each field under admin's limit of
60 field nodes a minute.

Each `forwarded` and `upstream-error` line in `server-log.jsonl` has `heldMs`,
the part of `ms` before the request went to production. With no hold, it is
only the time to read and check the request, less than 1 s. The reason
`timeout after <N> ms` means that admin did not answer within N ms.

Some reads do not go through the server: the signed-out auth session read at
`auth.jesusfilm.org`, Bible text from `bible.helloao.org`, and images and video
from Mux. A journey never taps a control that opens an external web page.

## Read the report

The report opens with the run summary: the commit, the result, the counts for
each label, the build check, the log check, the settings probe, the screen
list gaps, each admin rate-limit refusal with the failure it caused, and the
Not-Tested List. Then it lists each journey on each device in this order:

| Label     | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| `new`     | The journey failed on both tries, and no Known-Bug entry matches. |
| `flaky`   | It passed only on its second try, or only after a device restart. |
| `known`   | It failed at the step and check that a Known-Bug entry names.     |
| `not_run` | It did not run, for example after a device stopped answering.     |
| `pass`    | It passed on its first try.                                       |

Every failure fails the run: a new failure, a flaky journey, a known bug, a
screen list gap, a failed check, and an early stop. Only `scope: "release"`
with `result: "pass"` in `summary.json` is a passing release check.

Each failure shows its class (for example `assertion_failed`,
`selector_not_found`, `app_crashed`, `rate_limited`, `upstream_error`, or
`missing_search_answer`), a screenshot, the step times, and the steps that did
not run. A failure gets `upstream_error` in place of `assertion_failed` or
`selector_not_found` when production admin gave no usable answer to a read from
that device during the attempt. When the same attempt also has a rate-limit
refusal, the class is `rate_limited`. The summary also proposes list changes: a
Known-Bug entry for each new failure, the removal of each Known-Bug entry whose
journey now passes, a search answer to record, and a journey to write for each
screen gap. The runner never applies them; a person reviews them and commits
the change.

To share a report, zip its run folder (every link in it is relative) or paste
`summary.md`.

## The lists

| File                         | What it holds                                                                    | How it changes                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `config/test-settings.json`  | Each `EXPO_PUBLIC_*` key in one class: copied from production, test value, unset | The mobile owner runs `check-settings` (needs an Expo login) and commits production's values            |
| `config/operations.json`     | Each GraphQL root field the app sends: read-only, saved answer, success, blocked | A jest guard fails on a new root field until it has a class                                             |
| `config/search-answers.json` | The saved answers for every search that the search journeys send                 | The mobile owner runs `record-search` against local admin and commits the file                          |
| `config/known-bugs.json`     | Known failures: journey, devices, step label, failure class, and ticket          | The mobile owner adds an entry from a proposed one, with a ticket, and removes it when the bug is fixed |
| `config/not-tested.json`     | Screens and steps that the journeys leave out on purpose, with a reason          | Add an entry with platforms and a reason when a journey cannot cover something                          |
| `config/screens.json`        | Alerts and native sheets that have no test ID, and the rules that hide a screen  | Add an entry when a new alert or native sheet appears                                                   |
| `config/devices.json`        | The five devices, their pins, and the memory and load limits                     | Change it only with the mobile owner                                                                    |

`node apps/mobile/release-check/cli.mjs check-lists` checks all of them, and
`check-screens` fails when a screen or sheet that a platform shows has no
journey and no Not-Tested entry.

## Write or repair a journey

Journeys are YAML files in `journeys/`, one file for each journey. Write or
repair one only through the authoring session, never with `maestro` itself:

1. `node apps/mobile/release-check/cli.mjs session up --device iphone-se`
   boots one runner device, installs the test build of the current commit, and
   starts the read-only server.
2. `node apps/mobile/release-check/cli.mjs session try <journey>` runs the
   journey there and prints each step, and the screenshot of a failure.
3. `node apps/mobile/release-check/cli.mjs session down` runs the log check and
   stops the device and the server.

Each journey follows these rules, and `check-lists` checks most of them:

- Give every step a `label`. A Known-Bug entry matches the label, not the step
  number.
- `launchApp` always has `permissions: { notifications: deny }` and never
  `clearState`. The runner clears the app before each journey.
- `openLink` takes only `forgemobile://` links. On iOS 26, follow it with an
  optional `tapOn: "Open"`.
- Assert each screen you cover by its root test ID `screen-<screen id>`, in a
  step that does not depend on a condition.
- Never tap a control that opens a web page. Check that it shows, and add a
  Not-Tested step entry.
- Check the structure, not which video shows, because Home changes by date.
  When a journey needs specific content, name it.
- A journey that types a search carries the Maestro tag `search`, so
  `record-search` saves its searches.
- On iOS, a test ID on a plain view inside a React Native `Modal` is not
  visible to Maestro; put it on a button, such as the sheet's backdrop.

A new screen needs a root `testID="screen-<screen id>"` (a guard checks it) and
a journey or a Not-Tested entry.

## Modes

| Mode                                                       | What it does                                                   | Side effects      |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ----------------- |
| `plan [--json]`                                            | The consent text and every refusal                             | None              |
| `setup [--check]`                                          | Check the tools; create the devices                            | Not with --check  |
| `run`                                                      | A release check, or a partial check                            | Yes               |
| `status [--json]` / `stop` / `recover`                     | Read the newest run; stop it; clean up after a killed runner   | `stop`, `recover` |
| `check-lists`, `check-screens`, `check-build`, `check-log` | Fast checks with no device                                     | None              |
| `check-settings`                                           | Compare the copied settings with production (needs Expo login) | None              |
| `record-search [--admin-url <url>]`                        | Record the saved search answers from a local admin             | Yes               |
| `session up\|try\|down`                                    | One-device authoring                                           | Yes               |

Exit codes: 0 means that the selected scope passed, 1 means that a run started
and failed, and 2 means a refusal before any side effect.

## Files on the Mac

The runner home is `~/Library/Caches/forge-release-check`, or
`FORGE_RELEASE_CHECK_HOME` when it is set:

- `runs/<run id>/`: one folder for each run, with the report. The newest 5
  stay, and `latest.json` names the newest.
- `builds/<commit>/`: the test builds. The newest 2 stay.
- `worktrees/`: the runner's own git worktree for the builds.
- `cache/`: the iOS build cache (about 3 GB), so a later build is faster.
- `sessions/` and `records/`: the authoring sessions and the search records.
- `lock.json`: the lock while a run, a session, a record, or setup is active.
  `status` shows a stale lock, and `recover` cleans up after a runner that was
  killed. A run refuses while a stale lock of a run or a session remains: run
  `recover` after a run, or `session down` after a session.

## Verified facts

A device spike on the mobile owner's Mac checked the facts that the build, the
device layer, and the journey runner depend on.

- **Date:** 2026-10-22.
- **Commit:** `2bcf98e19`.
- **Mac:** Apple silicon, 12 cores, 48 GB, macOS 26.5.
- **Tools:** Xcode 26.5 (17F42), Maestro 2.11.0, Amazon Corretto 17.0.13,
  Node 24.14.1.
- **iOS device:** an iPhone 17 Pro Max simulator on iOS 26.5.
- **Android devices:** a Pixel 7 AVD and a Pixel Tablet AVD on the
  `android-35` `google_apis_playstore` arm64 image, with 4096 MB each. The
  runner pins the `google_apis` image instead (KTD15).

The spike code stayed outside the repo.

| Step                           | Result         | Summary                                                                                                                     |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1. Marker URL in the bundle    | Pass           | A byte search finds a unique URL in both Hermes bundles. The string table has no separators.                                |
| 2. Maestro flow and step label | Pass, see note | Labels are in `commands.json` only. On Android, the runner must deny notifications itself.                                  |
| 3. `adb reverse` to two ports  | Pass           | Each emulator's requests arrive on its own host port.                                                                       |
| 4. Auth call and downloads     | Recorded       | A signed-out cold launch reads the auth session. A signed simulator build finishes a background download.                   |
| 5. Field nodes per minute      | Recorded       | One cold launch sends 57 `video` field nodes, close to admin's limit of 60. The rate-limit answer has no `extensions` data. |

### 1. A unique marker URL is in the Hermes bundle

- Both release builds bake `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` into a Hermes
  bytecode bundle, version 98. These files are `main.jsbundle` in the `.app`
  and `assets/index.android.bundle` in the APK.
- A byte search (`grep -a -o`) found the marker URL exactly once in each
  bundle. It also found a marker auth URL once in each bundle.
- No text of the shape `pub` plus 32 hex characters (a Datadog client token)
  is in either bundle.
- `https://admin.jesusfilm.org/api/graphql` is not one string in the bundle,
  because `adminEndpoint.ts` builds it from a template. Thus the build check
  must not look for it.
- Hermes keeps all its strings in one storage block with no separators, so
  `strings` prints long joined lines. `hermesc` dumps bytecode only from
  JavaScript source.
- So the Mux Data key check hashes every window of the key's length inside
  each run of `[a-z0-9]` characters. That set includes every string-table
  entry of that shape, and the check needs no bytecode parser. The test
  settings list must store the length of each key with its digest.
- The generated `app.config.js` worked on both platforms:
  - iOS `Info.plist` has `FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED` true.
  - iOS `Expo.plist` has `EXUpdatesEnabled` false and no
    `EXUpdatesRequestHeaders`.
  - The merged Android manifest (`aapt2 dump xmltree` on the APK) has
    `usesCleartextTraffic` true and `expo.modules.updates.ENABLED` false.
  - The merged manifest has `firebase_analytics_collection_deactivated` true.
    The `tools:replace` attribute merged with no error.
- A warm iOS release build took 2 minutes 44 seconds. A cold Android
  `assembleRelease` took 10 minutes 42 seconds. The two builds ran at the same
  time.

### 2. Maestro runs the release builds, and step labels are in `commands.json`

- **iOS passes.** `launchApp` with `clearState: true` and
  `permissions: { notifications: deny }`, then a wait for the `home-logo`
  `testID`, passed in 8 seconds.
- **The hidden flag works.** `--driver-host-port` is not in
  `maestro test --help` for 2.11.0, but Maestro accepts it.
- **One iOS process and two Android processes can run at the same time.** All
  three flows passed.
- **Labels are not in JUnit.**
  - A passing JUnit test case has no step detail.
  - A failing one has only the assertion text, for example
    `Assertion is false: id: screen-does-not-exist is visible`.
- **`commands.json` has the step data.** The file is
  `<debug-output>/<flow name>/commands.json`. It has one entry for each
  command, with `command.<type>.label`, `metadata.status` (`COMPLETED`,
  `FAILED`, or `WARNED`), `metadata.timestamp`, `metadata.duration`, and
  `metadata.error.message`.
- **A failed step writes two files:** `screenshots/step-NNN-<command>-<selector>.png`
  and `screen-hierarchy/step-NNN-....json`.
- **Use `--debug-output`.** With `--flatten-debug-output`, Maestro writes
  everything into the `--debug-output` folder, and `--test-output-dir` stays
  empty. The journey runner reads results from `commands.json`.
- **Android does not pass with Maestro's denial alone.** On Android 15 (API
  35), `permissions: { notifications: deny }` does not stop the app's own
  `POST_NOTIFICATIONS` request. The system dialog covers Home, and the
  assertion fails after 60 seconds on both emulators.
- **The runner denies notifications on Android itself.** These four `adb`
  commands, then a `launchApp` without `clearState`, show no dialog. The flow
  passed in 3 seconds, and the flags stayed set.
  1. `pm clear <package>`
  2. `pm revoke <package> android.permission.POST_NOTIFICATIONS`
  3. `pm set-permission-flags <package> android.permission.POST_NOTIFICATIONS user-set user-fixed`
  4. `launchApp` without `clearState`
- **`clearState: true` removes the flags.** `launchApp` with
  `clearState: true` removes `USER_FIXED`, and the dialog comes back. So the
  runner clears the app state and fixes the denial before each Android
  journey, and a journey never sets `clearState`.
- **Some buttons need a `testID`.** Maestro cannot find the text "Download" in
  the download sheet's button, because the button merges its label. Journeys
  need a `testID` on such controls.
- **Leave the iOS 26 search tab by its Home button.** Opening the search tab
  replaces the tab bar with a Home button and a search field. The tab labels
  (Home, Explore, Search, Bible, My Watch) are tappable by text from the other
  tabs.

### 3. `adb reverse` maps one device port to two host ports

- Two mappings were active at the same time:
  - `adb -s emulator-5580 reverse tcp:38211 tcp:38212`
  - `adb -s emulator-5582 reverse tcp:38211 tcp:38213`
- Every request from the phone emulator arrived on host port 38212, and every
  request from the tablet emulator arrived on 38213. This held both for test
  requests and for the app's own traffic. Both use IPv4.
- iOS simulator traffic arrives on `::1` port 38211. That matches the IPv6
  `localhost` note in
  `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`.
- A device client that closes its send side at once can lose its request
  through `adb reverse`. A client that keeps the socket open does not.
- macOS has no GNU `timeout` command, so the runner must not call it.

### 4. A signed-out cold launch reads the auth session, and downloads work

- **Auth:** a signed-out cold launch calls `GET <auth base>/get-session` 3 to
  4 times on both platforms, before the first admin request.
  - With `EXPO_PUBLIC_AUTH_BASE_URL` unset, as in production, a test build
    sends these reads to `https://auth.jesusfilm.org`.
  - The reads carry no credential.
  - The read-only server cannot see them (R18).
  - In the spike, the auth base pointed at the spike server, which answered
    404, and Home still loaded.
- **Downloads:** an ad-hoc signed Release simulator build (`Signature=adhoc`)
  finished a background download.
  - The 158 MB "Highest" file of `the-birth-of-jesus` passed through
    `nsurlsessiond`.
  - It arrived in `Documents/offline-downloads/the-birth-of-jesus/` in about 48
    seconds.
  - The watch page then showed the downloaded mark.
  - The failure on 2026-10-15 was most likely caused by the unsigned build.
    So the iOS download steps stay in the journeys.
- **No writes:** opening and playing a whole video while signed out, with
  recommendations off, sent no write to admin.

### 5. Field nodes per root field per minute

One iOS simulator ran a tour of about 4 minutes. The tour covered a cold
launch, Home scrolls, the hero video, Discover, a typed search, five Explore
swipes, a Bible chapter swipe, and My Watch. These are the peak field nodes in
any 60-second window:

| Root field               | Peak in 60 s | Source                                                    |
| ------------------------ | ------------ | --------------------------------------------------------- |
| `video`                  | 57           | `VideoThumbnails`, 27 and 30 aliases, at cold launch only |
| `experienceBySlug`       | 10           | `GetExperienceBySlug`, 2 aliases each                     |
| `watchSearch` (blocked)  | 8            | The Discover topic searches and the typed search          |
| `videoBySlug`            | 7            | `GetVideoBySlug`, `GetVideoText`                          |
| `watchSetting`           | 4            | `GetWatchSetting`, 2 aliases each                         |
| `watchHomeVideos`        | 3            | `GetWatchHomeVideos`, `ExploreClipCandidates`             |
| `watchLanguageInventory` | 1            | `ExploreInventory`                                        |

- One cold launch uses 57 of admin's 60 `video` field nodes per minute for one
  address. A second cold launch within the same minute got an error on each
  `VideoThumbnails` answer.
- Every device sends the same `VideoThumbnails` documents and variables in one
  locale, so answer reuse (R35) and the per-field pacing (KTD8) keep a run
  under the limit.
- **Admin's rate-limit answer has no `extensions` data.** It is HTTP 200 with
  the header `retry-after: 1m` and this body:
  `{"errors":[{"message":"You are trying to access 'video' too often","locations":[...],"path":[]}],"data":null}`.
  Yoga turns `extensions.http` into the response headers, so
  `extensions.http.statusCode: 429` does not reach the client.
- **The server detects a refusal by two signals:** the `Retry-After` header and
  the message pattern `You are trying to access '<field>' too often`.
- **An oversized request fails whole.** A request with more than 60 nodes of
  one field gets no data.

### What the runner must do because of these facts

- **Build check (U4):** search the bundle bytes for unique values. Hash
  windows for the Mux Data key, and store each key's length with its digest.
  Read the merged manifest with `aapt2` from the SDK build tools.
- **Device layer (U5):** give every `simctl` call a time limit.
  - A booted spike simulator had a `simctl listapps` call that hung for 20
    hours, and every later `install` on it hung too.
  - `simctl shutdown` released the device in a few seconds.
  - A time limit counts as `device_unresponsive`.
- **Journey runner (U7):**
  - Read step labels, status, times, and errors from `commands.json`.
  - Before each Android journey, run `pm clear` and fix the notification
    denial with `adb`.
  - `check-lists` rejects `clearState` in a journey file.
- **Read-only server (U3):** detect a rate-limit refusal by the `Retry-After`
  header and the message pattern, not by `extensions`.
