# Portal session recovery: local page-load check

On 30 September 2026, a Chromium headless browser loaded the portal through
the isolated HTTPS development server and synthetic local admission. The same
server and browser alternately received the pre-change and candidate
`portal.js` asset. After one warm-up, each variant had six authenticated
navigations at 1280×900. No issued key or credential entered the measurements.

| Metric                               |  Before |   After |
| ------------------------------------ | ------: | ------: |
| Initial requests, including document |       9 |       9 |
| `portal.js` decoded bytes            |  21,633 |  28,871 |
| Median DOMContentLoaded              | 35.8 ms | 33.2 ms |
| Median load                          | 50.3 ms | 47.2 ms |

The measured candidate added 7,238 decoded JavaScript bytes but no initial
request. Moving Usage date validation into its deferred module subsequently
reduced the initial script to 28,485 bytes.
The observed timing differences are smaller than run-to-run variation and do
not establish a production speedup. The full browser suite's authenticated
navigation used 139,437 decoded bytes across the page and same-origin
resources, below its 140,000-byte guard. A separate browser check observes no
passive renewal request and one coalesced request after rapid visible input.
Admission still performs live GitHub checks; this local setup does not measure
that external latency.
