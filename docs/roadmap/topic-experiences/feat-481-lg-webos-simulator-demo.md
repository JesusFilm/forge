---
id: "feat-481"
title: "LG webOS simulator demo"
owner: "ekkasit"
priority: "P2"
status: "complete"
start_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "web"
---

## Problem

The TV product has native Apple TV and Android TV targets, but no minimal LG
webOS proof that can be launched directly in the local webOS TV 26 Simulator.

## Entry Points — Read These First

1. `apps/webos-demo/appinfo.json` — webOS application metadata and simulator entry point.
2. `apps/webos-demo/index.html` — static TV home and real video playback surfaces.
3. `apps/webos-demo/app.js` — D-pad focus movement and demo interactions.
4. `apps/tv/CLAUDE.md` — established TV focus and 10-foot UI conventions.

## Grep These

- `data-focusable`
- `ArrowLeft`
- `webOS Back`
- `appinfo.json`

## What To Build

Create a dependency-free webOS web app with a cinematic Watch home screen,
remote-friendly focus treatment, directional navigation, selectable content,
and Shaka Player driving a real Mux HLS video with captions and remote-friendly
controls. Launch the app from its root directory in the webOS TV 26 Simulator.

## Constraints

- Keep the demo isolated from the production `apps/tv` React Native target.
- Do not add production APIs, authentication, analytics, or packaging work.
- Keep the app runnable without a build step.

## Verification

- Validate `appinfo.json` as JSON and confirm its referenced files exist.
- Run a static JavaScript syntax check.
- Launch `apps/webos-demo` in webOS TV 26 Simulator.
- Verify the rendered home screen, visible initial focus, D-pad movement, Shaka
  HLS loading, real video frames, captions, elapsed time, play/pause, and Back
  navigation in the simulator.

## Resolution

Vendored Shaka Player 5.2.8 and replaced the native MP4 proof with the real
JESUS Mux HLS stream. In webOS TV 26 Simulator 1.5.0, Shaka reported the
2:07:53 duration, decoded advancing video frames, selected the English WebVTT
track, toggled captions on/off, paused/resumed from the remote, and returned to
Home with Back. The player remains open and playing for inspection.
