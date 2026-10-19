# TV system Home rotation: implementation and validation

Historical branch: `codex/tv-system-home-five-concepts`. The donor used `feat-603`; the October 8 integration is tracked as `feat-630` to avoid main's existing mobile-feedback ID. It remains in progress until runtime and release gates complete.

## Implemented

- Apple Top Shelf supports spotlight, real Continue Watching, collections, short videos and topic journeys through native carousel/sectioned interfaces.
- The anonymous recommendation API is the primary discovery source, preserving returned order. Only public media metadata reaches the bounded App Group snapshot; capabilities and identity tokens remain in-app SecureStore/memory.
- Stable persisted daily shuffle visits eligible modes before repeating; provider reads the saved choice without randomizing during OS callbacks. Unsupported modes are omitted. Resume uses existing local history and resolves current position inside Watch.
- Personalization reset/withdraw clears shared snapshots and fences stale deliveries. Audio changes remove prior-language snapshots before attempting the new context.
- App and extension entitlements, EAS extension metadata and snapshot bridge survive managed prebuild. Existing player layouts are unchanged.
- Topic cards use actual published Home collections because the proposed standalone hope/forgiveness/who-is-jesus Experience slugs returned null. `/top-shelf-topic/[id]` opens the current collection using existing Home cards/focus styles.
- Android Engage SDK 1.1.0 uses a private foreground publishing service. Four discovery themes use recommendations, with a stable daily shuffle; real Continue Watching remains separate and requires the local adult-sharing choice.
- Production Google discovery stays blocked until approved Google access and account identity are available. Verification and production manifests remain separate; no installation UUID is presented as a production account.

## Completed checks

