---
title: Admin video picker must trim against the selected locale dub
date: 2026-07-21
category: logic-errors
module: admin
problem_type: logic_error
component: experience-editor
symptoms:
  - "Experience editor video picker preview used an arbitrary playable dub instead of the active experience locale"
  - "Clip start/end controls were computed against a dub whose duration could differ from the intended language"
root_cause: locale_fallback
resolution_type: code_fix
severity: medium
related_components:
  - media
  - video-dubs
  - experience-editor
tags:
  - admin
  - video-picker
  - dubs
  - locale
  - trimming
---

# Admin video picker must trim against the selected locale dub

## Problem

The admin experience editor video picker hydrated each video row with one
`previewStreamUrl`. That URL came from the first streamable dub in the fetched
dub list, so an editor working on an English experience could preview and trim a
different language. Since dub durations can differ, the clip range was tied to
the wrong media timeline.

## Solution

Hydrate editor video rows with a compact `playableDubs` list: dub id, localized
label, language slug, BCP-47 tag, stream URL, and dub-specific duration. The
picker now defaults to the active experience locale, lets editors choose another
audio language explicitly, and derives preview URL, trim duration, and saved
`streamingUrl` from the selected dub.

## Prevention

- Do not use "first playable" as the primary selection rule when the UI is
  authoring locale-sensitive media.
- If a control edits media timecodes, make the exact media variant visible and
  selectable in the same flow.
- Preserve old `streamingUrl` selections by matching the stored URL back to a
  dub option when reopening an existing block.
