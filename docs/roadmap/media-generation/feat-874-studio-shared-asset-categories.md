---
id: "feat-874"
title: "Separate shared assets by media type"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Add Images, Videos and Audio filters inside Shared assets in
`apps/manager/src/features/video-studio/library.tsx`. Filter the existing retained
asset response by MIME type without making additional requests when switching
filters. Give each type matching search, empty and upload copy. Preserve image
and audio insertion. Retained video files are browse-only: the timeline video
contract requires a captured catalog source; do not manufacture source identities
or insert videos as images. Explain this in the Videos view.

## Verification

Focused workspace and deferred-loading tests, lint, format and diff checks.
Confirm switching filters does not fetch assets again or initiate video/image
preview transfers for hidden categories.

## Result

Shared assets now contains Images, Videos and Audio filters. Matching MIME types
alone render in each view; image/audio upload acceptance and search/empty copy
follow the active category. Changing categories clears selection and reuses the
loaded response without a request or timer restart. Videos display as browse-only
cards with guidance to Source library; no image-preview transfer or invalid
image insertion is attempted for a video.

All ten workspace/loading tests pass. The new mixed-media case checks filtering,
upload acceptance, video drag/insertion prevention and stable request counts
across category switches. Existing loading tests confirm the library remains
absent from initial editor loading; no asset fetch occurs before Media intent.
This is request-count evidence for the change’s loading impact. Lint, formatting
and diff checks pass; the public preview responds HTTP 200.