- October 5: 152 TV suites / 2,047 tests passed, including source selection, privacy fencing, native-intent recovery, preferred-dub autoplay timing, Google film metadata and repeated external playback links.
- TypeScript and whole-TV lint passed.
- Apple extension Swift typecheck and standalone signed Release simulator build passed.
- Full signed Debug Apple TV app build passed with the embedded extension and native bridge. Latest build log: `/Users/up/Library/Developer/XcodeBuildMCP/workspaces/forge-dev-container-fdf8d06a3dc8/logs/build_sim_2026-10-02T04-55-05-470Z_pid97062_6a6ef283.log`.
- Installed the build on the isolated `Watch Recommendations QA 4K` simulator. This branch serves Metro on port 8098. Recommendations worktree remains preserved; its warm DerivedData was reused to avoid allocating another full native build cache.
- Actual App Group writes confirmed: collection mode with six recommendations on October 2, and spotlight mode with three English recommendations on October 5. System Home displayed and focused Chosen Witness during October 2 QA; selecting it from a closed development build exposed the cold-link bug.
- October 5: warm More Info and Play passed for Chosen Witness. Cold More Info now opens Chosen Witness after development-server selection. Cold Play enters Native A and resumes saved progress; Back returns to Home. The native-intent hook recovers the pending URL from React Native launch options when Expo Linking supplies only a root URL.
- Cold autoplay waits for the preferred playable dub to become active. The initial session render may temporarily use another dub; this is no longer treated as permanent unavailability.
- October 5: managed iOS prebuild and signed Debug build/install/run passed with the topic-link marker fix. Build log: `/Users/up/Library/Developer/XcodeBuildMCP/workspaces/forge-dev-container-fdf8d06a3dc8/logs/build_run_sim_2026-10-05T01-23-07-126Z_pid91506_33c9b44f.log`.
- Android managed prebuild and `./gradlew :google-tv-home:compileDebugKotlin` passed. Global Gradle 9.7 was incompatible with the project's Kotlin; use its generated Gradle 8.14.3 wrapper. Native compile log: `/tmp/watch-home-rotation-android-wrapper.log`.
- October 5: Android `:app:assembleDebug` passed with ARM32 and ARM64 React Native binaries. Installed a separate `org.jesusfilm.tv.homesdkqa` / Watch Home QA Debug copy on the USB-connected Android 14 Chromecast. The installed Play beta (`org.jesusfilm.tv`, version code 10) and its data were preserved; a Debug update would fail because the certificates differ.
- Chromecast remote navigation Home → Settings → Google TV Home passed. The native SDK returned verification-service availability. A discovery recommendation and separate real-progress Continue Watching entity were accepted, and Google's verifier reported zero entity and cluster errors. Clicking the JESUS recommendation entered playback.
- The first verifier publication exposed missing genre and availability even though the SDK task succeeded. Added the existing broad catalogue category `Faith & Scripture` and free-playback availability; rebuilt, installed and verified zero metadata errors. Do not infer validation success from `publishRecommendationClusters` task success alone.
- Continue Watching exposed the real saved JESUS position of 91 seconds. Selecting it opened Native Android playback at 1:40 after loading/interaction, consistent with resuming 1:31 rather than starting over. English North American Indigenous → English retained the paused 4:18 playhead, English subtitles rendered, and both separate language menus accepted typed search. Explore opened and remote Back returned through the player to the prior Settings page without a black screen.
- Feedback's native player entry point opened and returned focus to Play/Pause. Verified feedback remained unavailable in this separately signed/package-named QA copy; the server requires the approved Play package/certificate. No verification policy was weakened and no Linear report was sent. The exact server response was not captured, so this is not proof that the approved Play build's submission succeeds.
- Revocation passed: Turn off and remove cleared the continuation, Remove preview cleared discovery, and the verifier reported `No clusters published`. QA sharing was restored to off; existing beta history and settings were not changed.
- Screenshots are saved outside source in `/Users/up/Downloads/Watch TV QA 2026-10-05/`; no live QR capability or Google account profile capture is included.
- Bundled ARM32/ARM64 Android Release QA built and installed with the same isolated package, local Debug signing certificate and verification-only Engage environment. It is not a Play-uploadable release. Normal Home launch worked without Metro; cold JESUS autoplay resumed the exact saved 4:18 position with preferred English audio. Build log: `/tmp/watch-home-release-qa-20261005.log`.
- Release QA exposed a hot-link defect: reopening an already mounted paused JESUS through its `autoplay=1` link kept autoplay consumed and could show a black paused surface. The route now rearms every validated same-video external Play request, not just Apple-marked Top Shelf links. Rebuilt/installed and retested: hot playback resumed 5:19, focused Play/Pause and visibly advanced. Invalid/different/ambiguous links are ignored; player layouts and Google publisher URL contracts did not change. Retest build log: `/tmp/watch-home-release-qa-replay-20261005.log`.
- Rechecked the shared handler on Apple TV 4K simulator: Chosen Witness More Info opened Details, Play entered Native A at saved progress, and More Info during playback returned to Details. Screenshot evidence is saved with the Chromecast captures. Fullscreen system Top Shelf selection still needs the simulator's manual swipe gesture; automated direction/drag attempts did not enter that OS carousel.
- An Android development-client linking warning occurred after an injected warm route during launcher onboarding. It did not recur in the tested normal remote-driven Settings flow after completing/dismissing the development menu, or in the bundled Release QA cold/hot tests. No separate production NavigationContainer fix is claimed for that development warning.

## October 7 physical installation attempt

