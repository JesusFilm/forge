---
title: "Watch subtitle VTT proxy must remain public when downloads require accounts"
date: "2026-07-13"
category: docs/solutions/ui-bugs
module: apps/web
problem_type: ui_bug
component: authentication
symptoms:
  - "Enabling subtitles creates the Forge text track, but the track enters error state with zero cues"
  - "The same-origin subtitle URL returns 401 Authentication required for signed-out viewers"
  - "The Admin-backed VTT exists and loads directly, but no custom subtitle overlay renders"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - "apps/web/src/app/api/download/route.ts"
  - "apps/web/src/components/watch/WatchPageClient.tsx"
tags:
  - "watch-page"
  - "subtitles"
  - "vtt"
  - "download-proxy"
  - "authentication"
  - "text-track"
---

# Watch subtitle VTT proxy must remain public when downloads require accounts

## Problem

Signed-out viewers could enable an Admin-backed subtitle on a single-video Watch
page, but the video never produced subtitle cues. The client correctly injected
the Forge-owned track; its same-origin VTT URL was routed through the download
proxy, whose account gate rejected every anonymous request before fetching the
subtitle.

## Symptoms

- The Forge `TextTrack` existed with label `__forge_subtitle__`, but its
  associated `<track>` had `readyState === 3` and `cues.length === 0`.
- Fetching the exact track URL returned `401` with
  `{"error":"Authentication required"}`.
- Fetching the upstream `api-media-core.jesusfilm.org` asset returned a valid
  `200 text/vtt` response.

## What Didn't Work

- Treating the symptom as a subtitle-selection or overlay bug was misleading.
  The modal selection, Forge track identity, and overlay listener were already
  correct; the browser could not load any cues.
- Verifying only that the VTT URL appeared in the RSC payload was insufficient.
  A valid URL can still fail at the same-origin proxy boundary.

## Solution

Classify the one public in-page consumer before applying the download account
gate. The exception is intentionally narrow: `disposition=inline`, an
allowlisted HTTPS origin, and a `.vtt` pathname.

```ts
function isAnonymousInlineSubtitleRequest(
  searchParams: URLSearchParams,
): boolean {
  if (searchParams.get("disposition") !== "inline") return false

  const target = searchParams.get("url")
  if (!target || !isAllowedDownloadOrigin(target)) return false

  try {
    return new URL(target).pathname.toLowerCase().endsWith(".vtt")
  } catch {
    return false
  }
}
```

Keep the route's existing URL validation, DNS pre-flight, manual redirect
handling, bounded headers, and timeout. After the upstream responds, require its
normalized media type to be `text/vtt`; a `.vtt` pathname must not become a way
to proxy video or another media type without an account.

```ts
const upstreamMediaType = upstream.headers
  .get("content-type")
  ?.split(";", 1)[0]
  ?.trim()
  .toLowerCase()

if (anonymousInlineSubtitleRequest && upstreamMediaType !== "text/vtt") {
  return jsonError("Upstream subtitle response was not VTT", 502)
}
```

Attachment requests, inline video requests, malformed URLs, and non-allowlisted
origins continue through the normal account gate.

## Why This Works

The route had two distinct responsibilities sharing one handler: protected file
downloads and same-origin delivery for a public browser text track. Applying the
download permission policy before classifying the request made the public media
consumer unreachable. Classifying the VTT path first restores that consumer,
while the path, origin, response media type, and existing SSRF checks keep the
exception from widening into an anonymous download proxy.

## Prevention

- When adding authentication to a shared proxy, inventory every caller and
  separate protected attachment/download traffic from public in-page media.
- Browser subtitle proof must inspect `<track>.readyState`, `TextTrack.cues`, and
  the exact track request status; a rendered selector or injected track alone is
  not proof that cues loaded.
- Add regression cases for the allowed anonymous VTT request and for nearby
  denied shapes: inline video, VTT attachment, and a `.vtt` URL whose upstream
  response is not `text/vtt`.
- Preserve all existing SSRF defenses when changing auth order around a
  user-provided media URL.

## Related Issues

- [SSRF defense for the Watch download proxy](../security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md)
- [Watch subtitle overlay must ignore Mux-generated tracks](./watch-subtitle-overlay-mux-generated-track-leak.md)
- [Watch caption defaults must be same-audio-language](./watch-caption-language-availability-20260615.md)
