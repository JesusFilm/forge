// The iOS widget's timeline (U14, KTD14): 14 local days from the day clock
// (KTD11). The writer rewrites it on foreground, on a day-record change, and at
// a new day, and it skips a timeline the widget already has.
import { useEffect } from "react"
import { AppState } from "react-native"
import type { WidgetTimelineEntry } from "expo-widgets"

import {
  dayFromRecord,
  getPauseProgressStore,
  type PauseDayRecord,
  type PauseProgressStore,
} from "./progress"
import { attachPassTriggers, createPassRunner } from "./passRunner"
import { devotionalForDay, localDay, onDay, useToday } from "./today"

/** The widget's `widgetURL`. `app/+native-intent.tsx` turns it into a curtain
 *  request. */
export const DAILY_PAUSE_WIDGET_URL = "forgemobile://daily-pause"

/** KTD14: one entry per local day, for this many days. */
export const DAILY_PAUSE_WIDGET_DAYS = 14

const LABEL = "DAILY BIBLE PAUSE"

/** The widget layout gets all of its text through these props. */
export type DailyPauseWidgetProps = {
  label: string
  question: string
  /** R9: the check beside the question. */
  done: boolean
  url: string
}

export type DailyPauseWidgetTimelineEntry =
  WidgetTimelineEntry<DailyPauseWidgetProps>

/** The slice of the `expo-widgets` widget that the writer uses. */
export type DailyPauseWidgetPort = {
  updateTimeline: (entries: DailyPauseWidgetTimelineEntry[]) => void
}

/** R38, R9: the 14 days from today with each day's question and done flag.
 *  Each entry starts at its local midnight. */
export function buildDailyPauseWidgetTimeline(
  nowMs: number,
  record: PauseDayRecord,
): DailyPauseWidgetTimelineEntry[] {
  const now = new Date(nowMs)
  return Array.from({ length: DAILY_PAUSE_WIDGET_DAYS }, (_, index) => {
    const date = onDay(now, index)
    const dayKey = localDay(date)
    return {
      date,
      props: {
        label: LABEL,
        question: devotionalForDay(dayKey).question,
        done: dayFromRecord(record, dayKey).done,
        url: DAILY_PAUSE_WIDGET_URL,
      },
    }
  })
}

export type DailyPauseWidgetWriterDeps = {
  widget: DailyPauseWidgetPort
  progress: Pick<PauseProgressStore, "getSnapshot" | "subscribe" | "hydrate">
  subscribeToAppState: (listener: (state: string) => void) => () => void
  now: () => number
}

export type DailyPauseWidgetWriter = {
  runPass: () => Promise<void>
  attach: () => () => void
}

export function createDailyPauseWidgetWriter(
  deps: DailyPauseWidgetWriterDeps,
): DailyPauseWidgetWriter {
  /** The timeline the widget has, so a pass with no change writes nothing. */
  let written: string | null = null

  async function runOnce(): Promise<void> {
    // The empty record reads as not done, so a pass before the read would
    // drop today's check for a moment.
    await deps.progress.hydrate()
    const entries = buildDailyPauseWidgetTimeline(
      deps.now(),
      deps.progress.getSnapshot(),
    )
    const key = JSON.stringify(
      entries.map((entry) => [entry.date.getTime(), entry.props]),
    )
    if (key === written) return
    deps.widget.updateTimeline(entries)
    written = key
  }

  const runPass = createPassRunner(runOnce)

  function attach(): () => void {
    return attachPassTriggers({
      runPass,
      subscribeToAppState: deps.subscribeToAppState,
      subscribeToStore: deps.progress.subscribe,
    })
  }

  return { runPass, attach }
}

/** Mounts the writer over the app's stores. A new day from the day clock
 *  attaches it again, and the attach writes the new day's timeline. */
export function DailyPauseWidgetTimeline({
  widget,
}: {
  widget: DailyPauseWidgetPort
}): null {
  const { dayKey } = useToday()

  useEffect(() => {
    return createDailyPauseWidgetWriter({
      widget,
      progress: getPauseProgressStore(),
      subscribeToAppState: (listener) => {
        const subscription = AppState.addEventListener("change", listener)
        return () => subscription.remove()
      },
      now: () => Date.now(),
    }).attach()
  }, [widget, dayKey])

  return null
}
