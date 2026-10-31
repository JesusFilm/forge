---
title: "Require subtitle artifacts before execution success"
module: "Mastra and Manager"
date: "2026-10-28"
problem_type: "integration_issue"
tags:
  - "subtitles"
  - "mastra"
  - "artifacts"
  - "workflow"
---

## Problem

PR #886's prototype emitted successful transcription, translation and Mux
publication callbacks without executing those operations. Current main already
had real translation, but accepted an empty stored transcript and wrote empty
subtitles as a successful language result.

## Resolution

`apps/mastra/src/services/subtitle-enrichment/source.ts` exports
`runSubtitleSource`. Explicit source modes reuse approved transcript/VTT
artifacts or acquire matching ready/generated Mux subtitles. Nonempty timed
segments, finite timestamps, positive cue duration and source language are
validated before artifact writes. Approved transcript reuse preserves routing
and correction metadata; approved VTT reuse preserves its bytes. Invalid
approved artifacts fail instead of silently falling back to another provider.

The existing `/forge-subtitle-enrichment` contract accepts optional `source`.
Its compact source summary contains exact canonical artifact keys and survives
subsequent translation failure. Omitting `source` preserves translation-only
callers. Manager validates returned source identity before accepting it.

Mux acquisition uses fixed provider origins, rejects redirects, bounds streamed
responses and polling, supports signed playback, and keeps API credentials out
of playback fetches and error messages. Any matching preparing subtitle track
is polled before considering paid generation, including uploaded tracks in
languages Mux cannot generate. Only matching ready subtitle tracks are read;
other languages, caption tracks, deleted tracks and errored tracks do not
qualify as ready or preparing. Explicit source acquisition can wait up to 15 minutes; Manager's
default source-Mux call budget adds the existing five-minute translation
budget. An explicit caller timeout still takes precedence.

Manager retains canonical job state, run-bound callback admission/idempotency
and Mux publication. Source helpers are execution primitives, not a second
admission or asynchronous lifecycle layer. PR #1087 integrates them into the
admitted graph. ElevenLabs is not an advertised source mode; callers must use
the existing supported path or report unsupported selection honestly.

## Verification and limits

Tests write/read actual local `transcript.json`, `subtitles.vtt`,
`subtitles-es.vtt` and `translation-es.json`. Provider acquisition and
translation adapters are deterministic; these tests do not prove live provider
behavior or production S3/Mux publication. Parent integration owns the final
Manager Coverage/job-detail, callback, publication and Studio/operator smoke.

Changing the shared transcript validator changes production translation
semantics. Include that validator in the subtitle Lab workflow-policy byte pin
and update both Mastra and Manager pins together; preserve frozen historical
run evidence rather than rewriting persisted reports.

## Review repair: parser failures versus read failures

The VTT parser throws ordinary `Error` instances for missing headers, empty
cues and malformed timestamps. Catch errors around synchronous content parsing
and timed-segment validation, rather than classifying by error class across
artifact reads. Invalid approved content returns `source_invalid` with
`retryable: false`; storage/network acquisition failures stay `source_failed`
with `retryable: true`, even when a storage adapter throws `SyntaxError`.
Neither case falls through to translation, Mux acquisition or artifact writes.

Local HTTP regression tests exercise source-only bearer-authenticated requests:
malformed content maps to HTTP 400 and transient artifact reads map to HTTP 502. Mux regressions transition uploaded English/Arabic tracks from preparing
to ready with zero generation POSTs, and retain bounded polling and signed
playback coverage. These source helpers are outside the ordered subtitle Lab
workflow-policy byte pin; this source-only repair preserves digest
`3e46dd8c3b82e3b32560d5a645c08f5b2795284e3cc997b50cc68a96dc243f62`
and the corresponding Manager literals. The provider-spend file and expanded
graph pin are deferred to PR1087.