- The user explicitly requested installation on physical Office Apple TV, superseding the simulator-only instruction for this installation. Restored the archived checkout at `819b4166a`; application source was unchanged.
- Office Apple TV was paired, connected over local network, running tvOS 27.0 with Developer Mode enabled. Xcode 27.0 was the selected local toolchain.
- Signing initially failed: the old app/extension provisioning profiles lacked the Top Shelf App Group, and Xcode lacked an active Cru Global account. After the user signed in, automatic development signing succeeded for the app and extension with `group.org.jesusfilm.forgewatch.topshelf`.
- Release build and strict deep signature verification passed. The embedded JS bundle and `ForgeTopShelf.appex` were present. `devicectl` installed `org.jesusfilm.forgewatch` 1.0.0 (local build 1) over the previously installed build 13 without uninstalling it. This is a local development-signed Release, not a TestFlight upload.
- Launch did **not** pass: the app exited immediately, and the device crash report identifies `___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke` with `EXC_BREAKPOINT`. Apple's Xcode/tvOS 27 SDK requires scene-based lifecycle adoption; the generated Expo SDK 54 delegate still uses the legacy lifecycle. A startup compatibility fix or compatible older build toolchain is required before claiming the installation is usable.
- Evidence: `/Users/up/Projects/forge-worktree-archive/2026-10-07/apple-tv-install/launch-crash.ips`. Build output: `apps/tv/ios/build/device-release/Build/Products/Release-appletvos/JesusFilmWatch.app`. Earlier targeted validation passed 5 suites / 39 tests and TV typecheck. No player layout changes, merge, or store upload occurred.

## Remaining gates

October 7 follow-up: `codex/tvos27-scene-startup` adds the prebuild-persistent single-scene adapter and the user-approved beta Settings selector. Signed physical Release build/install and visible Watch Home/Settings now pass; Native A remains selected and existing auto-start preferences were preserved. All 155 TV suites / 2,073 tests, typecheck and lint passed. Automatic was restored after testing, and the app was left open at the selector (`top-shelf-beta-final.png`).

The physical writer rejected the App Group root location. App and extension now share `Library/Caches/top-shelf.json`; a real device copy confirmed a Collection snapshot with five recommendation videos. Beta refresh status makes failure/timeout visible, and repeated selection retries. Settings owns its explicit preview preparation so publishing does not rely on the covered Home screen updating. Production explicitly disables the preview flag and ignores stored preview choices; unavailable styles retain Automatic eligibility rules.

Evidence is under `/Users/up/Projects/forge-worktree-archive/2026-10-07/apple-tv-install/`: `launch-beta-verify.png` (Home), `collection-selected.png` (remote selection), `collection-snapshot.json` (native publication), and the original `launch-crash.ips`. The user initially reported only the red logo despite valid snapshots. The plugin incorrectly kept the extension at native build setting 1 when Expo's app build number changed; it now uses `config.ios.buildNumber` first. Both app and extension were rebuilt and installed as local 1.0.0 (14), with their matching bundle versions verified. Actual system Home now displays Spotlight (`top-shelf-build14.png`) and Collection (`collection-build14-live.png`, five published recommendations). No restart, uninstall, main merge, push or store upload was required. All-five-style visual coverage remains pending.

- Repeat system Home selection with the updated binary, including cold/warm topic links. All-five-mode visual coverage remains pending.
- Apple simulator cold/warm topic routes and Native A saved-progress playback passed on October 5. Actual updated system Home button selection and all-five-mode visual coverage remain pending; physical Apple TV is excluded by the user's current instruction.
- Complete page-load timing comparison with the baseline. Snapshot requests are deferred four seconds and do not block Home rendering; first-process Metro bundling took 2,606 ms, which is not a page-load regression measurement.
- Android verifier metadata acceptance and isolated bundled Release QA cold/hot navigation passed. Real Google TV launcher availability/display and approved-package/certificate feedback submission remain pending. No production Android Home placement is claimed; no emulator was recreated.
- Development-signed physical Release build/App Group provisioning, tvOS 27 startup, and Spotlight/Collection system Home rendering now pass. Remaining styles, distribution signing and store processing remain release gates. No TestFlight, Play or production deployment occurred.
- Full recommendation playback-learning verification from the separate recommendations worktree is still pending; this task reuses its API/identity client and does not claim that those earlier playback gates are complete.

## Recovery and rollback

Source changes are isolated from main and other worktrees. Explicit `EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED=false` retains editorial discovery fallback while snapshot eligibility and language checks remain effective. Google production publication cannot be enabled by this flag alone. Roll out through normal PR review and beta testing before main/store activation.

