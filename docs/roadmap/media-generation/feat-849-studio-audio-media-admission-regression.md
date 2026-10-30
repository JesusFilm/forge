---
id: "feat-849"
title: "Preserve preview media after timeline audio edits"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, audio, preview]
---

## Reproduction

Actual hosted `preview-sources` admission accepts the saved Bartimaeus project
but rejects the same document with a local `audioFade` object (`INVALID`). Logs
show footage/waveform HTTP 400 and preview HTTP 422. Presentation settings are
being sent to the older hosted source-admission schema.

## Scope

Project only audio presentation fields out of source-admission documents, keeping
full authoring/preview/render documents untouched. Preserve all source references,
source ranges, timing, tracks and authorization. Cover all Manager callers of
`preview-sources` including browser preview, filmstrips, waveforms and render
source materialization. Do not weaken validation or change save/render contracts.

## Verification

Read-only live reproduction with edited envelopes/amplified gain; actual service
regressions against a strict old admission validator; media decode/image checks;
scoped tests/lint/typecheck/format and loading behavior. Hosted saves of new audio
fields still require matching contracts through the normal deployment flow.

## Result

Added `studio-source-admission.ts` and used its projection at all five Manager
source-admission call sites. Original documents/audio settings are unchanged.

- Live reproduction: edited document rejected `INVALID` before the fix; same
  envelopes and +30 dB admitted successfully through the projection afterward.
- Real project recovery: five filmstrips (16 frames each; sampled images HTTP
  200), five HLS playlists HTTP 200, and six 256-peak waveforms with all peaks
  nonzero. Combined cold service check completed in 17.7 seconds.
- 33 source/media/render service tests pass, including three regressions observed
  failing before the fix. 11 preview-state/waveform identity tests also pass.
- Manager typecheck, scoped ESLint, formatting and diff checks pass.
- Existing remote preview fonts return HTTP 200 and HMR connects. Browser session
  lands at sign-in, so authenticated UI smoke is covered by live service checks
  rather than claiming a logged-in browser run. No additional browser requests,
  decoding or initialization introduced.

Durable notes: `docs/solutions/runtime-errors/studio-audio-envelope-gain.md`.
