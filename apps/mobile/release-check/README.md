# Mobile release check runner

This folder holds the release check runner for `apps/mobile`. The plan is
`docs/plans/2026-10-21-1206-feat-mobile-release-check-runner-plan.md`, and the
ticket is `docs/roadmap/platform/feat-775-mobile-release-check-runner.md`.

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
