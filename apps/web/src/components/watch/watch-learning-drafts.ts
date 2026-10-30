"use client"

import { useSyncExternalStore } from "react"

export type WatchLearningDraftKey = {
  courseId: string
  contentVersion: string
  lessonId: string
  stepId: string
}
export type WatchLearningDraftStore = {
  get: (key: WatchLearningDraftKey) => string
  set: (key: WatchLearningDraftKey, value: string) => void
  subscribe: (listener: () => void) => () => void
  clear: () => void
}

/** Memory only. Never writes Web Storage, cookies, analytics or the network. */
export function createWatchLearningDraftStore(): WatchLearningDraftStore {
  const values = new Map<string, string>()
  const listeners = new Set<() => void>()
  const id = (key: WatchLearningDraftKey) =>
    JSON.stringify([key.courseId, key.contentVersion, key.lessonId, key.stepId])
  const notify = () => listeners.forEach((listener) => listener())
  return {
    get: (key) => values.get(id(key)) ?? "",
    set(key, value) {
      if ((values.get(id(key)) ?? "") === value) return
      if (value) values.set(id(key), value)
      else values.delete(id(key))
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      if (!values.size) return
      values.clear()
      notify()
    },
  }
}

// Shared by sheet/story mounts in this browser tab. U10 clears it on identity transitions.
export const watchLearningDrafts = createWatchLearningDraftStore()
export const WATCH_LEARNING_DRAFT_LABEL = "Only in this browser session"

export function useWatchLearningDraft(
  key: WatchLearningDraftKey,
  store = watchLearningDrafts,
) {
  const value = useSyncExternalStore(
    store.subscribe,
    () => store.get(key),
    () => "",
  )
  return [value, (next: string) => store.set(key, next)] as const
}
