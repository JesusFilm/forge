# Studio editor feedback regression

This fixture runs the real `StudioEditor`, `EditorSession`, inspector, timeline,
Player and shared composition. Only Next's link/lazy-loading wrappers and the
project/preview API transport are substituted. It uses synthetic HLS/MP4 media,
local session-storage persistence and no production credentials or project data.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile --filter @forge/manager... --filter @forge/admin... --filter @forge/shorts-worker...
npm install --prefix .tmp/browser-tools --no-package-lock playwright@1.61.1
# Requires a full FFmpeg build with libx264 and the HLS muxer.
# Set FFMPEG_PATH=/absolute/path/to/ffmpeg if it is not on PATH.
node docs/validation/studio-feedback/prepare-media.mjs
node docs/validation/studio-editor-feedback/serve.mjs
```

In another terminal:

```sh
# Uses /usr/bin/google-chrome by default; override CHROME_PATH if needed.
node docs/validation/studio-editor-feedback/check.mjs
node docs/validation/studio-editor-feedback/render-speed.mjs
```

The browser check asserts named/Text-grouped components, full-height vertical
Canvas, selection without dirtying, visible-caption dragging, live movement,
correct composition-coordinate persistence, untouched credit, undo/reopen,
pointer cancellation, renaming/classification persistence, no metadata-triggered
preview request, slowed playback/duration and speed-aware timeline trimming.

The render check produces MP4s and stills at 0.5x, 1x and 2x. Equivalent source
times must yield identical decoded PNG pixels. Video streams must contain
120/60/30 frames with durations 4/2/1 seconds. AAC may add container padding;
frame count and the video stream provide the timeline-duration assertions.
Outputs are ignored under `.tmp/studio-editor-feedback/`.

## Baseline and performance

Run a second server against an installed, unchanged `3795bf7cc` checkout:

```sh
STUDIO_QA_PORT=4181 STUDIO_QA_SOURCE_ROOT=/absolute/path/to/baseline node docs/validation/studio-editor-feedback/serve.mjs
node docs/validation/studio-editor-feedback/check.mjs http://127.0.0.1:4181
node docs/validation/studio-editor-feedback/performance.mjs
```

The baseline intentionally fails: full-frame hit targets select/move the credit
when the pointer is over Caption, live Caption movement is absent, custom labels
are generic, custom Caption is in Video, and speed is unavailable. Candidate
verification passes these behaviors. Baseline failure is expected, not a test
suite success.

Performance runs alternate six fresh browser contexts per version, measuring
DOMContentLoaded and first decoded-video readiness with 180ms media latency.
Recorded medians: baseline 372.8ms / 1334.6ms; candidate 360.5ms / 1289.6ms.
Development JS transfers were 5,653,093 / 5,634,116 bytes. No regression was
observed in this local comparison; these are fixture measurements, not production
Web Vitals or production bundle sizes. Manager retains its lazy Player boundary.
Do not edit source or regenerate media while collecting final browser evidence.

## Validation and limits

- Contracts: 46 tests; shared compositions: 73 tests; Manager editor: 28 tests;
  touched Admin command/speech tests: 8 tests.
- Admin, Manager, contracts and composition type checks pass. Touched source lint,
  contracts/composition lint, formatting and Manager production build pass.
- A run during media regeneration timed out waiting for a video element. A fresh
  server/browser pass with stable media passed all 20 assertions.
- Browser behavior and actual MP4/still speed parity use synthetic media. Arbitrary
  graphic-only custom components use a layer hit fallback rather than per-pixel alpha.
- No production project was changed or paid render submitted. The reported failed
  export is still unidentified and is tracked by feat-629; synthetic render success
  does not resolve that incident.
