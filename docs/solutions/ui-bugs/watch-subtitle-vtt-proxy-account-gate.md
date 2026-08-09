---
title: "Watch subtitle VTT delivery must remain public and same-origin"
date: "2026-07-13"
last_updated: "2026-08-06"
category: docs/solutions/ui-bugs
module: apps/web
problem_type: ui_bug
component: authentication
symptoms:
  - "Selecting a subtitle creates the Forge text track, but the track enters error state with no cues"
  - "The same-origin inline VTT endpoint returns 401 or redirects the native text-track request to another origin"
  - "The upstream VTT succeeds in ordinary HTTP clients but does not grant cross-origin browser access"
  - "Production inspection shows the Forge track at readyState 3 with cues unavailable"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - "apps/web/src/app/api/download/route.ts"
  - "apps/web/src/components/watch/HeroPlayer.tsx"
  - "apps/web/src/components/watch/WatchPageClient.tsx"
tags:
  - "watch-page"
  - "subtitles"
  - "vtt"
  - "download-proxy"
  - "authentication"
  - "cors"
  - "same-origin"
  - "text-track"
---

# Watch subtitle VTT delivery must remain public and same-origin

## Problem

The Watch download endpoint serves two different browser consumers: protected
file downloads and public in-page WebVTT tracks. Treating both as ordinary
downloads broke subtitles in two separate ways.

First, applying the account gate before classifying the request returned `401`
to signed-out viewers. Later, redirecting every successful download away from
Web made the same-origin `<track>` URL return `302` to
`api-media-core.jesusfilm.org`. That upstream returned valid `200 text/vtt`, but
without `Access-Control-Allow-Origin`. Ordinary HTTP clients followed the
redirect and read the VTT, while the native text-track loader rejected the
cross-origin response and produced no cues.

The route therefore needs a narrow same-origin streaming path for public VTT
tracks. Normal media downloads must continue to redirect so Web does not carry
large video bodies.

## Symptoms

- The Forge-owned `<track>` existed with label `__forge_subtitle__`, but it had
  `readyState === 3` and `TextTrack.cues` was unavailable.
- In the account-gate regression, the same-origin track URL returned `401`
  before DNS resolution or an upstream request.
- In the redirect regression, the same-origin track URL returned `302`; the
  destination returned `200 text/vtt`, which made command-line checks appear
  healthy even though native browser loading failed CORS.
- Same-audio-language subtitles could appear healthy while a selected alternate
  track such as Simplified Chinese failed through the Forge-injected VTT path.

## What Didn't Work

- Debugging subtitle selection or the overlay did not address the failure. The
  selection and track injection had succeeded; delivery failed before cue
  parsing.
- Checking only that a VTT URL appeared in the page data was insufficient. The
  exact response chain for that URL determines whether native cues can load.
- Treating a successful direct request to the final VTT URL as browser proof
  was misleading. Server and command-line clients do not enforce the native
  text-track CORS boundary.
- Redirecting all downloads kept media bandwidth off Web, but a cross-origin
  redirect is not equivalent to same-origin `<track>` delivery when the target
  does not opt into CORS.
- Restoring the old general-purpose media proxy would fix subtitles at too high
  a cost. Video attachments should still redirect.
- Forwarding upstream `Content-Length` is unsafe because Node fetch may decode a
  content-encoded body while retaining metadata for the encoded byte count.

## Solution

Classify the public browser-only request before applying download authorization.
The exception requires `disposition=inline`, an allowlisted origin, and a URL
pathname ending in `.vtt`. Only that shape bypasses the account gate
(`apps/web/src/app/api/download/route.ts:46`,
`apps/web/src/app/api/download/route.ts:61`). Inline video, VTT attachments,
malformed URLs, and non-allowlisted origins stay on the protected path.

The request still crosses the full SSRF boundary. `validateTarget` enforces the
HTTPS allowlist, requires every IPv4 and IPv6 DNS answer to be public, and
reconstructs the safe origin, pathname, and query before any server-side fetch
(`apps/web/src/app/api/download/route.ts:231`).

