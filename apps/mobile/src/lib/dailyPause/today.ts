// The day clock (KTD11): the one source of "today" for the Home card, the bell,
// the reminders, and the widget timeline, so that they cannot disagree. A run
// reads the day key and its devotional once, at Begin or Resume, and keeps them.
import { useMemo, useSyncExternalStore } from "react"
import { AppState, type NativeEventSubscription } from "react-native"

import { DEVOTIONALS, type Devotional } from "./devotionals"

const DAY_MS = 24 * 60 * 60 * 1000

/** The phone's local calendar day, `YYYY-MM-DD`. */
export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/** A local day that shows Pharisee. The two devotionals alternate from it. */
const ANCHOR_DAY = "2026-10-05"

/** It counts from the Y-M-D parts in UTC, where every day has 24 hours, so a
 *  daylight-saving change cannot move the count. */
function dayNumber(dayKey: string): number {
  const year = Number(dayKey.slice(0, 4))
  const month = Number(dayKey.slice(5, 7))
  const day = Number(dayKey.slice(8, 10))
  return Date.UTC(year, month - 1, day) / DAY_MS
}

/** R4: Pharisee and Lamp alternate by the local calendar day. */
export function devotionalForDay(dayKey: string): Devotional {
  const days = dayNumber(dayKey) - dayNumber(ANCHOR_DAY)
  return days % 2 === 0 ? DEVOTIONALS.pharisee : DEVOTIONALS.lamp
}

export type Today = { dayKey: string; devotional: Devotional }

const listeners = new Set<() => void>()
let midnightTimer: ReturnType<typeof setTimeout> | null = null
let appStateSubscription: NativeEventSubscription | null = null

function notify() {
  for (const listener of [...listeners]) listener()
}

function armMidnightTimer() {
  if (midnightTimer != null) clearTimeout(midnightTimer)
  const now = new Date()
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  )
  midnightTimer = setTimeout(() => {
    // An early fire finds the same day and arms again for the true midnight.
    armMidnightTimer()
    notify()
  }, midnight.getTime() - now.getTime())
}

/** One timer and one AppState listener serve every subscriber. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (appStateSubscription == null) {
    armMidnightTimer()
    appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return
      // The timer can sleep in the background, so the return re-arms it.
      armMidnightTimer()
      notify()
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    if (midnightTimer != null) clearTimeout(midnightTimer)
    midnightTimer = null
    appStateSubscription?.remove()
    appStateSubscription = null
  }
}

function getSnapshot(): string {
  return localDay(new Date())
}

/** Today's key and devotional. They change at local midnight, and when the app
 *  returns to active on a later day. */
export function useToday(): Today {
  const dayKey = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(
    () => ({ dayKey, devotional: devotionalForDay(dayKey) }),
    [dayKey],
  )
}
