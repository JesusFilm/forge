---
title: "Watch subtitle-only search results need separate availability and playback languages"
date: "2026-08-05"
category: "logic-errors"
module: "Watch search-to-playback handoff"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "A Russian subtitle-only search result linked to a nonexistent Russian audio route and returned 404"
  - "A playable audio route could select an edition that did not contain the requested subtitle VTT"
  - "Collection trailers lost subtitle intent even after a valid search handoff"
  - "Redirected Core VTT requests failed in browser text tracks because the upstream response lacked CORS headers"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/admin Watch search"
  - "Typesense Watch serving collections"
  - "apps/web routing and playback"
  - "Watch download and subtitle proxy"
tags:
  - "watch-search"
  - "subtitles"
  - "video-edition"
  - "typesense"
  - "language-routing"
  - "webvtt"
  - "collections"
  - "multilingual"
---

# Watch subtitle-only search results need separate availability and playback languages

## Problem

Watch search correctly found Russian subtitle evidence for `perfect-2`, but the
result used `russian` as its public Watch language segment. Public Watch routes
encode a playable Dub language, and this content has no Russian Dub, so the
route manifest correctly rejected `/perfect-2.html/russian.html`.

The visible `(AI-generated)` prefix was unrelated to the broken link. It is the
first cue in the Russian VTT and accurately describes that subtitle source. The
bug was collapsing the requested subtitle language and playable audio language
into one route field.

## Root Cause

The handoff has three distinct language roles:

- **Availability language**: what the viewer requested and can consume, such as
  Russian subtitles.
- **Action language**: the playable Dub encoded in the public Watch URL, such as
  Arabic, Modern Standard for the compatible `perfect-2` edition.
- **Evidence language**: the transcript or title language that matched the
  query.

Admin previously let a `target_subtitle` row reuse the availability slug as the
action slug. Search and route hydration also lacked a consistently preserved
`(videoId, videoEditionId, subtitle owner, action Dub)` tuple. That made it
possible to pair evidence, captions, and audio from incompatible editions or
sibling Videos.

Web had two additional seams. A force-static page could not safely consume a
request-specific query without a bounded route representation, and collection
pages render through `SeriesPageClient` rather than `WatchPageClient`. Finally,
redirecting a browser `<track>` to Core media did not work because the Core VTT
response did not include the cross-origin header the browser requires.

## Solution

### Keep availability and action independent

`target_subtitle` remains the availability kind and retains the requested
subtitle slug and display name. Its action is populated only by a published,
non-deleted, HLS-playable Dub on the same Video Edition as a usable VTT. The
public href uses that Dub's language slug. Web mapping keeps the action name
null for a subtitle-only match and presents the requested language through the
availability fields instead of relabeling the audio.

Use one deterministic selection policy everywhere: target audio first; for a
subtitle fallback, prefer the Video's primary audio language, then English,
then duration, language slug, and stable Dub ID. Never move to another edition
only because it has a longer Dub.

### Preserve the ownership tuple through DEFAULT and MODERN search

Subtitle eligibility requires:

- the same public Video and Video Edition as the action Dub;
- a nonblank VTT, not merely an SRT;
- a subtitle owner of either null (edition-wide) or the current Video; and
- published, non-deleted, playable content.

Typesense availability records and transcript documents therefore carry
edition identity. Semantic fusion keeps that identity atomic, availability
hydration is bounded and deterministic, and an old transcript alias without
`videoEditionId` is rebuilt rather than silently reused. Legacy availability
aliases may be retried only for a recognized compatibility failure such as a
404, not for arbitrary errors.

### Carry subtitle intent as bounded, one-shot route state

Search cards emit an audio-only public path plus `?subtitles=<requested-slug>`.
The proxy accepts one known public language slug, encodes it in a trusted
internal route segment, and adds a rewrite claim that the catch-all verifies.
This keeps static route keys bounded while preserving refresh, copied links,
modified clicks, and canonical redirects.

The selected page verifies that the server-carried slug still matches the
public query and an ownership-filtered subtitle. It then writes the explicit v2
translated-subtitle preference and removes only the consumed query with
`history.replaceState`. Invalid, duplicate, unknown, unavailable, or mismatched
intent is removed without inventing a fallback or overwriting a valid stored
preference.

Apply this contract to both rendering branches. Videos and episodes consume it
in `WatchPageClient`; collections consume it in `SeriesPageClient`, forward the
VTT into `SeriesHero`, and expose the same enable/disable state in
`LanguagePickerModal`.

### Serve VTT same-origin without creating an open proxy

The subtitle request uses the existing same-origin download endpoint, but only
the exact `https://api-media-core.jesusfilm.org` origin and a `.vtt` pathname
may enter the anonymous body path. The endpoint:

- fails closed on missing or private DNS answers;
- uses a 10-second timeout and refuses redirects;
- rejects a declared or streamed body larger than 2 MiB;
- requires a valid `WEBVTT` signature before caching; and
- returns `text/vtt` with `nosniff`.

All other media remains redirect-based. A wildcard origin allowlist or an
unbounded `arrayBuffer()` would turn a narrow caption transport into an SSRF or
memory-exhaustion surface.

## Verification

Cover the contract at each boundary:

- DEFAULT and MODERN return Russian `target_subtitle` availability with a
  same-edition playable action and preserve target-audio precedence.
- Real-Postgres coverage verifies DEFAULT and MODERN agree on edition and owner
  semantics rather than only matching mocked row shapes.
- Web mapping, URL serialization, proxy admission, catch-all routing, video
  playback, collection playback, and subtitle-picker state have focused tests.
- VTT tests cover exact-origin success, wildcard-origin redirect, DNS failure,
  redirect refusal, declared and chunked overflow, and invalid signatures.
- Browser proof for `perfect-2` reached the Arabic, Modern Standard route,
  consumed the Russian query, loaded 10 cues, and activated
  `Создай идеальную девушку!` at playback time 4.7 seconds.

## Prevention

- Treat availability, action, and evidence language as separate fields in every
  search contract.
- Treat Video Edition plus subtitle ownership as the synchronization boundary;
  do not recompute one member independently later in the pipeline.
- Do not weaken route-manifest admission to make a subtitle slug look like
  audio.
- Do not rely only on query parameters in force-static routes or expose
  unbounded internal cache-key variants.
- Test the actual browser track (`readyState`, cue count, active cue, and
  network status), not only the presence of a VTT URL in rendered data.

## Related

- [Public Watch URL contract](../conventions/public-watch-url-two-segment-contract-20260608.md)
- [Static locale rewrite and route-manifest admission](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md)
- [Next.js headers defeat the route cache](../web/nextjs-headers-defeats-route-cache.md)
- [Watch caption language availability](../ui-bugs/watch-caption-language-availability-20260615.md)
- [Watch subtitle VTT proxy account gate](../ui-bugs/watch-subtitle-vtt-proxy-account-gate.md)
- [SSRF defense for the Watch download proxy](../security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md)
- [Typesense Watch payload projection latency](../performance-issues/typesense-watch-search-payload-projection-latency.md)
- [Mocked shape versus real contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
