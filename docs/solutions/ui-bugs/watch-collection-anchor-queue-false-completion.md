---
title: "Watch collection anchor queues can report false completion"
date: "2026-09-04"
category: "ui-bugs"
module: "apps/web Watch collection downloads"
problem_type: "ui_bug"
component: "download_queue"
symptoms:
  - "A collection modal reports every episode finished while the browser saved only a subset."
  - "Missing episodes have valid downloadable renditions and resolve individually."
  - "Large collections create a burst of overlapping opaque-ID lookups."
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web download resolver"
  - "Mux static MP4 downloads"
tags:
  - "watch"
  - "downloads"
  - "collections"
  - "browser"
  - "file-system-access"
  - "capability"
  - "redirect"
---

# Watch collection anchor queues can report false completion

## Problem

The redirect-era collection queue called `HTMLAnchorElement.click()`, marked the
episode complete synchronously, waited 750 ms, and repeated. An anchor click is
only a request to the browser download manager: it does not confirm that the
browser accepted the download, that the same-origin resolver returned a
redirect, or that the file reached disk.

Every anchor also made `/watch/api/download` repeat the Admin lookup that the
collection server action had just performed. On a 33-episode collection, this
created 33 overlapping lookups while the UI still claimed immediate success.

## Evidence

- The reported run saved 22 of 33 files, with gaps among otherwise valid
  episode numbers.
- A production-shaped Admin query confirmed all 33 English 270p renditions
  were published, downloadable, and backed by distinct Mux MP4 targets.
- Before the fix, sampled opaque-ID route requests took about 15 seconds while
  the client launched another request every 750 ms.
- Browser smoke showed a second anchor could be held before its GET ever
  reached Web even though the modal had already incremented to `2 of 33`.
- Mux MP4 responses expose CORS and range headers, so a Chromium browser can
  stream the response directly to a selected directory without Web proxying
  the media bytes.

## Solution

The lazy collection lookup now encrypts each validated target and its event
metadata into a one-day, identifier-bound capability. Every start or retry
refreshes the batch, and an enabled account gate binds capabilities to the
authenticated subject. The browser receives only that opaque capability; raw
CDN URLs remain absent from rendered markup and server-action output.
`/watch/api/download` decrypts a matching capability, reapplies account gating,
origin allowlisting, and DNS validation, and redirects without another Admin
lookup.

On browsers with File System Access support, **Download all** asks for one
directory and streams each response into its file sequentially. An episode is
complete only after `pipeTo()` closes the writable file, so concurrency remains
one. Existing filenames receive a numeric suffix, and cancellation or write
failure removes the new partial entry before preserving all unfinished episode
IDs for retry.

The native-download fallback cannot observe browser-manager completion. It now
performs an authenticated `HEAD` acknowledgement before each anchor, reports
resolver failures, and preserves the current plus all unstarted items when the
session expires. If a directory response becomes unreadable before file
creation, the current and remaining items demote to this native handoff path
without losing prior verified writes. Its UI describes browser handoff, not
guaranteed disk completion.

## Prevention

- Never use an anchor click as a completed-transfer signal.
- Refresh an intent-time batch lookup before each start or retry when a redirect
  route would otherwise repeat per-item discovery or replay expired URLs.
- Keep capability claims bound to the visible opaque IDs and reapply auth and
  SSRF checks at consumption time.
- Prefer stream-to-directory for multi-file downloads when the upstream allows
  CORS; avoid buffering a collection-sized Blob or proxying media through Web.
- Test the directory path for maximum concurrency one, collision handling, and
  partial cleanup; test the fallback path for HEAD-before-anchor ordering and
  authentication expiry for pending-only retry.
