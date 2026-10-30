---
title: "Mux Data native SDKs send a downloaded video's local file path that the app never passed in"
date: "2026-10-23"
category: integration-issues
module: apps/mobile
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "On iOS, the beacon field `vsour` holds the downloaded file's `file://` URL, with the per-install app container id, when the app sets no `video_source_url`"
  - "On Android, each `requestcompleted` event holds the local file path in `qur`, also after the app sets its own `video_source_url`"
  - "Every unit test of the app's view data stays green, because the leaked fields never pass through the app's data map"
root_cause: incorrect_assumption
resolution_type: code_fix
framework_version: "Mux-Stats-AVPlayer 4.17.0 with MuxCore 5.14.0; data-media3-at_1_9 1.13.4; expo-video 57.0.5"
retire_when: "Mux's AVPlayer and Media3 SDKs stop sending a local file URL (vsour from the player item, qur in requestcompleted events) or add a documented way to remove it; check both SDKs' release notes, then repeat the no-send capture below before the app monitors a downloaded play"
tags:
  - mux-data
  - privacy
  - offline-downloads
  - expo-video
  - native-sdk
  - beacon-capture
  - local-file-path
---

# Mux Data native SDKs send a downloaded video's local file path that the app never passed in

## Problem

The mobile plan monitored downloaded plays with a marker. The app's own view data never holds a local path: `buildMuxViewData` sets `video_source_url` only for an `http` or `https` stream (`apps/mobile/src/lib/muxData/viewData.ts:71`). But both Mux native SDKs read the URL from the player by themselves, so a downloaded play still sends its full on-device path to Mux.

## Symptoms

The spike captured every beacon on 2026-10-21. It used release builds on an iPhone 17 Pro simulator (iOS 26.5) and a Pixel 9a emulator (API 35). The test file sat at the real download path, `Documents/offline-downloads/<slug>/<rendition>.mp4` (`OFFLINE_ROOT`, `apps/mobile/src/lib/offlineFileSystem.ts:23`).

| Platform | App data                         | Path in the beacons                                                                                                         |
| -------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| iOS      | No `video_source_url` (data map) | `vsour` = `file:///…/Containers/Data/Application/<container id>/Documents/offline-downloads/spike-slug/spike-rendition.mp4` |
| iOS      | Placeholder `video_source_url`   | None in 7 beacons, and none in the `error` beacon of a damaged file (`Invalid sample cursor`, code -11880)                  |
| Android  | No `video_source_url` (data map) | `vsour` and `qur` (the request URL of `requestcompleted`)                                                                   |
| Android  | Placeholder `video_source_url`   | `qur` = `/data/user/0/org.jesusfilm.forgewatch/files/offline-downloads/spike-slug/spike-rendition.mp4`                      |

- The iOS container id is unique to each install, so it is a device identifier.
- On iOS, a local file sends no `requestcompleted` event, so `vsour` is the only field that carries the path.
- No unit test can see this. The tests prove the fields that the app sets, and the SDK adds the leaked fields after the app's data map.

## What Didn't Work

- **Trusting the app's data map.** Before 2026-10-22, plan R21 allowed the stream address of a streamed play but never a download's file path (session history), and the data map follows that rule. The iOS SDK fills the empty `video_source_url` by itself.
- **A placeholder `video_source_url`.** It fixes iOS only. On Android, the request URL comes from the player's load events, and no customer data field controls it.
- **An Android sender that removes the path (considered, not built).** Mux's default sender `com.mux.stats.sdk.muxstats.MuxNetwork(IDevice)` is public, so a custom `INetworkRequest` could remove local paths and then call it. The owner rejected it on 2026-10-22: every Mux, Expo, or React Native update would need a new capture to prove that no new field carries the path.
- **The in-app download on the iOS simulator.** `FileSystem.downloadAsync` failed with `ERR_FILESYSTEM_CANNOT_DOWNLOAD` (`NSURLErrorDomain` code -1) in its background session. Copy the MP4 into the app container instead (`xcrun simctl get_app_container <udid> <bundle id> data`).
- **Planning context (session history).** The plan monitored downloaded plays because the app plays the local file for every later play of a downloaded dub, also online, and because Mux gives full error details for a damaged file. A document review of the plan also added the spike check that found this leak: a capture that searches every Mux field for a local file path.

## Solution

**1. Do not monitor downloaded plays (owner decision, 2026-10-22, plan R20).** The monitor detaches before a local file loads, so neither SDK sees the local item.

- `isMonitoredStream` returns false for a local URL when downloaded plays are not monitored (`apps/mobile/src/lib/muxData/streamTransition.ts:57`).
- A swap from a monitored stream to an unmonitored one gets `beforeLoad = "detach"` (`apps/mobile/src/lib/muxData/streamTransition.ts:155`).
- The native backend (U5) will set `downloadedPlaysMonitored: false` (plan U5). Until U5, `resolveMuxMonitorBackend()` returns `null` (`apps/mobile/src/lib/muxData/monitor.ts:42`), so no monitor runs at all.

The detach rule is in PR #2844, unmerged as of this writing. The native backend (U5) is not built yet.