## October 8 focused Apple integration on latest main

Current evidence supersedes the older pending all-five visual gate above: all five eligible styles and Automatic rendered on the Apple TV 4K tvOS 26.5 simulator, using actual recommendations and existing history. Warm native card selections opened film details, a matching topic collection and Native A resume. Cold Play and More Info URLs also passed. A real resume-language mismatch caused a black screen and was fixed without saving an unwanted audio preference. A late native-write retirement race was reproduced and fixed with post-await fencing and a serial native snapshot queue.

165 TV suites / 2,116 tests, typecheck, lint, repository formatting, prebuild, CocoaPods installation and Release native build passed. App/extension version 1.0.0 (1) and App Group match. Recorded normal startup samples both showed Home around nine seconds, with no observed paired-sample regression; this is not a statistical benchmark. Search Back and preserved Native A/default loading behavior were rechecked or covered by existing regression tests.

Exact scope, provenance, evidence paths and remaining native carousel action / signed provisioning / store gates: `docs/plans/2026-10-08-apple-tv-top-shelf-integration.md`. Only simulator testing was performed in this integration. Android work and physical-device evidence from earlier sections are not proof for this PR.

## October 19 isolated API interception

Test scope is complete on unchanged `codex/tv-selected-improvements` at
`14f4804a1c6c618a650416829b1e99ff605712b5`. This exercise tests local controlled
responses on the actual Apple TV system Top Shelf. It does not edit admin content,
implement push or establish production refresh, Android behavior or store readiness.

The dedicated **Top Shelf API Interception QA 4K** simulator is
`EB58EEAD-0AD3-4EA4-B96E-F3CE887B39F6`, running tvOS 27.0 with Xcode 27.1
(`27A9275`). The existing Debug app and embedded extension were reused, both
version 1.0.0 (1); deep strict signature verification passed before installation.
The app executable SHA-256 is
`7b2a0ae56c40b704ca0a720b6c5f0bccb65ae7ae294be666181eb41412f9c65c`.
The original simulator, Android emulator and their data were not controlled or
reset during this exercise.

QA Metro 8099 emitted the verified loopback GraphQL endpoint on proxy 8098.
Actual app traffic was required before accepting results. The proxy supplies
schema-valid local viewer/recommendation fixtures with `requestId: null`, preserves
real film IDs/slugs/durations/routes and allows only reviewed catalogue reads
upstream. Other mutations are denied, with no fabricated accepted receipts.
The actual playback-context mutation received 403 locally. No attributed
render/impression evidence request appears in the proxy log. This is a local
boundary observation, not a production database audit. Existing unrelated
telemetry configuration was preserved.

The four verified English-playable films were JESUS (7,673.728 seconds), Magdalena
(3,658 seconds), The Story of Jesus for Children (3,679.829 seconds), and My Last
Day (553.558 seconds). Journey used the actual `media-collection-14` Home section.
No history was inserted to make Continue Watching eligible.

### Case outcomes

“Pass” below means the stated observation occurred, not that every layout, cache
state or release gate passed. Cache-limited and unsupported updates are explicit.

