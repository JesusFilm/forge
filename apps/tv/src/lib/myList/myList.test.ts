import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  MAX_MY_LIST,
  MY_LIST_STORAGE_KEY,
  addToMyList,
  applyAdd,
  applyRemove,
  clearMyList,
  containsEntry,
  isInMyList,
  loadMyList,
  parseMyList,
  removeFromMyList,
  toggleMyList,
  updateMyList,
  type MyListEntry,
} from "./myList"

beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
})

function entry(overrides: Partial<MyListEntry> = {}): MyListEntry {
  return {
    videoId: "video-1",
    slug: "stunned",
    title: "Stunned",
    imageUrl: "https://img.example/stunned.jpg",
    rawLabel: "FEATURE_FILM",
    addedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  }
}

describe("parseMyList", () => {
  it("returns [] for null, junk, and non-arrays", () => {
    expect(parseMyList(null)).toEqual([])
    expect(parseMyList("not json")).toEqual([])
    expect(parseMyList(JSON.stringify({ videoId: "a" }))).toEqual([])
  })

  it("drops entries missing the identifying fields", () => {
    const raw = JSON.stringify([
      entry(),
      { slug: "no-id", addedAt: "2026-08-14T00:00:00.000Z" },
      { videoId: "no-slug", addedAt: "2026-08-14T00:00:00.000Z" },
      { videoId: "no-stamp", slug: "x" },
    ])
    expect(parseMyList(raw).map((e) => e.videoId)).toEqual(["video-1"])
  })

  it("caps a bloated payload at MAX_MY_LIST", () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_MY_LIST + 12 }, (_, i) =>
        entry({ videoId: `v-${i}` }),
      ),
    )
    expect(parseMyList(raw)).toHaveLength(MAX_MY_LIST)
  })

  it("preserves rawLabel verbatim — routing re-derives series-ness from it", () => {
    // The wire spelling is what isSeriesLabel matches (STRICT UPPERCASE); a
    // parse that normalized case would route saved series to /watch.
    const parsed = parseMyList(JSON.stringify([entry({ rawLabel: "SERIES" })]))
    expect(parsed[0]!.rawLabel).toBe("SERIES")
  })
})

describe("applyAdd / applyRemove / containsEntry", () => {
  it("adds to the front", () => {
    const next = applyAdd(
      [entry({ videoId: "old" })],
      entry({ videoId: "new" }),
    )
    expect(next.map((e) => e.videoId)).toEqual(["new", "old"])
  })

  it("re-adding moves to the front and refreshes fields, never duplicates", () => {
    const before = [
      entry({ videoId: "a", title: "Stale" }),
      entry({ videoId: "b" }),
    ]
    const next = applyAdd(before, entry({ videoId: "a", title: "Fresh" }))
    expect(next.map((e) => e.videoId)).toEqual(["a", "b"])
    expect(next[0]!.title).toBe("Fresh")
  })

  it("caps at MAX_MY_LIST, dropping the oldest", () => {
    const full = Array.from({ length: MAX_MY_LIST }, (_, i) =>
      entry({ videoId: `v-${i}` }),
    )
    const next = applyAdd(full, entry({ videoId: "newest" }))
    expect(next).toHaveLength(MAX_MY_LIST)
    expect(next[0]!.videoId).toBe("newest")
    expect(next.some((e) => e.videoId === `v-${MAX_MY_LIST - 1}`)).toBe(false)
  })

  it("removes by videoId and reports membership", () => {
    const list = [entry({ videoId: "a" }), entry({ videoId: "b" })]
    expect(containsEntry(list, "a")).toBe(true)
    expect(containsEntry(applyRemove(list, "a"), "a")).toBe(false)
    expect(applyRemove(list, "missing")).toHaveLength(2)
  })
})

describe("storage round trip", () => {
  it("saves, reads back, and reports membership", async () => {
    await addToMyList(entry({ videoId: "a" }))
    await addToMyList(entry({ videoId: "b" }))

    expect((await loadMyList()).map((e) => e.videoId)).toEqual(["b", "a"])
    expect(await isInMyList("a")).toBe(true)
    expect(await isInMyList("nope")).toBe(false)
  })

  it("removes the storage key entirely once the last entry goes", async () => {
    await addToMyList(entry({ videoId: "a" }))
    await removeFromMyList("a")

    expect(await loadMyList()).toEqual([])
    expect(await getStorage().getItem(MY_LIST_STORAGE_KEY)).toBeNull()
  })

  it("clears the whole list", async () => {
    await addToMyList(entry({ videoId: "a" }))
    await expect(clearMyList()).resolves.toBe(true)
    expect(await loadMyList()).toEqual([])
  })

  it("updateMyList folds the whole list under the lock", async () => {
    await addToMyList(entry({ videoId: "a" }))
    await addToMyList(entry({ videoId: "b" }))

    await updateMyList((entries) => entries.filter((e) => e.videoId !== "a"))

    expect((await loadMyList()).map((e) => e.videoId)).toEqual(["b"])
  })
})

describe("toggleMyList", () => {
  it("reports the state the viewer now sees, both ways", async () => {
    await expect(toggleMyList(entry())).resolves.toBe(true)
    expect(await isInMyList("video-1")).toBe(true)

    await expect(toggleMyList(entry())).resolves.toBe(false)
    expect(await isInMyList("video-1")).toBe(false)
  })

  it("serializes concurrent presses instead of double-adding", async () => {
    // Both presses land before either resolves. An unlocked read-decide-write
    // would let both observe "not saved" and both add — the list is a set.
    const [first, second] = await Promise.all([
      toggleMyList(entry()),
      toggleMyList(entry()),
    ])

    expect([first, second].sort()).toEqual([false, true])
    expect(await loadMyList()).toEqual([])
  })

  it("reports NOT-saved when the write fails, rather than claiming a save", async () => {
    const storage = getStorage()
    const setItem = jest
      .spyOn(storage, "setItem")
      .mockRejectedValueOnce(new Error("disk full"))

    await expect(toggleMyList(entry())).resolves.toBe(false)
    expect(await loadMyList()).toEqual([])

    setItem.mockRestore()
  })
})
