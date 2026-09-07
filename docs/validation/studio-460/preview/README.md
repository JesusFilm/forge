# Shared preview runtime regression — interim evidence

The Studio composition moved into `packages/shorts-compositions/src/studio` so
preview and render use the same timeline mapping. The fixed base is `4ee4f716`.
This evidence covers the production preview host and browser runtime, not the full
Manager NLE or Watch. Those final release checks remain outstanding.

## Matched browser comparison

The retained harness uses the same Chrome installation, viewport, fixture bytes,
iframe policy (`allow-scripts`, `allow=autoplay`, opaque origin), local ports and
installed dependencies for baseline and changed builds. The baseline client is
loaded from the fixed commit into the original source path by the build harness;
this avoids changing esbuild's module identities merely by copying the entry
outside the repository. The baseline server remains the original fixed-commit
server. No sibling fixture service or database is used. The source bytes are
read-only copies of the reviewed 458 codec fixture; WAV audio is locally generated.

Three fresh browser contexts per version each run one cold navigation and one
subsequent warm navigation. Median milliseconds:

| Metric                  | Baseline cold | Changed cold | Baseline warm | Changed warm |
| ----------------------- | ------------: | -----------: | ------------: | -----------: |
| Preview ready           |         422.6 |        410.6 |         164.2 |        168.5 |
| Video and audio decoded |         590.8 |        581.5 |         307.1 |        301.8 |

The matched baseline client is 1,498,783 raw / 417,916 gzip bytes. The changed
client is 1,499,129 raw / 417,660 gzip bytes (346 raw bytes more, 256 gzip bytes
less). Historical 456 measurements used a different build context and are not
substituted for this matched baseline. These small local samples show no material
loading regression; they are not a production latency distribution. Resource
Timing's zero transfer/body sizes in the opaque cross-origin frame are privacy
restrictions and are **not evidence of cache hits**.

Every changed sample verifies decoded HLS, parent-DOM denial in custom code,
frame-15 seeking, live declared text controls, subsequent playback and session
release returning 410. Nonzero audio `sourceStartMs=250` plus the frame-15 seek
requires audio time at least 0.75s. Changed playback reports approximately
0.78–0.82s with gain 0.5. Baseline reports time zero despite the requested offset,
and Remotion logs its non-seekable-media warning. Exact seekable interval values
are retained in `measurements.json`; do not infer usability from interval count.

## Retained-media Range correction

The original host returned only full 200 responses. It now advertises byte ranges
and supports one bounded, open-ended or suffix GET range with 206 and correct
Content-Range/Length. HEAD describes the full object without a body, ignoring
Range as required for non-GET requests. Unsatisfiable, malformed, oversized and
multiple ranges return an empty 416 response. Responses use a zero-copy buffer
slice; no multipart expansion or additional full-asset buffer is created.

Session capability, expiry and exact filename lookup run before Range handling.
The real HTTP test covers staging authority, renewal/expiry/release, valid and
invalid ranges, HEAD and revocation. Range handling never extends session life.

An early browser harness used bare `command()` in an inline button handler;
HTMLButtonElement's own `command` property shadowed that function. Its apparent
playback stall was a **harness error**, corrected to `window.command()` before
these final measurements. It is not attributed to the product. The independently
reproduced baseline audio offset failure and its correction remain demonstrated.

Run `pnpm --filter @forge/studio-preview test src/server.test.ts` for the native
HTTP regression. The browser harness records exact disposable paths/ports; it is
not a production run script and contains no production credentials. Full NLE
watchdog/undo and final Watch performance evidence must be added before release.
