---
title: "Watch subtitle VTT proxy must remain public when downloads require accounts"
date: "2026-07-13"
last_updated: "2026-08-05"
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
  - "apps/web/src/lib/subtitle-target.ts"
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
gate. The browser sends only the Admin subtitle and playable Dub identifiers;
it never sends the upstream URL used by `fetch`. Resolve that URL server-side
from `videoDub(id) { videoEdition { subtitles } }`, and require that the Dub is
published, the subtitle belongs to that exact edition, and any subtitle owner
matches the Dub's Video.

```ts
function isAnonymousInlineSubtitleRequest(
  searchParams: URLSearchParams,
): boolean {
  if (searchParams.get("disposition") !== "inline") return false

  return Boolean(
    searchParams.get("subtitleId") && searchParams.get("variantId"),
  )
}
```

After server-side resolution, require the exact
`https://api-media-core.jesusfilm.org` origin, a queryless `.vtt` pathname, and
canonicalize every decoded path segment through `encodeURIComponent` after
rejecting dot, slash, and backslash segments. This is a real path-traversal
boundary and the URI-encoding sanitizer that CodeQL's request-forgery model
recognizes. Keep the route's generic URL allowlist and fail-closed public-DNS
pre-flight as layered defenses. Fetch the rebuilt Core URL with a 10-second timeout and
`redirect: "manual"`, then stream it through a hard 2 MiB limit. Do not trust
`Content-Length` alone: a missing or dishonest header must not allow an
unbounded buffer. Require a `WEBVTT` signature before returning the body as
same-origin `text/vtt` with `nosniff`.

```ts
const prefix = new TextDecoder()
  .decode(body.slice(0, Math.min(body.byteLength, 64)))
  .replace(/^\uFEFF/, "")
if (!/^WEBVTT(?:[\t \r\n]|$)/.test(prefix)) {
  return jsonError("Subtitle unavailable", 502)
}
```

Attachment requests, inline video requests, malformed URLs, and non-allowlisted
origins continue through the normal account gate.

## Why This Works

The route had two distinct responsibilities sharing one handler: protected file
downloads and same-origin delivery for a public browser text track. Applying the
download permission policy before classifying the request made the public media
consumer unreachable. Classifying the VTT path first restores that consumer,
while opaque identifiers remove the public URL-to-fetch dataflow. Server-side
edition/owner resolution, the exact origin and path, fail-closed DNS check,
redirect refusal, byte cap, signature, and response headers keep the exception
from widening into an anonymous download proxy. A same-origin endpoint that
merely redirects is not enough: the browser still applies CORS to the final
Core response.

## Prevention

- When adding authentication to a shared proxy, inventory every caller and
  separate protected attachment/download traffic from public in-page media.
- Browser subtitle proof must inspect `<track>.readyState`, `TextTrack.cues`, and
  the exact track request status; a rendered selector or injected track alone is
  not proof that cues loaded.
- Add regression cases for the allowed anonymous VTT request and for nearby
  denied shapes: inline video, VTT attachment, wildcard subdomains, DNS
  failure, redirects, declared and streamed overflow, and a 200 response
  without a WebVTT signature.
- Never pass a public query-string URL into the server-side VTT `fetch`, even
  behind allowlist and DNS checks. Resolve opaque content identity to the URL
  server-side, rebuild its queryless path from encoded safe segments, then
  preserve all origin, DNS, redirect, size, and signature defenses.

## Related Issues

- [SSRF defense for the Watch download proxy](../security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md)
- [Watch subtitle overlay must ignore Mux-generated tracks](./watch-subtitle-overlay-mux-generated-track-leak.md)
- [Watch caption defaults must be same-audio-language](./watch-caption-language-availability-20260615.md)
