# Watch browser investigations — 24 September 2026

This bounded continuation covers [feat-520](../roadmap/content-discovery/feat-520-watch-field-post-response-paint-attribution.md), [feat-521](../roadmap/content-discovery/feat-521-watch-selection-browser-commit-waits.md) and [feat-523](../roadmap/platform/feat-523-watch-field-hydration-mismatch-attribution.md). It adds field observations on production Web `37e10b622bd66e55647cf561c3896b2d4fbb4dce`; it does not identify a general application cause or close any ticket. All times below are UTC. No production settings, content or code were changed.

## Feat-520: two fresh mobile post-response paint cases

Use Datadog RUM search with the exact deployed version and a bounded window. The first view was selected with:

```text
service:forge-web env:prod version:37e10b622bd66e55647cf561c3896b2d4fbb4dce @type:view @browser.name:"Opera Mobile" @view.url:*watch* @view.first_contentful_paint:>15000000000
from: 2026-09-23T22:07:40Z
to:   2026-09-23T22:08:30Z
```

At 22:07:53 on `/watch/jesus.html`, RUM reports first byte **32.9 ms**, FCP/LCP **18,132 ms**, hero poster as the LCP target, and a foreground period covering the paint. The view's render-blocking CSS resource `0jkmdtj3uyi~i.css` returned HTTP 200 but took **13,902.5 ms**, including a **1,404.8 ms** first-byte wait and **11,538.6 ms** download; RUM records **303,200 transfer bytes**. A **16,272.8 ms** long animation frame began at navigation-relative 91.6 ms, with only about **416 ms** in its five listed script spans. Its remaining duration cannot be labeled JavaScript execution. The resource and frame overlap the pre-paint interval; neither alone proves why paint waited until 18.1 seconds.

A second `@type:view` search for Chrome Mobile, Watch URL and FCP above 13 seconds within 22:04:40–22:05:20 found `/watch` at 22:04:53: first byte **3,540.1 ms**, FCP **13,896 ms**, LCP **14,276 ms**, foreground through paint. Both render-blocking CSS resources took about **8,463 ms**, with about **6,620 ms** waiting for first byte. The larger CSS transferred **44,663 bytes**. Its retained long-animation-frame events begin after FCP, so they do not explain the earlier interval. A separate read-only HTTP request with `Accept-Encoding: gzip` retrieved the same CSS path in **44,363 bytes**; the Opera and curl clients have different request/network conditions, and the Opera request's compression header was not retained. Do not infer a compression defect from this comparison.

For each case, the resource and long-task reads used the view ID returned by the selected RUM view, then `service:forge-web @type:resource @view.id:<selected-view-id> @resource.type:css` and `service:forge-web @type:long_task @view.id:<selected-view-id>` over the same minute. View/session IDs, full URLs with query strings, IP addresses and user attributes are deliberately omitted here. Browser names and the Android device label do not prove physical hardware or human traffic. These are selected cases, not a percentile or a denominator for all Watch visits. The original September 17 cases remain separate.

The next required artifact is a headed or physical-device capture matching one affected route, viewport, browser and effective network: navigation/resource timing, all paint candidates, stylesheet response/encoding, long-animation-frame attribution and a renderer trace showing the work between stylesheet completion and FCP. Compare a matched control before changing CSS or render code; PR #2387's deferred HLS bundle work is a separate change.

## Feat-521: request and native-commit boundary still missing

The September 21 [native-wait record](watch-closeout-release-2026-09-21.md) remains the strongest evidence. No new selection request was sent in this continuation. `WatchSemanticRecommendations.tsx` currently navigates after either the validated `recommendationJsonWithRetry` resolution or its rejection. It does not emit a per-selection browser stage observation; the helper combines fetch, body parse and validation under one deadline. Existing RUM resource timing can show network activity but not whether the renderer received headers, parsed the body or was blocked in a native commit. No current read-only RUM field supplied the missing `WaitForCommitCompletion` overlap or exact server-commit/renderer acknowledgment join.

If a fresh natural field failure remains uncorrelatable, the smallest evidence-enabling code change would be a selection-only, privacy-safe RUM action on completion/failure with bounded elapsed times for request start, response headers and validated body; result category and attempt count would be allowlisted. It must omit request/card/capability IDs, nonces, URLs and response bodies. This would separate browser phases, but would **not** by itself prove server commit or native compositor causality. A matching owned Chrome trace with an affected request, actual viewport/launch arguments, renderer callback marks, HTTP header/body times and exact nonce/href/media acknowledgment validation remains necessary. Do not change deadlines or retry policy to manufacture a pass.

## Feat-523: current-release text and HTML variants

The fixed RUM window is **2026-09-22 23:35 to 2026-09-23 23:35 UTC**, with:

```text
service:forge-web env:prod version:37e10b622bd66e55647cf561c3896b2d4fbb4dce @type:error @error.message:*React*error*418* @view.url:*watch*
```

Grouping `COUNT(*)` and `CARDINALITY(@view.id)` by `@browser.name` and `@error.message` gives these separate populations:

| Browser-named cohort | Text events | HTML events |
| -------------------- | ----------: | ----------: |
| Mobile Safari        |          98 |           0 |
| Chrome               |          39 |           3 |
| Safari               |          34 |           0 |
| Chrome Mobile        |          11 |           4 |
| Googlebot            |          75 |           4 |
| crawler              |          10 |           0 |
| Yeti                 |           4 |           0 |
| bingbot              |           1 |           0 |

The four ordinary-browser **names** total **182 text** and **7 HTML** events; names are not proof of human visits. Separately, Googlebot's 75 text events occupy about three distinct RUM views and its four HTML events about two; raw bot events are not affected-view counts. Datadog's `CARDINALITY` is approximate and may differ slightly from `COUNT` even where one error was observed per view. In the same fixed window, sampled Watch `@type:view` event counts for Chrome, Chrome Mobile, Mobile Safari and Safari were respectively **3,681 / 918 / 213 / 152**. These are RUM-indexed populations under a 50% session sample, not a complete user denominator or a reliable production incidence rate.

Detailed current-version events include HTML mismatches on no-autoplay Edge video routes at 22:13:44 and 21:56:33 and on Chrome `/watch` at 18:34; the completed feat-517 autoplay correction does not explain all HTML events. The available `error.file` and stack source-map into Next's compiled `react-dom-client.production.js`, without a leaf component or the server/client text difference. RUM's retained error/view fields include route, browser and version, but not the mismatched DOM content; inferring a component from React framework frames would be speculative. The next required artifact is one bounded, privacy-redacted SSR-versus-first-client DOM difference or source-mapped component stack from a matched affected route, cache, query, locale, timezone and persisted state. Only then add a failing regression and the smallest corresponding fix, with text and HTML variants verified separately.

## Owned browser attempt and disposition

An isolated worktree and named headed `agent-browser` 0.38.1 session were prepared for a single trace. Chrome 154 did not finish opening `about:blank` after more than 60 seconds; session inspection and graceful close timed out. Only the worker-owned daemon and Chrome process tree were stopped and confirmed gone. There was no Watch navigation, card click, production mutation or trace artifact. A synthetic browser pass cannot be inferred. The earlier Chrome 153 historical tests remain credited with their documented limitations. No runtime patch is justified by this continuation; all three tickets remain in progress.
