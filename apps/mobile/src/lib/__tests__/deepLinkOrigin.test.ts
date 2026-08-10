import { buildWatchShareUrl } from "../watchShareUrl"
import {
  consumeDeepLinkEntry,
  initDeepLinkOrigins,
  registerDeepLinkUrl,
  resetDeepLinkOrigins,
  watchSlugFromUrl,
  whenDeepLinkOriginsReady,
} from "../deepLinkOrigin"

beforeEach(() => resetDeepLinkOrigins())

describe("watchSlugFromUrl", () => {
  it.each([
    ["forgemobile://watch/day-1-fish-for-people", "day-1-fish-for-people"],
    ["forgemobile://watch/jesus?lang=en", "jesus"],
    ["forgemobile://watch/jesus#t=10", "jesus"],
  ])("extracts the slug from the custom scheme %s", (url, expected) => {
    expect(watchSlugFromUrl(url)).toBe(expected)
  })

  // The share URL is the shape the app itself generates. Pinning it against the
  // real producer stops the fixture from drifting into a shape nothing emits.
  it("parses the app's own English share URL", () => {
    const url = buildWatchShareUrl("birth-of-jesus", null)
    expect(url).toContain(".html")
    expect(watchSlugFromUrl(url)).toBe("birth-of-jesus")
  })

  it("parses the app's own language-explicit share URL", () => {
    const url = buildWatchShareUrl("birth-of-jesus", "spanish-castilian")
    expect(url).toContain("/spanish-castilian.html")
    expect(watchSlugFromUrl(url)).toBe("birth-of-jesus")
  })

  // Anti-vacuous: a parser that returned the raw segment would yield
  // "birth-of-jesus.html", which can never match the route's decodedSlug.
  it("never returns a slug carrying the .html extension", () => {
    expect(watchSlugFromUrl(buildWatchShareUrl("jesus", null))).not.toContain(
      ".html",
    )
  })

  it("decodes a percent-escaped slug", () => {
    expect(watchSlugFromUrl("forgemobile://watch/a%2Fb")).toBe("a/b")
  })

  it.each([
    ["forgemobile://watch"],
    ["forgemobile://library"],
    [""],
    ["forgemobile://watch/.html"],
  ])("returns null for %s", (url) => {
    expect(watchSlugFromUrl(url)).toBeNull()
  })

  it("falls back to the raw segment on a bad escape", () => {
    expect(watchSlugFromUrl("forgemobile://watch/%E0%A4%A")).toBe("%E0%A4%A")
  })
})

describe("arrival registry", () => {
  it("reports the recorded entry kind", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold")
    expect(consumeDeepLinkEntry("jesus")).toBe("cold")
  })

  // The bug the canGoBack() gate had: an in-app tap must never count.
  it("returns null for a slug that never arrived externally", () => {
    expect(consumeDeepLinkEntry("considering-christmas")).toBeNull()
  })

  it("consumes once so a later in-app revisit is not re-counted", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "warm")
    expect(consumeDeepLinkEntry("jesus")).toBe("warm")
    expect(consumeDeepLinkEntry("jesus")).toBeNull()
  })

  it("ignores urls that address no watch slug", () => {
    registerDeepLinkUrl("forgemobile://library", "cold")
    registerDeepLinkUrl(null, "cold")
    expect(consumeDeepLinkEntry("library")).toBeNull()
  })

  // A stranded entry (slug already the active route, so no effect re-ran) must
  // not detonate on the next in-app open of that same slug.
  it("treats an entry past the TTL as absent", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold", 0)
    expect(consumeDeepLinkEntry("jesus", 31_000)).toBeNull()
  })

  it("still honors an entry inside the TTL", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold", 0)
    expect(consumeDeepLinkEntry("jesus", 5_000)).toBe("cold")
  })

  // An expired entry must also be cleared, or it lingers for the next read.
  it("clears an expired entry on read", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold", 0)
    consumeDeepLinkEntry("jesus", 31_000)
    registerDeepLinkUrl("forgemobile://watch/jesus", "warm", 40_000)
    expect(consumeDeepLinkEntry("jesus", 40_001)).toBe("warm")
  })

  // iOS can deliver one cold universal link through BOTH channels.
  it("never downgrades a cold arrival to warm", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold")
    registerDeepLinkUrl("forgemobile://watch/jesus", "warm")
    expect(consumeDeepLinkEntry("jesus")).toBe("cold")
  })
})

describe("initDeepLinkOrigins", () => {
  const listener = () => ({ remove: jest.fn() })

  it("records the initial url as a cold arrival and opens the gate", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve("forgemobile://watch/jesus"),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(consumeDeepLinkEntry("jesus")).toBe("cold")
  })

  it("records a url delivered while running as a warm arrival", async () => {
    let fire: ((e: { url: string }) => void) | undefined
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve(null),
      addUrlListener: (handler) => {
        fire = handler
        return { remove: jest.fn() }
      },
    })
    await whenDeepLinkOriginsReady()
    fire?.({ url: "forgemobile://watch/rivka" })
    expect(consumeDeepLinkEntry("rivka")).toBe("warm")
  })

  it("opens the gate even when the initial-url read rejects", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.reject(new Error("bridge down")),
      addUrlListener: listener,
    })
    await expect(whenDeepLinkOriginsReady()).resolves.toBeUndefined()
  })

  // The discriminating case: getInitialURL is known to HANG rather than reject
  // (expo-router races it against 150ms citing facebook/react-native#25675).
  // Without the timeout the gate never opens and telemetry dies for the session.
  it("opens the gate when the initial-url read never settles", async () => {
    jest.useFakeTimers()
    try {
      initDeepLinkOrigins({
        getInitialURL: () => new Promise<string | null>(() => {}),
        addUrlListener: listener,
      })
      jest.advanceTimersByTime(3_000)
      await expect(whenDeepLinkOriginsReady()).resolves.toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })

  it("removes the url listener on teardown", () => {
    const remove = jest.fn()
    const teardown = initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve(null),
      addUrlListener: () => ({ remove }),
    })
    teardown()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
