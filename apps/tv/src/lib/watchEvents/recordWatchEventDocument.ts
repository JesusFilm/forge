// The watch-event write document, alone in its own module.
//
// Split from `recordWatchEvent.ts` so the contract test can import the DOCUMENT
// without dragging in the Apollo client, which reaches the native Datadog SDK
// and cannot be parsed under jest. A GraphQL document is data; keeping it free
// of runtime dependencies is what makes its name assertable at all.
//
// Mirrors apps/web's `RecordWatchEvent` (`apps/web/src/lib/watch-event-actions.ts`)
// so both surfaces write the same shape into the same mutation.

import { adminGraphql } from "@forge/admin-graphql"

export const RECORD_WATCH_EVENT = adminGraphql(`
  mutation RecordWatchEvent(
    $videoId: ID!
    $videoDubId: ID
    $eventType: WatchEventType!
    $positionSeconds: Int
    $durationSeconds: Int
    $progress: Float
    $requestSessionId: String
    $occurredAt: String
  ) {
    recordWatchEvent(
      videoId: $videoId
      videoDubId: $videoDubId
      eventType: $eventType
      positionSeconds: $positionSeconds
      durationSeconds: $durationSeconds
      progress: $progress
      requestSessionId: $requestSessionId
      occurredAt: $occurredAt
    ) {
      id
    }
  }
`)
