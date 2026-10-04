import { act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  localDay,
  markAnnouncementRead,
  markTodaysDevotionalRead,
  useAnnouncements,
} from "../announcements"

type Snapshot = ReturnType<typeof useAnnouncements>
const seen: Snapshot[] = []

function Probe() {
  seen.push(useAnnouncements())
  return null
}

async function mount(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Probe />)
  })
  return renderer
}

// The read state is module-wide and keyed by day, so each case uses its own day.
function setToday(year: number, monthIndex: number, day: number) {
  jest.useFakeTimers({ now: new Date(year, monthIndex, day, 9, 0) })
}

afterEach(() => {
  seen.length = 0
  jest.useRealTimers()
})

describe("localDay", () => {
  it("names the phone's own calendar day, padded", () => {
    expect(localDay(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05")
    // Late evening stays on the same local day, whatever UTC says.
    expect(localDay(new Date(2026, 9, 1, 23, 30))).toBe("2026-10-01")
  })
})

describe("the mock announcements", () => {
  it("lists today's devotional as new", async () => {
    setToday(2026, 9, 1)
    const renderer = await mount()
    const { items, unreadCount } = seen.at(-1)!
    expect(items).toEqual([
      {
        id: "daily-devotional-2026-10-01",
        kind: "daily-devotional",
        title: "Your daily devotional video is ready to watch.",
        publishedOn: "2026-10-01",
        unread: true,
      },
    ])
    expect(unreadCount).toBe(1)
    await unmount(renderer)
  })

  it("reads an announcement once, and every subscriber sees it", async () => {
    setToday(2026, 9, 2)
    const renderer = await mount()
    const id = seen.at(-1)!.items[0]!.id
    act(() => markAnnouncementRead(id))
    expect(seen.at(-1)!.unreadCount).toBe(0)
    expect(seen.at(-1)!.items[0]!.unread).toBe(false)
    const renders = seen.length
    act(() => markAnnouncementRead(id))
    expect(seen).toHaveLength(renders)
    await unmount(renderer)
  })

  it("brings a new, unread devotional the next day", async () => {
    setToday(2026, 9, 3)
    const renderer = await mount()
    act(() => markAnnouncementRead(seen.at(-1)!.items[0]!.id))
    expect(seen.at(-1)!.unreadCount).toBe(0)
    jest.setSystemTime(new Date(2026, 9, 4, 9, 0))
    await act(async () => renderer.update(<Probe />))
    expect(seen.at(-1)!.items[0]!.id).toBe("daily-devotional-2026-10-04")
    expect(seen.at(-1)!.unreadCount).toBe(1)
    await unmount(renderer)
  })

  it("reads today's devotional when the pause opens from elsewhere", async () => {
    setToday(2026, 9, 5)
    const renderer = await mount()
    // Yesterday's date names a different devotional, so today's stays new.
    act(() => markTodaysDevotionalRead(new Date(2026, 9, 4, 9, 0)))
    expect(seen.at(-1)!.unreadCount).toBe(1)
    act(() => markTodaysDevotionalRead())
    expect(seen.at(-1)!.unreadCount).toBe(0)
    await unmount(renderer)
  })
})
