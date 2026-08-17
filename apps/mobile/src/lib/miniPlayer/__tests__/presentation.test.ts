import {
  canOriginateSession,
  isFullScreenRoute,
  isTabRootRoute,
  miniPlayerPresentation,
  type MiniPlayerPresentation,
} from "../presentation"
import { createMiniPlayerStore } from "../store"

function storeWithSession() {
  const store = createMiniPlayerStore()
  store.start({
    videoId: "video-1",
    videoSlug: "birth-of-jesus",
    title: "Birth of Jesus",
    originPattern: "watch/[slug]",
  })
  return store
}

/**
 * Every route the app declares, read from app/_layout.tsx, app/(tabs)/_layout.tsx,
 * app/watch/_layout.tsx and app/series/_layout.tsx. Segments are route patterns
 * and the router pops a trailing "index", so the Home tab is ["(tabs)"].
 */
const ROUTE_TABLE: ReadonlyArray<
  [pattern: string, segments: string[], expected: MiniPlayerPresentation]
> = [
  ["(tabs) — Home", ["(tabs)"], "floating"],
  ["(tabs)/watch — Discover", ["(tabs)", "watch"], "floating"],
  ["(tabs)/library", ["(tabs)", "library"], "floating"],
  ["(tabs)/profile", ["(tabs)", "profile"], "floating"],
  ["watch/[slug]", ["watch", "[slug]"], "full"],
  ["watch/language", ["watch", "language"], "full"],
  ["watch/subtitle", ["watch", "subtitle"], "full"],
  ["watch/download", ["watch", "download"], "full"],
  ["series/[slug]", ["series", "[slug]"], "floating"],
  ["series/language", ["series", "language"], "hidden"],
  ["series/subtitle", ["series", "subtitle"], "hidden"],
  ["series/download", ["series", "download"], "hidden"],
  ["experience/[slug]", ["experience", "[slug]"], "floating"],
  ["video/[sectionKey]", ["video", "[sectionKey]"], "floating"],
  ["collection/[sectionKey]", ["collection", "[sectionKey]"], "floating"],
  ["mission", ["mission"], "floating"],
]

describe("miniPlayerPresentation over the real route table", () => {
  it.each(ROUTE_TABLE)("%s → %s", (_pattern, segments, expected) => {
    const store = storeWithSession()
    expect(miniPlayerPresentation(store.getSnapshot(), segments)).toBe(expected)
  })

  it("never returns none while a session exists, on any route", () => {
    const store = storeWithSession()
    for (const [, segments] of ROUTE_TABLE) {
      expect(miniPlayerPresentation(store.getSnapshot(), segments)).not.toBe(
        "none",
      )
    }
  })

  it("returns none on every route when no session exists", () => {
    const store = createMiniPlayerStore()
    for (const [, segments] of ROUTE_TABLE) {
      expect(miniPlayerPresentation(store.getSnapshot(), segments)).toBe("none")
    }
  })

  it("keeps the Discover tab distinct from the full-screen watch route", () => {
    const store = storeWithSession()
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["(tabs)", "watch"]),
    ).toBe("floating")
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["watch", "[slug]"]),
    ).toBe("full")
  })

  it("treats an unlisted future route as floating, per R3 persistence", () => {
    const store = storeWithSession()
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["topics", "[slug]"]),
    ).toBe("floating")
  })

  it("keys full-screen on the whole pattern, not on the group segment", () => {
    // A new screen added under app/watch/ is not the full-screen video view. A
    // prefix match would present `full` and hide the window with no way back.
    const store = storeWithSession()
    expect(miniPlayerPresentation(store.getSnapshot(), ["watch", "tips"])).toBe(
      "floating",
    )
    expect(isFullScreenRoute(["watch", "tips"])).toBe(false)
  })
})

