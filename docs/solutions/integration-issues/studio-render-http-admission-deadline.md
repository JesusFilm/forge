---
module: "Studio render execution"
tags: ["http", "timeouts", "render", "undici"]
problem_type: "integration_issue"
---

# Executor silence must use the admission deadline

Manager permits a 920-second render HTTP request, while the contained executor
can work for 900 seconds before sending response headers. Node global `fetch`
uses Undici, whose separate default header deadline is 300 seconds. A longer
AbortSignal does not extend that parser deadline. A legitimate long render can
therefore lose its transport and be cancelled before its admission expires.

`apps/manager/src/services/studio-render-http.ts` uses Node's built-in HTTP/HTTPS
request for this private exchange only. The caller validates the fixed operator
origin, sets the overall signal, and retains the five-second health deadline.
There are no redirects, retries, pooled sockets or separate idle deadlines.
Streaming remains bounded by the existing response byte limits and exact
binding/digest/codec checks in `studio-render-execution.ts`. Aborting before
headers or while reading output destroys the native request; cancelling the web
reader destroys the underlying response stream.

Five local HTTP regression tests cover delayed headers and body gaps, deadline
before headers, parent cancellation during the body, redirect rejection, and
reader cancellation/socket cleanup. Three existing signed-render transport tests
retain signature, lease, private-origin and output-integrity coverage. The bounded
deadlines exercise semantics without a five-minute test. A separate local
differential probe delayed headers 1500ms with a 4000ms overall signal: an installed
Undici Client with 250ms headersTimeout failed `UND_ERR_HEADERS_TIMEOUT`; the native
helper received 200 and the complete body under the same overall deadline. An
initial 25ms/100ms probe did not fail because parser timers are coarse; the longer
bounded probe avoids claiming millisecond precision. This transport change
is independent of contained FFmpeg thread limits and does not prove a real
900-second render or deployment-network behavior.

Sources: [Undici Client timeout defaults](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md),
[Node HTTP AbortSignal behavior](https://nodejs.org/api/http.html).
