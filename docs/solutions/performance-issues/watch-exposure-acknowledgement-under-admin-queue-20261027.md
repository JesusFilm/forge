---
title: "Keep Watch exposure identities until acknowledgement under slow Admin writes"
date: "2026-10-27"
category: "performance-issues"
module: "apps/web Watch recommendation events"
problem_type: "performance_issue"
component: "frontend"
severity: "high"
symptoms:
  - "Watch exposure API returns 503 while Admin mutation spans finish later"
  - "A browser retry can start before Web's Admin deadline"
root_cause: "timeout_order_and_unacknowledged_queue"
resolution_type: "code_change"
tags:
  - "recommendations"
  - "watch"
  - "idempotent-telemetry"
  - "latency-budget"
---

## Confirmed failure chain

In the 25 Oct 18:40–26 Oct 18:40 UTC window, recommendation event routes
returned 7,108 HTTP 503s, including 4,368 surface-exposure responses. A
retained playback trace shows Web's 3-second Admin deadline ending while Admin
is still executing its write. This is an event-recording failure, not evidence
that video playback failed. The write may have committed despite the failed
acknowledgement.

For exposure specifically, successful sampled Admin writes still had p50 1.415
seconds and p95 1.628 seconds on 27 Oct 01:40–02:00 UTC, above Web's 900 ms
upstream budget. Before the repair the browser aborted at 700 ms, then its
helper retried the same write after 100 ms. `WatchExposureBoundary` removed the
batch from its pending array before sending; after both attempts failed it had
no recovery path. The same component launched each ready batch concurrently.
Those client behaviors can multiply work at the exact time Admin is slow and
make event coverage unknowable.

The Admin main pool's ten connections were occupied and acquisitions queued,
while sampled SQL-call latency rose broadly. The cause of that shared database
slowdown remains unconfirmed. These observations do not attribute it to the
retention cleanup job or prove production recovery.

## Repair pattern

- Order each browser deadline after Web's upstream deadline plus bounded
  admission/transit headroom. Exposure uses 2 seconds upstream and 3 seconds
  browser-side, based on the sampled 1.63-second Admin p95. Surface delivery
  retains its 3-second upstream budget and gets a 4.5-second browser deadline;
  sampled successful Admin issuance p95 was 2.287 seconds during the incident.
- Send one exposure batch at a time and keep it in the pending queue until Web
  returns 200. Retry ambiguous failures with the exact same event IDs and
  bounded exponential backoff; Admin's unique `event_id` classifies a replay
  without creating a second row. Do not retry definitive 4xx rejections.
- Preserve navigation and playback independence: emission happens after load,
  fetches use `keepalive`, and neither click nor player waits for telemetry.

The bounded in-memory queue is still best-effort across a hard browser exit.
It drops stale facts before Admin's five-minute timestamp gate and marks the
coverage gap. A 200 acknowledges that Web obtained a non-null Admin mutation
result; it does not guarantee that a conflicting event ID was accepted.

## Verification and next evidence

Focused tests cover failed acknowledgement with stable-ID replay, serialized
batches, definitive rejection, deadline ordering, and the existing page-load,
BFCache, selection and bounded-batch behavior. Local tests and typecheck prove
the client mechanics, not a production latency reduction. After rollout compare
population Web 503 counts, Admin mutation latency and pool wait distributions,
and retry/duplicate counts in matched traffic windows. Keep the common
database slowdown investigation separate from this client repair.