| Scenario and fixture revision          | Result                             | Actual observation                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline Spotlight; revision 0/2       | Pass                               | Real film art/summary and native Play/More Info displayed on system Home.                                                                                                                                                                                                                                                                                                                                            |
| Long text; revisions 2 → 3 and 23 → 24 | Partial across layouts             | Spotlight visibly updated the 500-character summary and truncated it to the available space, while its carousel AX title remained JESUS. A separate same-layout Collection comparison visibly updated the title prefix and exposed all 200 characters in the focused cell/StaticText. A full marquee cycle was not verified.                                                                                         |
| Artwork; revisions 9 → 10              | Pass                               | Magdalena changed to a separately verified image from the same film, with identity, duration and destinations unchanged. JESUS's bundled preview would obscure this poster comparison, so it was not used as the artwork oracle.                                                                                                                                                                                     |
| Reorder/remove; revisions 4 → 5 → 6    | Pass                               | Both position fields and array order changed. Actual Collection reversed the four films; removal left Magdalena, Children and My Last Day without JESUS.                                                                                                                                                                                                                                                             |
| HTTP 503/timeout; revisions 11/12      | Pass                               | Actual failed/cancelled requests and error status retained the exact previous unexpired snapshot, including its write time, and old visible shelf. The 3-second fixture delay exceeded the client's 2.2-second deadline.                                                                                                                                                                                             |
| Recovery; revision 13                  | Pass                               | A fresh successful response published and visibly displayed the labelled recovery description.                                                                                                                                                                                                                                                                                                                       |
| Empty/invalid content; revisions 14/16 | Pass                               | Empty results and invalid HTTP artwork produced an empty snapshot; system Home settled to static Watch artwork without a crash or invented film. Recordings include a transient cached film frame; the later settled screenshots are the final-state evidence.                                                                                                                                                       |
| Foreground style reselection           | Pass, subject to caches below      | Reselecting through Settings → Top Shelf — Beta requested recommendations and published visible changed content. Snapshot success alone was not used as proof of system display.                                                                                                                                                                                                                                     |
| Background update                      | Unsupported in the observed window | 60.572 seconds, zero new proxy requests, unchanged snapshot and visible shelf. Reopening and foreground refresh updated afterward.                                                                                                                                                                                                                                                                                   |
| Terminated update                      | Unsupported in the observed window | App termination/process absence was verified. Over 60.594 seconds there were zero new proxy requests and no snapshot change; reopening then refreshed. This does not establish APNs or closed-app remote refresh.                                                                                                                                                                                                    |
| Short                                  | Pass                               | Real My Last Day was eligible and the native shelf displayed 9 min with genuine film actions.                                                                                                                                                                                                                                                                                                                        |
| Journey; revisions 17 → 18             | Cache-limited                      | Warm reselection retained the old snapshot and made no new GetWatchSetting request. Reopening fetched the changed eligible section copy, then the snapshot and actual focused native title updated.                                                                                                                                                                                                                  |
| Continue Watching without history      | Pass                               | Fresh QA history honestly fell back to eligible Collection. No seeded progress or synthetic viewing event was used.                                                                                                                                                                                                                                                                                                  |
| Native More Info/Play; revisions 22/25 | Pass for observed destinations     | Scoped native Magdalena More Info opened the real detail page without autoplay. Scoped Play entered AVKit and a separate clip showed distinctly progressing real film frames. Native Play/More Info labels and bundled concept headings remained unchanged.                                                                                                                                                          |
| Continue metadata; revisions 25 → 26   | Cache-limited; QA-reset proof only | Real playback saved 159 seconds of Magdalena progress. Warm refresh and cold reopen both kept the old title without a new TopShelfVideo query. After recording that limit, only `watch.top-shelf.catalog.v1` was removed in the terminated QA app. Reopening issued TopShelfVideo revision 26 and the system card showed “Magdalena · QA video update”; the real history row and other stored values were unchanged. |

The QA-only cache reset is evidence of response handling once a fetch occurs; it
is not a normal refresh fix. The persisted history duration was 3,657 seconds
from the actual player; catalogue duration was retained separately. Pause/resume,
Back, seeking, audio and AVKit timer accuracy were not newly verified. The earlier
selected-integration player-control failures remain open. Native destination checks
above do not constitute a new cold/warm/resume matrix across every film and style.

### Evidence, checks and interpretation

All artifacts are local under `.local-tools/top-shelf-interception/`:

- `deliverables/index.html`: captioned silent videos, screenshots and outcome cards.
- `runtime-summary.md`, `metrics.json`, `case-journal.jsonl`: fixture revisions,
  intercepted operations, snapshot hashes/timestamps, lifecycle windows and limits.