describe("R19 origination exclusion", () => {
  it.each([
    ["experience", "[slug]"],
    ["video", "[sectionKey]"],
    ["collection", "[sectionKey]"],
  ])("refuses a session originating on %s/%s", (...segments) => {
    expect(canOriginateSession(segments)).toBe(false)
  })

  it.each([
    [["watch", "[slug]"]],
    [["series", "[slug]"]],
    [["(tabs)"]],
    [["mission"]],
  ])("allows a session originating on %s", (segments) => {
    expect(canOriginateSession(segments)).toBe(true)
  })

  it("presents none on an excluded route when admission published nothing", () => {
    const store = createMiniPlayerStore()
    const segments = ["experience", "[slug]"]
    // What the excluded route produces: no session, so nothing to present.
    expect(canOriginateSession(segments)).toBe(false)
    expect(miniPlayerPresentation(store.getSnapshot(), segments)).toBe("none")
  })

  it("floats a session CARRIED onto an excluded route (AE17)", () => {
    const store = storeWithSession()
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["experience", "[slug]"]),
    ).toBe("floating")
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["video", "[sectionKey]"]),
    ).toBe("floating")
    expect(
      miniPlayerPresentation(store.getSnapshot(), [
        "collection",
        "[sectionKey]",
      ]),
    ).toBe("floating")
  })
})

describe("suppression and phases", () => {
  it("hides for a non-route sheet and restores when the count returns to zero", () => {
    const store = storeWithSession()
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["(tabs)", "library"], 1),
    ).toBe("hidden")
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["(tabs)", "library"], 0),
    ).toBe("floating")
  })

  it("never suppresses the full-screen view, sheet or not", () => {
    const store = storeWithSession()
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["watch", "[slug]"], 2),
    ).toBe("full")
    store.setPipHold(true)
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["watch", "[slug]"]),
    ).toBe("full")
  })

  it("hides while the picture-in-picture hold is set", () => {
    const store = storeWithSession()
    store.setPipHold(true)
    expect(miniPlayerPresentation(store.getSnapshot(), ["(tabs)"])).toBe(
      "hidden",
    )
    store.setPipHold(false)
    expect(miniPlayerPresentation(store.getSnapshot(), ["(tabs)"])).toBe(
      "floating",
    )
  })

  it("presents exiting on dismiss, and clears only on exit completion", () => {
    const store = storeWithSession()
    store.requestDismiss()
    expect(miniPlayerPresentation(store.getSnapshot(), ["(tabs)"])).toBe(
      "exiting",
    )
    // Still mounted: only the completion report may clear the store (R6).
    expect(store.getSnapshot().session).not.toBeNull()

    store.reportExitComplete()
    expect(miniPlayerPresentation(store.getSnapshot(), ["(tabs)"])).toBe("none")
  })

  it("presents exiting even on the full-screen route", () => {
    const store = storeWithSession()
    store.requestDismiss()
    expect(
      miniPlayerPresentation(store.getSnapshot(), ["watch", "[slug]"]),
    ).toBe("exiting")
  })

  it("keeps an ended session floating, with its phase readable (R21, R27)", () => {
    const store = storeWithSession()
    store.markEnded("playToEnd")
    expect(store.getSnapshot().session?.phase).toBe("ended")
    expect(miniPlayerPresentation(store.getSnapshot(), ["(tabs)"])).toBe(
      "floating",
    )
  })

  it("keeps a failed session floating, distinguished by its ended cause (R22)", () => {
    const store = storeWithSession()
    store.markEnded("failure")
    expect(store.getSnapshot().session?.endedCause).toBe("failure")
    expect(miniPlayerPresentation(store.getSnapshot(), ["(tabs)"])).toBe(
      "floating",
    )
  })
})

describe("route predicates", () => {
  it("recognises the four tab roots and nothing else", () => {
    expect(isTabRootRoute(["(tabs)"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "index"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "watch"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "library"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "profile"])).toBe(true)
    expect(isTabRootRoute(["watch", "[slug]"])).toBe(false)
    expect(isTabRootRoute(["mission"])).toBe(false)
  })

  it("recognises the watch group as full-screen and the series group as not", () => {
    expect(isFullScreenRoute(["watch", "[slug]"])).toBe(true)
    expect(isFullScreenRoute(["watch", "download"])).toBe(true)
    expect(isFullScreenRoute(["series", "[slug]"])).toBe(false)
    expect(isFullScreenRoute(["series", "download"])).toBe(false)
    expect(isFullScreenRoute(["(tabs)", "watch"])).toBe(false)
  })
})
