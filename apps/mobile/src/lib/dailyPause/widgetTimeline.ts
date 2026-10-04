// The iOS widget's timeline (U14, KTD14): 14 local days from the day clock
// (KTD11), or one "Turned off" entry. The writer rewrites it on foreground, on a
// settings or day-record change (a Share marks the day done), and at a new day.
import { useEffect } from "react"
import { AppState } from "react-native"
import type { WidgetTimelineEntry } from "expo-widgets"

import {
  dayFromRecord,
  getPauseProgressStore,
  type PauseDayRecord,
  type PauseProgressStore,
} from "./progress"
import { getPauseSettingsStore, type PauseSettingsStore } from "./settings"
import { devotionalForDay, localDay, useToday } from "./today"

/** The widget's `widgetURL`. `app/+native-intent.tsx` turns it into a curtain
 *  request. */
export const DAILY_PAUSE_WIDGET_URL = "forgemobile://daily-pause"

/** KTD14: one entry per local day, for this many days. */
export const DAILY_PAUSE_WIDGET_DAYS = 14

const LABEL = "DAILY BIBLE PAUSE"
/** R38. */
const TURNED_OFF = "Turned off"

/** The widget layout gets all of its text through these props. */
export type DailyPauseWidgetProps =
  | {
      state: "question"
      label: string
      question: string
      /** R9: the check beside the question. */
      done: boolean
      url: string
    }
  | { state: "off"; label: string; message: string; url: string }

export type DailyPauseWidgetTimelineEntry =
  WidgetTimelineEntry<DailyPauseWidgetProps>

/** The slice of the `expo-widgets` widget that the writer uses. */
export type DailyPauseWidgetPort = {
  updateTimeline: (entries: DailyPauseWidgetTimelineEntry[]) => void
}

/** Whole calendar days from `day`. Added milliseconds would move the entry off
 *  midnight across a daylight-saving change. */
function midnightAfter(day: Date, offset: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset)
}

/** R38, R9: the 14 days from today with each day's question and done flag, or
 *  one "Turned off" entry. Each entry starts at its local midnight. */
export function buildDailyPauseWidgetTimeline(
  nowMs: number,
  widgetOn: boolean,
  record: PauseDayRecord,
): DailyPauseWidgetTimelineEntry[] {
  const now = new Date(nowMs)
  if (!widgetOn) {
    return [
      {
        date: midnightAfter(now, 0),
        props: {
          state: "off",
          label: LABEL,
          message: TURNED_OFF,
          url: DAILY_PAUSE_WIDGET_URL,
        },
      },
    ]
  }
  return Array.from({ length: DAILY_PAUSE_WIDGET_DAYS }, (_, index) => {
    const date = midnightAfter(now, index)
    const dayKey = localDay(date)
    return {
      date,
      props: {
        state: "question",
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
  settings: Pick<PauseSettingsStore, "getSnapshot" | "subscribe" | "hydrate">
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
  /** The read, the build, and the write are one synchronous step after the
   *  waits, so the last pass to finish writes the latest state. */
  async function runPass(): Promise<void> {
    // The defaults read as off, so a pass before the reads would write
    // "Turned off" over a switch that is on.
    await Promise.all([deps.settings.hydrate(), deps.progress.hydrate()])
    deps.widget.updateTimeline(
      buildDailyPauseWidgetTimeline(
        deps.now(),
        deps.settings.getSnapshot().widgetOn,
        deps.progress.getSnapshot(),
      ),
    )
  }

  function attach(): () => void {
    const unsubscribeAppState = deps.subscribeToAppState((state) => {
      if (state === "active") void runPass()
    })
    const unsubscribeSettings = deps.settings.subscribe(() => {
      void runPass()
    })
    const unsubscribeProgress = deps.progress.subscribe(() => {
      void runPass()
    })
    void runPass()
    return () => {
      unsubscribeAppState()
      unsubscribeSettings()
      unsubscribeProgress()
    }
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
      settings: getPauseSettingsStore(),
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
