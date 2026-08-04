/**
 * Real wiring for the progress sync orchestrator: Apollo operations,
 * AsyncStorage, and the auth session identity. Lazy singleton (the
 * apolloClient getter convention); everything behavioral lives in the
 * injected-deps modules this file only assembles.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"

import { getApolloClient } from "../apolloClient"
import { getAuthSession } from "../authSession"
import {
  GET_MY_WATCH_PROGRESS,
  UPSERT_MY_WATCH_PROGRESS,
} from "../watchProgressQueries"
import { enqueueProgressWrite } from "./queue"
import { createProgressSync, type ProgressSync } from "./sync"
import type { ProgressWriteIntent, WatchProgressEntry } from "./store"

export function getSignedInAccountId(): string | null {
  const snapshot = getAuthSession().getSnapshot()
  return snapshot.status === "signedIn" ? snapshot.user.id : null
}

function toEntry(row: {
  videoId?: string | null
  languageSlug?: string | null
  positionSeconds?: number | null
  durationSeconds?: number | null
  completed?: boolean | null
  updatedAt?: string | null
}): WatchProgressEntry | null {
  if (!row.videoId || row.positionSeconds == null || !row.durationSeconds) {
    return null
  }
  return {
    videoId: row.videoId,
    languageSlug: row.languageSlug ?? null,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    completed: row.completed ?? false,
    updatedAt: row.updatedAt ?? new Date(0).toISOString(),
  }
}

/** The upsert wire shape: recordedAt becomes the required updatedAt. */
export function toUpsertEntries(intents: readonly ProgressWriteIntent[]) {
  return intents.map((intent) => ({
    videoId: intent.videoId ?? null,
    videoSlug: intent.videoSlug ?? null,
    languageSlug: intent.languageSlug,
    positionSeconds: intent.positionSeconds,
    durationSeconds: intent.durationSeconds,
    updatedAt: intent.recordedAt,
  }))
}

let sync: ProgressSync | null = null

// Serializes offline-queue read-modify-writes so concurrent recorder ticks
// can't interleave AsyncStorage round-trips and drop each other's entries.
let queueChain: Promise<void> = Promise.resolve()

/** Fire-and-forget offline enqueue for the recorder's offline path (R7). */
export function enqueueOfflineWrite(
  accountId: string,
  write: ProgressWriteIntent,
): void {
  queueChain = queueChain
    .then(async () => {
      const current = await getProgressSync().loadQueue()
      await getProgressSync().saveQueue(
        enqueueProgressWrite(current, accountId, write),
      )
    })
    .catch(() => {
      // A failed persist loses one offline sample; the next tick re-records.
    })
}

export function getProgressSync(): ProgressSync {
  if (!sync) {
    sync = createProgressSync({
      getAccountId: getSignedInAccountId,
      fetchEntries: async () => {
        const result = await getApolloClient().query({
          query: GET_MY_WATCH_PROGRESS,
          fetchPolicy: "network-only",
        })
        const rows = result.data?.myWatchProgress ?? []
        return rows
          .map((row) => (row ? toEntry(row) : null))
          .filter((entry): entry is WatchProgressEntry => entry != null)
      },
      sendUpserts: async (intents) => {
        await getApolloClient().mutate({
          mutation: UPSERT_MY_WATCH_PROGRESS,
          variables: { entries: toUpsertEntries(intents) },
        })
      },
      storage: AsyncStorage,
    })
  }
  return sync
}
