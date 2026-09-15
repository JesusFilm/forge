> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Browser performance baseline

Isolated headless installed Google Chrome; loopback; no CPU/network throttling; fresh context and cleared HTTP cache for cold, same-context second document navigation for warm. Server already warm. Mock images.jesusfilm.org DNS disabled in isolated browser because seed URLs are placeholders; no request interception or cache-disabling routing. Three pairs per route. Auth issued by local fixture, no production credentials. Readiness is measured upper bound through an actual menu interaction, including automation overhead. 1000ms observation after interaction. No media fixture/seek baseline.

Chrome 152.0.7977.64, viewport 1440 x 1000, unchanged production build 5bd7bfb9.

Medians from three cold/warm pairs per route:

| Route                 | Cache | Load ms | Working controls upper bound ms | JS transfer bytes | Long task ms |
| --------------------- | ----- | ------: | ------------------------------: | ----------------: | -----------: |
| /dashboard/shorts     | cold  |   347.5 |                           592.8 |           255,902 |           53 |
| /dashboard/shorts     | warm  |    70.1 |                           292.4 |                 0 |            0 |
| /dashboard/shorts/new | cold  |   485.9 |                           982.5 |           772,091 |          360 |
| /dashboard/shorts/new | warm  |    88.2 |                           332.2 |                 0 |            0 |

Working-controls measurement requires a successful click of the user-menu button and a visible menu, not only DOM visibility; it includes Playwright dispatch/actionability overhead. Creation search was filled and the matching source row checked. CLS was zero throughout all 12 observation windows. Warm script transfer was zero with decoded script bytes retained, demonstrating browser cache reuse.

Raw Navigation/Resource Timing plus CDP request timing, transfer sizes, cache flags and failures are in browser-baseline.json. Only URL origins/paths and resource metadata are captured: no headers, cookies, signing keys, request or response bodies. Three seed-only image URLs fail DNS intentionally; requests are recorded as ERR_NAME_NOT_RESOLVED. There is no prepared legacy media in the mock store; video count is zero and seek baseline is unavailable. The new editor must still measure real-source preview readiness and decoded seek.

Screenshots: browser-list-cold.png, browser-list-warm.png, browser-create-cold.png, browser-create-warm.png. Reproducer: browser-baseline.mjs. All artifacts remain outside the repository. No implementation edits.

JS totals include script and preloaded-link initiators. The CDP waterfall also records Next.js dashboard route-prefetch cancellations (ERR_ABORTED); these are separate from the intentionally disabled mock-image DNS failures.