**2. Find such a leak with a capture that sends nothing to Mux.** Use it before the app monitors any source that is not a network stream.

iOS: MuxCore sends each beacon through its own `URLSession`, which it builds from `URLSessionConfiguration.default`. The env key `local` makes MuxCore post to `http://localhost:8080`. Add a `URLProtocol` to the default configuration, and answer each beacon inside the app:

```swift
final class MuxCaptureProtocol: URLProtocol {
  override class func canInit(with request: URLRequest) -> Bool {
    guard let url = request.url, let host = url.host else { return false }
    return host.hasSuffix("litix.io") || (host == "localhost" && url.port == 8080)
  }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    // Record request.url, the headers, and the body (httpBody or httpBodyStream).
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data("{}".utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

extension URLSessionConfiguration {
  @objc class func captureDefault() -> URLSessionConfiguration {
    let config = captureDefault()  // The original getter, after the exchange below.
    config.protocolClasses = [MuxCaptureProtocol.self] + (config.protocolClasses ?? [])
    return config
  }
}

// Run once, before the first monitor call (for example in the module's OnCreate).
method_exchangeImplementations(
  class_getClassMethod(URLSessionConfiguration.self, #selector(getter: URLSessionConfiguration.default))!,
  class_getClassMethod(URLSessionConfiguration.self, #selector(URLSessionConfiguration.captureDefault))!)
```

Android: the full `MuxStatsSdkMedia3` constructor takes a network. Pass one that records each batch and sends nothing:

```kotlin
private class CaptureNetwork(private val context: Context) : INetworkRequest {
  override fun get(url: URL?) = record("GET", url?.toString(), null)
  override fun post(url: URL?, body: JSONObject?, headers: Hashtable<String, String>?) =
    record("POST", url?.toString(), body?.toString())
  override fun postWithCompletion(
    domain: String?, envKey: String?, body: String?,
    headers: Hashtable<String, String>?,
    callback: INetworkRequest.IMuxNetworkRequestsCompletion2?,
  ) {
    record("POST", "domain=$domain envKey=$envKey", body)
    callback?.onComplete(true, emptyMap())  // Nothing leaves the device.
  }
  // Also override the deprecated IMuxNetworkRequestsCompletion overload the same way.
}

MuxStatsSdkMedia3(
  context = context, envKey = envKey, customerData = customerData,
  player = videoPlayer.player, network = CaptureNetwork(context),
  playerBinding = ExoPlayerBinding(),
)
```

Write each record to Logcat in parts of about 3,000 characters. A release APK is not debuggable, so `run-as` cannot read the app's files. Then search every beacon for `file:`, `offline-downloads`, the file name, `Documents`, `Containers`, the simulator device id, and the app container id.

## Why This Works

Both SDKs observe the player, not the app's data.

- On iOS, the observed `vsour` equals the player item's file URL whenever the app leaves `video_source_url` empty, so the SDK fills the field by itself.
- On Android, the SDK reports the player's load events, and the request URL of a local item is its file path.
- Customer data can replace only the fields that it names. A placeholder therefore covers `vsour`, but not `qur`.

A detach before the local item enters the player means that neither SDK ever observes it. That control holds on both platforms, and it does not depend on which fields a future SDK version adds.

The capture works because MuxCore builds its session from the default configuration, and the Android SDK accepts an injected network. In both cases the beacons stop inside the app.

## Prevention

- Treat "Mux never receives X" as a claim about the SDK's whole payload, not about the app's data map. Prove it with the no-send capture before the app monitors a source that is not a network stream.
- Repeat the capture after each Mux SDK or `expo-video` update. Plan AE11 defines the check: a stream that its download replaces must end the view, and no later beacon may carry a local path.
- Keep the detach rule pinned. `apps/mobile/src/lib/muxData/__tests__/streamTransition.test.ts:233` ("detaches for a stream-to-download swap when downloads are not monitored") fails if the rule changes.
- A return to monitoring downloaded plays needs a new owner decision (plan R20). The iOS placeholder alone is not enough, because Android still sends the path in `qur`.
- The same class of problem exists for Datadog: a native SDK below a thin React Native wrapper sends data that the JavaScript call does not show. See the related doc below.

## Related Issues

- PR #2844 (the Mux Data shared base and the plan).
- `docs/plans/2026-10-20-1530-feat-mobile-mux-data-plan.md`: R20, R21, AE11, and U1 step 3.
- `CONCEPTS.md`: Downloaded Play and Mux Data View.
- `docs/solutions/best-practices/datadog-rn-sdk-log-level-rum-data-governance-boundary.md`: the same hazard with the Datadog SDK.
- `docs/solutions/logic-errors/session-identity-needs-one-slug-tolerant-predicate.md`: the stream-to-download swap that the monitor must detach before.
- `docs/solutions/logic-errors/download-is-one-dub-identity-travels-with-the-file.md`: why a downloaded file replaces the stream, also online.
- `docs/solutions/developer-experience/debugging-rn-sim-state-via-app-container-20260624.md`: the iOS app container path.
- `docs/analytics-and-recommendation-policy.md`: the payload-minimization rule.