- `proxy-live.log`, `source-manifest.json`, `selftests-v2.log`: frozen proxy v2,
  restricted operation traffic and 12 passing focused tests.
- `text-visual-review.md`, `evidence-update-review.md`: independent inspection of
  actual native title/summary, destination and progressing-frame evidence.
- `qa-only-cache-reset.json`, `qa-progress-after-cache-reset.json`: narrowly scoped
  QA reset and preserved genuine progress.
- `cleanup.json`: separate post-test restoration record; never includes private
  configuration values. Private backups and upstream configuration are excluded
  from the gallery and harness evidence.

TV typecheck, lint and full Jest passed for the unchanged runtime source. The UI
archive contains 65 executions: 62 exited successfully and three initial driver
failures remain retained. The first failed on a fresh-system Open prompt; the
others exposed stale offscreen Selected flags and overshooting carousel movement.
Focused repairs strengthened the oracle to visible geometry and focused native
children; successful retests did not overwrite failures. No app behavior was
changed to satisfy these tests.

The QA harness run is
`apps/tv/test-results/development-harness/top-shelf-api-interception-0b334a1d-0e94-4510-84e9-9cb9de8d8d43`,
with QA source/environment digest
`698900594cbca639fc73e4d7640589eef1a48f1597a2a307c2b0b74efd59c0e9`.
Five scoped acceptance observations are evaluated separately from release gates.
The required broad performance gate remains unverified: there are no matched
launch-performance baseline/candidate samples. Snapshot generation/write intervals
and 100 ms proxy-log observer timestamps describe this local experiment, not
first-pixel latency, exact request-to-render time or a performance improvement.
An overall all-gates pass must not be inferred.

Application source, public API, schema and branch HEAD are unchanged. The normal
endpoint and Metro restoration are verified separately from the temporary QA
digest; the isolated QA simulator is kept shut down so its inert local identity
cannot be reused against the normal API. feat-630 stays in progress for broader
performance, Android, distribution and release work. No APNs support, TestFlight
readiness, production admin update or new player-control certification is claimed.

## October 20 foreground cache correction and local-only retest

The application cache limitations from the October 19 run are corrected in the
current uncommitted work on `codex/tv-selected-improvements` (HEAD `14f4804a`).
The redundant daily metadata cache is no longer read/written. Each existing
bounded foreground sync queries one preferred playable dub per requested film,
rejecting a fallback language. Apple Home/beta refresh the Journey model, keep
cached Home paint while fresh data loads, and suppress stale publication. Request
ownership covers primary/settings/top-up queries, and confirmed removals cannot
reappear through overlapping recommendations or stale fallback data.

| Retest on isolated Apple TV 4K      | Result                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue metadata and Journey title | Updated on foreground return without restart, style reselection or cache reset; actual native title/marquee inspected.                                           |
| Artwork                             | Verified alternative image for the same Magdalena film; identity/duration/progress unchanged.                                                                    |
| Collection reorder/remove           | Native settled shelf follows reversed positions/order and removes JESUS; paired stills establish the final result because some videos end during the transition. |
| Metadata API 503 → recovery         | Exact unexpired snapshot and write time retained through failure; healthy response then updates.                                                                 |
| Removed metadata/Journey            | Removed items disappear and eligible Automatic fallback is shown. Real history is retained.                                                                      |
| Viewing history                     | Existing Magdalena position remains 159 seconds, duration 3,657 and original updatedAt; legacy catalogue remains present.                                        |
| Background / terminated             | 60.567 / 60.561 seconds, zero API requests and unchanged snapshot. Closed-app refresh remains unimplemented.                                                     |
| Normal reopen                       | Cold Home launch automatically refreshes Journey; no Settings selection needed.                                                                                  |
| Push                                | Not run, explicitly excluded by the owner.                                                                                                                       |

