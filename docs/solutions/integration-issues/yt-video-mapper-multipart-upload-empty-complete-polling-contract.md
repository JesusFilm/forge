---
title: "yt-video-mapper multipart uploads and empty matches must preserve the match-job contract"
date: 2026-07-02
category: integration-issues
module: apps/yt-video-mapper-backend
problem_type: integration_issue
component: service_object
symptoms:
  - "Multipart uploads from a normal file client returned zero candidates for bytes that should have matched"
  - "Polling a completed no-match job returned candidates only, so status-based clients kept waiting until their own timeout"
  - "Production job logs showed quick processing rather than a worker queue timeout"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - yt-video-mapper
  - match-jobs
  - multipart
  - raw-upload
  - polling
  - candidates
  - status-envelope
  - busboy
related_components:
  - background_job
  - testing_framework
  - documentation
---

# yt-video-mapper multipart uploads and empty matches must preserve the match-job contract

## Problem

Two API-boundary issues combined into one confusing production symptom. A client
posting `multipart/form-data` expected the mapper to hash the uploaded video
bytes, but the route treated the whole multipart envelope as the upload. When
the matcher found no candidates, the poll response returned only
`{ "candidates": [] }`, so clients that waited for an explicit terminal status
kept polling until they timed out.

## Symptoms

- Known-match media submitted through a multipart file client returned an empty
  candidate list.
- Small uploads appeared to "time out" from the caller's perspective even
  though the backend processed jobs quickly.
- No-match jobs were not distinguishable from an incomplete poll response when
  the caller used `status` as the terminal signal.

## What Didn't Work

- **Looking only for queue latency.** Production logs showed the worker was not
  stuck behind a long queue; the jobs were completing. The timeout was in the
  client polling contract, not the worker loop.
- **Replaying raw bytes only.** Raw request-body smoke could match correctly,
  but it did not recreate a `requests.post(..., files=...)` style upload. The
  failing path was the multipart envelope.
- **Treating zero candidates as an exceptional result.** A no-match outcome is
  still a completed attribution attempt. The candidate count cannot be used as
  the job-status indicator.

## Solution

Normalize the upload payload at the route boundary before creating a match job:

```text
Content-Type: video/* or application/octet-stream
  -> bounded raw request read

Content-Type: multipart/form-data; boundary=...
  -> stream through Busboy
  -> enforce an aggregate upload byte cap while parsing
  -> extract the first file part or media-typed part
  -> store those bytes as the Match Job upload
```

The multipart path accepts both standard file parts with a filename and
filename-less media parts whose content type is upload-like, such as
`video/mp4`, `audio/*`, `application/mp4`, or `application/octet-stream`.
Malformed multipart, missing boundaries, missing file/media parts, and over-cap
requests fail before a job row is created.

Keep the completed poll response explicit for both matches and no-matches:

```json
{
  "jobId": "match-job-id",
  "status": "complete",
  "candidates": []
}
```

This makes the terminal state independent from the number of candidates. A
client can stop polling on `status: "complete"` and then decide whether an empty
candidate list means no match, a low-confidence upload, or a product-level
fallback flow.

## Why This Works

Multipart is a transport envelope, not media evidence. Hashing the envelope
changes whenever the boundary, field names, or headers change, so the matcher
compares the wrong bytes and legitimately finds no signatures. Parsing the
envelope first restores the invariant that every Match Job stores media bytes,
regardless of whether the caller posted raw bytes or multipart form data.

The explicit completed envelope fixes the polling ambiguity. A completed job
with zero candidates is terminal in the same way a completed job with one
candidate is terminal; only the result payload differs.

Streaming the multipart parser behind an aggregate byte cap keeps malformed or
oversized multipart requests from forcing the service to buffer the whole
envelope. The selected upload is still buffered because the current storage
contract accepts bytes, so true streaming storage remains a future hardening
step.

## Prevention

- Cover raw upload and multipart upload with the same known-match assertion:
  both should return `status: "complete"` and the same candidate identity.
- Include a no-match regression where the stored candidates are empty but the
  poll response still includes `jobId` and `status: "complete"`.
- Test multipart shapes with a filename and without a filename when the part has
  a media content type.
- Test malformed multipart, missing boundary, missing file/media part, and
  over-cap multipart so parser failures do not create orphan jobs.
- After deploy, run a production smoke with the real client upload path and a
  known-match media fixture. Synthetic structural-byte tests prove the API
  contract, but they do not prove real-video extraction or future perceptual
  matching behavior.

## Related Issues

- [yt-video-mapper backend app durable match job upload poll process pattern](../platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md)
- [Mapper real match job signature retrieval pattern](../architecture-patterns/mapper-real-match-job-signature-retrieval-pattern.md)
- [Byte-cap buffered HTTP response reads to guard against OOM in a shared Node process](../best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md)
