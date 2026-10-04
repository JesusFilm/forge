import { useSyncExternalStore } from "react"

import { localDay, useToday } from "./dailyPause/today"

export type Announcement = {
  id: string
  kind: "daily-devotional"
  title: string
  /** The local calendar day an admin scheduled it for, `YYYY-MM-DD`. */
  publishedOn: string
}

export type AnnouncementItem = Announcement & { unread: boolean }

/** Mockup source: today's devotional only. Admin's announcements query will
 *  replace this; the read state below stays in memory until then. */
function mockAnnouncements(today: string): Announcement[] {
  return [
    {
      id: `daily-devotional-${today}`,
      kind: "daily-devotional",
      title: "Your daily devotional video is ready to watch.",
      publishedOn: today,
    },
  ]
}

const readIds = new Set<string>()
let revision = 0
const listeners = new Set<() => void>()

export function markAnnouncementRead(id: string): void {
  if (readIds.has(id)) return
  readIds.add(id)
  revision += 1
  listeners.forEach((listener) => listener())
}

/** Opening today's pause from anywhere reads its announcement too. */
export function markTodaysDevotionalRead(now: Date = new Date()): void {
  const today = localDay(now)
  for (const announcement of mockAnnouncements(today)) {
    if (
      announcement.kind === "daily-devotional" &&
      announcement.publishedOn === today
    )
      markAnnouncementRead(announcement.id)
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): number {
  return revision
}

export function useAnnouncements(): {
  items: AnnouncementItem[]
  unreadCount: number
} {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { dayKey } = useToday()
  const items = mockAnnouncements(dayKey).map((announcement) => ({
    ...announcement,
    unread: !readIds.has(announcement.id),
  }))
  return { items, unreadCount: items.filter((item) => item.unread).length }
}