All 21 local UI executions passed. Typecheck, lint, 185 Jest suites / 2,291 tests
and format pass. Eleven offline-proxy tests cover all 16 modes and zero outbound
API fetches. No native app rebuild was necessary: Swift/extension code is unchanged;
the existing Debug app/extension 1.0.0 (1) loaded verified candidate JavaScript from
QA Metro. This does not certify physical TV, full player controls, native background
fetching, APNs or the prior Spotlight accessibility-title limitation.

After the local-only instruction, the forwarding server was stopped and QA
terminated before switching to captured-data replay. Four captured production API
asset-preview URLs were omitted; public CDN artwork was retained. No new production
API calls are part of that replay. Earlier 2+2 launch comparisons used reviewed
catalogue reads before the instruction and remain labelled separately: mean Home
readiness 3,215.5 ms baseline / 2,958.8 ms candidate. This is a small Debug smoke
comparison, not a statistical performance claim.

Full results, source/environment digest, independent review, silent videos and
snapshots are in `.local-tools/top-shelf-refresh/runtime-results.md`, `results.json`
and `deliverables/index.html`; tracked scope and native follow-up architecture are
in `docs/plans/2026-10-19-top-shelf-fresh-content.md`. Cleanup is separately recorded
in `cleanup.json`, restoring private configuration and preserving original devices.
Normal Metro remains stopped under the local-only instruction. feat-750 is complete;
feat-630 remains in progress for the broader platform/release work.

## October 20 native public-feed prototype

feat-751 adds a default-off native public-feed client. This supersedes the
snapshot-only implementation described in the earlier runs when a native endpoint
is explicitly configured. It is a local prototype, not a production admin/API
integration. The transport/cache candidate uses provider `dd27ba63` and feed helper
`82307dd8`; app/extension remain 1.0.0 (1). Build, generated App Group configuration,
installed extension hash and simulator ad-hoc signature were checked. This does
not establish physical-device signing or distribution entitlements.

All new API traffic is served from `127.0.0.1:8101` using previously verified
public catalogue identities/artwork. The listener cannot forward upstream.
Approved public CDN artwork may still be loaded by tvOS. Watch remains stopped,
Metro is not running, and no app snapshot/cache reset or history rewrite is used.
The dedicated QA device is `EB58EEAD-0AD3-4EA4-B96E-F3CE887B39F6`.

| Case before the availability-label correction | Observed result                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Journey API copy/artwork change               | Native request, accepted public revision and actual system Home artwork change with Watch stopped. Real ID/slug remain `media-collection-14`. |
| HTTP 503                                      | Unexpired revision 4 remains byte-identical; same artwork stays visible.                                                                      |
| Invalid HTTP 200 content                      | Invalid item rejected, revision 4 unchanged; not treated as an empty publication.                                                             |
| Ten-second local server delay                 | Native client aborts at 3,004.69 / 3,008.48 ms; revision 4 remains unchanged.                                                                 |
| Healthy recovery                              | Revision 8 accepted; original JESUS artwork returns without opening Watch.                                                                    |
| Explicit empty feed                           | Revision 9 with zero items accepted; system Home displays the static Watch logo.                                                              |
| HTTP 503 after accepted empty                 | Revision 9 remains empty; removed content is not resurrected.                                                                                 |
| Recovery after empty                          | Revision 11 accepted; real Journey card returns.                                                                                              |
| App data ownership                            | App snapshot hash and complete genuine viewing-history hash remain unchanged throughout captures.                                             |

The opt-in public feed owns public content within its endpoint/language/concept.
It does not mirror personalized in-app recommendations. Continue Watching remains
app-owned; no private history, progress, credentials or recommendation capability
is sent. Public cache records are separate, context-scoped and revision-fenced;
accepted empty/expired records retain their high-water mark. Same-style app
metadata writes do not override public authority. Language/style, file removal,
malformed state and Continue changes fence in-flight public results. App-owned
fallback retains full-byte guards.