For the classified request, `proxyInlineSubtitle` fetches upstream with only
`Accept: text/vtt`, combines client cancellation with a 30-second timeout, and
sets `redirect: "manual"` (`apps/web/src/app/api/download/route.ts:325`,
`apps/web/src/app/api/download/route.ts:346`). Browser cookies, authorization
headers, and session tokens are not forwarded. Redirects are rejected rather
than followed, non-success statuses are controlled, and successful responses
must have an exact normalized `text/vtt` media type and a body
(`apps/web/src/app/api/download/route.ts:364`,
`apps/web/src/app/api/download/route.ts:375`,
`apps/web/src/app/api/download/route.ts:383`,
`apps/web/src/app/api/download/route.ts:393`). Rejected response bodies are
cancelled so their connections can be released
(`apps/web/src/app/api/download/route.ts:293`).

The response stays streamed, and its timeout remains active until the body
finishes, errors, or is cancelled (`apps/web/src/app/api/download/route.ts:297`).
Web returns `Content-Disposition: inline`, the validated `Content-Type`,
no-store caching, and `X-Content-Type-Options: nosniff`
(`apps/web/src/app/api/download/route.ts:400`). It deliberately does not forward
upstream `Content-Encoding` or `Content-Length`, because those headers may
describe encoded bytes rather than the decoded stream.

The GET handler enters this path only for the auth-exempt inline VTT. Every
other download preserves the CDN redirect path
(`apps/web/src/app/api/download/route.ts:490`,
`apps/web/src/app/api/download/route.ts:513`).

Regression coverage mirrors the boundary:

- Same-origin VTT streaming and response headers:
  `apps/web/src/app/api/download/route.test.ts:242`.
- Whole-body timeout behavior:
  `apps/web/src/app/api/download/route.test.ts:279`.
- Redirect and non-VTT rejection:
  `apps/web/src/app/api/download/route.test.ts:317` and
  `apps/web/src/app/api/download/route.test.ts:342`.
- Fetch failure, client abort, upstream status, and missing body:
  `apps/web/src/app/api/download/route.test.ts:367` through
  `apps/web/src/app/api/download/route.test.ts:430`.
- Public VTT access and neighboring gated traffic:
  `apps/web/src/app/api/download/route.auth.test.ts:189` and
  `apps/web/src/app/api/download/route.auth.test.ts:216`.

## Why This Works

The browser now sees one origin for the full text-track request. Web fetches the
already validated VTT and streams it as the response to the original same-origin
URL, so the upstream does not need to grant browser CORS access. Native
`<track>` loading can parse the response and populate cues instead of ending at
`readyState === 3`.

The exception stays smaller than a general media proxy. Request shape,
allowlisted origin, public DNS resolution, reconstructed URL, manual redirect
handling, exact response media type, bounded lifetime, and credential isolation
must all agree before bytes are relayed. All other downloads retain the
low-bandwidth redirect contract.

## Prevention

- Before changing a shared media endpoint's authentication or transport model,
  inventory its consumers by browser primitive. `<a download>`, `<video>`, and
  `<track>` do not have interchangeable redirect and CORS behavior.
- For subtitle QA, inspect `<track>.readyState`, `TextTrack.cues`, the exact
  same-origin request, every redirect, and final response headers. A selector
  state or direct upstream `200` is not sufficient proof.
- Keep successful inline VTT, anonymous account-gate exemption, upstream
  redirect rejection, non-VTT rejection, whole-body timeout, abort, upstream
  failure, missing-body, and ordinary-download redirect cases together as one
  regression matrix.
- Do not relax the exception to all inline media or all `.vtt` paths. Preserve
  the allowlist, public-IP DNS preflight, URL reconstruction, manual redirect
  policy, exact `text/vtt` validation, and credential isolation.
- Do not forward `Content-Length` or `Content-Encoding` unless the proxy can
  prove those values describe the emitted byte stream.
- Re-test both signed-out and signed-in playback when changing the account gate,
  because public subtitles share a route with protected downloads.

## Related Issues

- [SSRF defense for the Watch download proxy](../security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md)
- [Watch subtitle overlay must ignore Mux-generated tracks](./watch-subtitle-overlay-mux-generated-track-leak.md)
- [Watch caption defaults must be same-audio-language](./watch-caption-language-availability-20260615.md)
- [FGE-67 implementation record](../../roadmap/media-generation/feat-341-watch-alternate-subtitle-track-loading.md)
