import { getPauseProgressStore, usePauseDay } from "./dailyPause/progress"
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
 *  replace this. The read state is the day record's bell flag (R2). */
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

export function markAnnouncementRead(id: string): void {
  const announcement = mockAnnouncements(localDay(new Date())).find(
    (one) => one.id === id,
  )
  if (announcement)
    getPauseProgressStore().markBellRead(announcement.publishedOn)
}

/** Opening today's pause from anywhere reads its announcement too. */
export function markTodaysDevotionalRead(now: Date = new Date()): void {
  getPauseProgressStore().markBellRead(localDay(now))
}

export function useAnnouncements(): {
  items: AnnouncementItem[]
  unreadCount: number
} {
  const { dayKey } = useToday()
  const day = usePauseDay(dayKey)
  // Until the record is read the dot stays off, so a read day never flashes it.
  const read = day.status !== "ready" || day.bellRead
  const items = mockAnnouncements(dayKey).map((announcement) => ({
    ...announcement,
    unread: !read,
  }))
  return { items, unreadCount: items.filter((item) => item.unread).length }
}
