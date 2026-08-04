/**
 * Viewer-scoped watch-progress operations (U4's admin surface). Operations
 * live in the app, never in the client package. The three operation NAMES
 * here are the exact set the user-JWT link admits (KTD10) — keep them in
 * lockstep with PROGRESS_OPERATION_NAMES in authHeaders.ts.
 */
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
      languageSlug
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