The Foundation host executable passes 19 regressions covering validation, cache
ownership, expiry/tombstones, context round trips, real concurrent-process locking,
request cancellation, redirects, streaming caps and deadlines. The local feed
harness passes 8 tests. Provider overlap/context interleavings are independently
source-reviewed; those races were not reproduced on the device. Other public
styles have contract/unit coverage; this closed-app system UI run uses the actual
existing Journey context only. Carousel Play/More Info, other styles' native
presentation, physical hardware, production feed integration, TestFlight and
player controls are not newly certified. Push was explicitly excluded.

Evidence: `.local-tools/top-shelf-native-refresh/runtime-results.md`, `results.json`,
`native-artifact-identity-final.json`, `provider-review-final.md` and
`deliverables/index.html`. Each runtime case pairs local receipts, native logs,
public cache, genuine app/history hashes and system UI captures. The
`final-installed-baseline-visible.png` post-test capture landed during the next
runner's startup and shows Settings, so it is excluded from before/after artwork
proof; later settled baseline captures are used instead. Earlier reviewed-build
artifacts remain labelled separately. No cache deletion was used to fix a result.

Passive observation also succeeded on that pre-correction build: after changing only the
local fixture from revision 11 to 12, the extension made its next request
**159.362 seconds later**. There was no remote input, Watch launch, cache reset or
refresh notification during the 200.909-second observation. The first three
50-second segments retained revision 11; the fourth records the actual original
JESUS artwork changing to the verified alternate artwork. Native receipt, public
cache and unchanged app/history hashes corroborate the screen. This is one
simulator observation, not a promised three-minute cadence or instant update.

Measured native successful request/cache completion is 5–72 ms across 12 pre-correction
binary invocations (median 8.5 ms). These are local Debug smoke measurements;
provider completion is not first pixel and does not include OS scheduling delay.
Timeout samples above exercise the actual three-second network bound. No claim
of production latency or an app-launch performance improvement is made.

### Availability label correction

The focused-title check then found a display bug in that candidate: mapping cache
TTL to `TVTopShelfItem.expirationDate` made tvOS show **3 minutes Left** instead of
the title. The corrected provider `d3b4904d` removes that mapping for both styles;
cache validation/expiry remain unchanged. Native build
`native-build-availability-fix` passes with runtime UUID
`C2012AAC-A34C-3088-BE2E-C333C1215246`. The actual focused card now shows the long
Journey title with normal OS clipping/marquee; accessibility contains the complete
72-character title ending **Native QA revision 14**, without a countdown. Root
inspected both image and actual AX, not just the saved feed.

Earlier passive timing above is retained as historical evidence only: expiration
metadata may affect system scheduling. The corrected binary requires its own
passive observation. The app's cache TTL is not content availability and cannot
guarantee removal of an OS-retained screen before tvOS requests content again.

The corrected build also passes six UI checks: baseline13→changed14, focused
long title, timeout retention14, empty16 and recovery17. A fresh passive run then
changed only the local fixture to18. The native request arrived **137.461 seconds
later**, and the actual artwork changed without opening Watch, remote input or a
refresh notification. Observation lasted200.754 seconds; the transition is in
`availability-passive-segment-3.mp4`. This corrected run, rather than the older
159.362-second candidate, is the final closed-app proof. No fixed cadence is
promised. Final native request/cache completion is6–50ms across9 invocations
(median13ms); timeout aborts are3008.32/3006.71ms. These are local smoke metrics.

Typecheck, lint, TV Jest, format and corrected native Debug build pass; the
unchanged helper's19 regressions and8 local-feed checks remain applicable.
Process observation ended with6356 samples, zero Watch-running samples and zero
errors. Current `results.json` and `runtime-results.md` distinguish final proof
from `results-pre-availability.json`; the captioned gallery uses corrected-build
footage. Cleanup restores the original private environment and default-off native
configuration, stops owned services and shuts down only QA; see `cleanup.json`.
feat-751 completes this scoped local prototype. Overall feat-630 remains in
progress for its separate production/platform/release gates.
