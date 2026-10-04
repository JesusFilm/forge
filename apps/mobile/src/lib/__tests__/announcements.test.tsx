/* eslint-disable @typescript-eslint/no-require-imports */

// The shape of the real ES module: the day record loads its `default` export.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
}))

import AsyncStorage from "@react-native-async-storage/async-storage"
import { StrictMode, act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  markAnnouncementRead,
  markTodaysDevotionalRead,
  useAnnouncements,
} from "../announcements"
import {
  createPauseProgressStore,
  dayFromRecord,
  resetPauseProgressStoreForTests,
} from "../dailyPause/progress"

type Snapshot = ReturnType<typeof useAnnouncements>
const seen: Snapshot[] = []

function Probe() {
  seen.push(useAnnouncements())
  return null
}

async function mount(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
  return renderer
}

// The day record holds one day, so each case uses its own day.
function setToday(year: number, monthIndex: number, day: number) {
  jest.useFakeTimers({ now: new Date(year, monthIndex, day, 9, 0) })
}

afterEach(() => {
  seen.length = 0
  jest.useRealTimers()
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

  it("keeps the dot clear after a relaunch that day, and brings it back the next day", async () => {
    setToday(2026, 9, 6)
    let renderer = await mount()
    act(() => markTodaysDevotionalRead())
    expect(seen.at(-1)!.unreadCount).toBe(0)
    await unmount(renderer)
    // The read reached the device storage, not only this module's memory.
    const stored = createPauseProgressStore(AsyncStorage)
    await stored.hydrate()
    expect(dayFromRecord(stored.getSnapshot(), "2026-10-06").bellRead).toBe(
      true,
    )

    // A relaunch: the memory is gone, and the device storage stays.
    resetPauseProgressStoreForTests()
    seen.length = 0
    renderer = await mount()
    expect(seen.length).toBeGreaterThan(0)
    // Not one render shows the dot, not even before the record is read.
    expect(seen.filter((snapshot) => snapshot.unreadCount > 0)).toEqual([])

    // The day clock's midnight brings the next day's devotional, unread.
    await act(async () => {
      jest.advanceTimersByTime(15 * 60 * 60 * 1000)
    })
    expect(seen.at(-1)!.items[0]!.id).toBe("daily-devotional-2026-10-07")
    expect(seen.at(-1)!.unreadCount).toBe(1)
    await unmount(renderer)
  })
})
