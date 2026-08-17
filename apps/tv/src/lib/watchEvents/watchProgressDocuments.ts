// The viewer-scoped watch-progress documents, alone in their own module.
//
// Split from `watchProgressSync.ts` for the same reason `recordWatchEventDocument.ts`
// exists: the contract test imports the DOCUMENTS without dragging in the
// Apollo client (which reaches the native Datadog SDK and cannot be parsed
// under jest). A GraphQL document is data; keeping it free of runtime
// dependencies is what makes its name assertable at all.
//
// SYNC: mirrors apps/mobile/src/lib/watchProgressQueries.ts — same operation
// names, same field sets — so TV and mobile read/write the same account rows
// through the same mutation. The operation NAMES are load-bearing:
// `USER_TOKEN_OPERATIONS` in authHeaders.ts allowlists the signed-in bearer by
// name, so a rename here detaches the credential and every call lands
// anonymous (the #1622 rename trap, one credential over).

import { adminGraphql } from "@forge/admin-graphql"

export const GET_MY_WATCH_PROGRESS = adminGraphql(`
  query MyWatchProgress {
    myWatchProgress {
      videoId
      languageSlug
      positionSeconds
      durationSeconds
      completed
      updatedAt
    }
  }
`)

export const UPSERT_MY_WATCH_PROGRESS = adminGraphql(`
  mutation UpsertMyWatchProgress($entries: [WatchProgressUpsertInput!]!) {
    upsertMyWatchProgress(entries: $entries) {
      videoId
      positionSeconds
      durationSeconds
      completed
      updatedAt
    }
  }
`)

export const CLEAR_MY_WATCH_PROGRESS = adminGraphql(`
  mutation ClearMyWatchProgress($videoId: ID!) {
    clearMyWatchProgress(videoId: $videoId)
  }
`)
