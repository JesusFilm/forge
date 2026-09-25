import { TAB_ROUTE_NAMES } from "../../tabBar"
import {
  READER_COVER_ROUTE_PATTERNS,
  READER_ROUTE_PATTERNS,
  TAB_ROOT_ROUTE_PATTERNS,
  canOriginateRoutePattern,
  expandAction,
  isFullScreenRoute,
  isReaderCovering,
  isTabRootRoute,
  miniPlayerPresentation,
  readerRouteKind,
  type MiniPlayerPresentation,
} from "../presentation"
import { routePattern } from "../suppression"
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
 * feat-551 U11 adds the Bible tab, the pushed reader, and its three sheets;
 * U13 owns how the window behaves over the reader.
 */
const ROUTE_TABLE: ReadonlyArray<
  [pattern: string, segments: string[], expected: MiniPlayerPresentation]
> = [
  ["(tabs) — Home", ["(tabs)"], "floating"],
  ["(tabs)/watch — Discover", ["(tabs)", "watch"], "floating"],
  ["(tabs)/bible — Bible", ["(tabs)", "bible"], "floating"],
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
  ["reader", ["reader"], "floating"],
  ["reader-passage", ["reader-passage"], "hidden"],
  ["reader-translation", ["reader-translation"], "hidden"],
  ["reader-settings", ["reader-settings"], "hidden"],
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
    expect(canOriginateRoutePattern(routePattern(segments))).toBe(false)
  })

  it.each([
    [["watch", "[slug]"]],
    [["series", "[slug]"]],
    [["(tabs)"]],
    [["mission"]],
  ])("allows a session originating on %s", (segments) => {
    expect(canOriginateRoutePattern(routePattern(segments))).toBe(true)
  })

  it("presents none on an excluded route when admission published nothing", () => {
    const store = createMiniPlayerStore()
    const segments = ["experience", "[slug]"]
    // What the excluded route produces: no session, so nothing to present.
    expect(canOriginateRoutePattern(routePattern(segments))).toBe(false)
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
  it("recognises the five tab roots and nothing else", () => {
    expect(isTabRootRoute(["(tabs)"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "index"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "watch"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "bible"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "library"])).toBe(true)
    expect(isTabRootRoute(["(tabs)", "profile"])).toBe(true)
    expect(isTabRootRoute(["watch", "[slug]"])).toBe(false)
    expect(isTabRootRoute(["mission"])).toBe(false)
    // The pushed reader is a root route, not the Bible tab (KTD9).
    expect(isTabRootRoute(["reader"])).toBe(false)
    expect(isTabRootRoute(["reader-passage"])).toBe(false)
  })

  it("lists one tab root per tab route, plus the popped Home index", () => {
    // Anti-drift: a sixth tab must reach the mini player's tab-root policy too.
    expect(
      TAB_ROOT_ROUTE_PATTERNS.filter((pattern) => pattern.includes("/")).map(
        (pattern) => pattern.replace("(tabs)/", ""),
      ),
    ).toEqual([...TAB_ROUTE_NAMES])
  })

  it("recognises the watch group as full-screen and the series group as not", () => {
    expect(isFullScreenRoute(["watch", "[slug]"])).toBe(true)
    expect(isFullScreenRoute(["watch", "download"])).toBe(true)
    expect(isFullScreenRoute(["series", "[slug]"])).toBe(false)
    expect(isFullScreenRoute(["series", "download"])).toBe(false)
    expect(isFullScreenRoute(["(tabs)", "watch"])).toBe(false)
  })
})

// feat-551 KTD10, KTD11: the reader routes and the watch slot they cover.
describe("the reader cover (KTD10)", () => {
  // Every route in the table above, so an added route has to take a side.
  const COVERING = [
    "reader",
    "reader-passage",
    "reader-translation",
    "reader-settings",
  ]

  it.each(ROUTE_TABLE)(
    "%s covers the watch slot only if it is a reader route",
    (pattern, segments) => {
      const expected = COVERING.includes(routePattern(segments))
      expect(isReaderCovering(segments)).toBe(expected)
      // Anti-vacuous: the label and the segments name the same route.
      expect(pattern.startsWith(routePattern(segments))).toBe(true)
    },
  )

  it("lists the pushed reader and its three sheets, never the Bible tab", () => {
    expect([...READER_COVER_ROUTE_PATTERNS]).toEqual(COVERING)
    // No watch slot is mounted under the tab, so there is nothing to cover.
    expect(isReaderCovering(["(tabs)", "bible"])).toBe(false)
  })

  it("names the reader host of every reader route", () => {
    expect(readerRouteKind(["(tabs)", "bible"])).toBe("tab")
    expect(readerRouteKind(["reader"])).toBe("pushed")
    expect(readerRouteKind(["reader-passage"])).toBe("sheet")
    expect(readerRouteKind(["reader-translation"])).toBe("sheet")
    expect(readerRouteKind(["reader-settings"])).toBe("sheet")
    expect(readerRouteKind(["(tabs)"])).toBeNull()
    expect(readerRouteKind(["watch", "[slug]"])).toBeNull()
    expect(readerRouteKind(["(tabs)", "watch"])).toBeNull()
    expect([...READER_ROUTE_PATTERNS].sort()).toEqual(
      [...COVERING, "(tabs)/bible"].sort(),
    )
  })
})

describe("expandAction (KTD10, AE14)", () => {
  const SESSION = { videoId: "video-1", videoSlug: "birth-of-jesus" }

  it("pops to the covered watch screen from the reader", () => {
    expect(
      expandAction({
        covered: true,
        descriptor: SESSION,
        session: SESSION,
        segments: ["reader"],
      }),
    ).toBe("pop")
  })

  it("pops when the descriptor names the video by slug alone", () => {
    expect(
      expandAction({
        covered: true,
        descriptor: { videoId: null, videoSlug: "birth-of-jesus" },
        session: SESSION,
        segments: ["reader"],
      }),
    ).toBe("pop")
  })

  it("pushes when no watch slot is covered, as from the Bible tab", () => {
    expect(
      expandAction({
        covered: false,
        descriptor: null,
        session: SESSION,
        segments: ["(tabs)", "bible"],
      }),
    ).toBe("push")
  })

  it("pushes when the covered slot plays another video", () => {
    expect(
      expandAction({
        covered: true,
        descriptor: { videoId: "video-2", videoSlug: "other" },
        session: SESSION,
        segments: ["reader"],
      }),
    ).toBe("push")
  })

  it("pushes when the top route is a reader sheet, not the reader", () => {
    expect(
      expandAction({
        covered: true,
        descriptor: SESSION,
        session: SESSION,
        segments: ["reader-settings"],
      }),
    ).toBe("push")
  })

  it("pushes with no descriptor or no session", () => {
    expect(
      expandAction({
        covered: true,
        descriptor: null,
        session: SESSION,
        segments: ["reader"],
      }),
    ).toBe("push")
    expect(
      expandAction({
        covered: true,
        descriptor: SESSION,
        session: null,
        segments: ["reader"],
      }),
    ).toBe("push")
  })
})
