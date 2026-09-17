import { buildLapseReminderPayload } from "../lapseReminders/payload"
import { buildWatchShareUrl } from "../watchShareUrl"
import {
  consumeDeepLinkArrival,
  initDeepLinkOrigins,
  isExternalLaunch,
  registerDeepLinkSlug,
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
    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "cold",
      origin: "url",
    })
  })

  // The bug the canGoBack() gate had: an in-app tap must never count.
  it("returns null for a slug that never arrived externally", () => {
    expect(consumeDeepLinkArrival("considering-christmas")).toBeNull()
  })

  it("consumes once so a later in-app revisit is not re-counted", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "warm")
    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "warm",
      origin: "url",
    })
    expect(consumeDeepLinkArrival("jesus")).toBeNull()
  })

  it("ignores urls that address no watch slug", () => {
    registerDeepLinkUrl("forgemobile://library", "cold")
    registerDeepLinkUrl(null, "cold")
    expect(consumeDeepLinkArrival("library")).toBeNull()
  })

  // A stranded entry (slug already the active route, so no effect re-ran) must
  // not detonate on the next in-app open of that same slug.
  it("treats an entry past the TTL as absent", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold", 0)
    expect(consumeDeepLinkArrival("jesus", 31_000)).toBeNull()
  })

  it("still honors an entry inside the TTL", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold", 0)
    expect(consumeDeepLinkArrival("jesus", 5_000)).toEqual({
      entry: "cold",
      origin: "url",
    })
  })

  // An expired entry must also be cleared, or it lingers for the next read.
  it("clears an expired entry on read", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold", 0)
    consumeDeepLinkArrival("jesus", 31_000)
    registerDeepLinkUrl("forgemobile://watch/jesus", "warm", 40_000)
    expect(consumeDeepLinkArrival("jesus", 40_001)).toEqual({
      entry: "warm",
      origin: "url",
    })
  })

  // iOS can deliver one cold universal link through BOTH channels.
  it("never downgrades a cold arrival to warm", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold")
    registerDeepLinkUrl("forgemobile://watch/jesus", "warm")
    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "cold",
      origin: "url",
    })
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
    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "cold",
      origin: "url",
    })
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
    expect(consumeDeepLinkArrival("rivka")).toEqual({
      entry: "warm",
      origin: "url",
    })
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

describe("isExternalLaunch", () => {
  const listener = () => ({ remove: jest.fn() })

  it("reports an external launch when the opening url addresses a route", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve("forgemobile://watch/jesus"),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(isExternalLaunch()).toBe(true)
  })

  // The cold shape a person actually taps is the share URL, not the custom
  // scheme. Pinning it against the real producer stops the fixture drifting.
  it("reports an external launch for the app's own share url", async () => {
    initDeepLinkOrigins({
      getInitialURL: () =>
        Promise.resolve(buildWatchShareUrl("birth-of-jesus", null)),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(isExternalLaunch()).toBe(true)
  })

  it("reports a non-external launch when there is no opening url", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve(null),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(isExternalLaunch()).toBe(false)
  })

  // Every development-client launch carries this wrapper. Reading "url != null"
  // would report EVERY launch an implementer can watch as external.
  it("reports a non-external launch for a development-client wrapper url", async () => {
    initDeepLinkOrigins({
      getInitialURL: () =>
        Promise.resolve(
          "exp+jesus-film-forge-v2://expo-development-client/?url=http%3A%2F%2F192.168.1.10%3A8081",
        ),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(isExternalLaunch()).toBe(false)
  })

  it("reports a non-external launch when the initial-url read rejects", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.reject(new Error("bridge down")),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(isExternalLaunch()).toBe(false)
  })

  // getInitialURL is known to hang rather than reject. The answer must still be
  // an answer, so the caller is never left without one.
  it("reports a non-external launch when the initial-url read never settles", async () => {
    jest.useFakeTimers()
    try {
      initDeepLinkOrigins({
        getInitialURL: () => new Promise<string | null>(() => {}),
        addUrlListener: listener,
      })
      jest.advanceTimersByTime(3_000)
      await whenDeepLinkOriginsReady()
      expect(isExternalLaunch()).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  // The answer describes the LAUNCH. A link opened later belongs to a session
  // that is already past the moment this read exists to decide.
  it("keeps the launch answer when a url arrives while running", async () => {
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
    expect(isExternalLaunch()).toBe(false)
  })

  it("returns the same answer on repeated reads", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve("forgemobile://watch/jesus"),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    expect(isExternalLaunch()).toBe(true)
    expect(isExternalLaunch()).toBe(true)
    expect(isExternalLaunch()).toBe(true)
  })

  // The read must not touch the per-slug registry: consumeDeepLinkArrival owns
  // the deep-link attribution this module exists to provide.
  it("leaves the per-slug entry for consumeDeepLinkArrival to claim", async () => {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve("forgemobile://watch/jesus"),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    isExternalLaunch()
    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "cold",
      origin: "url",
    })
    expect(consumeDeepLinkArrival("jesus")).toBeNull()
  })

  it("reports a non-external launch before anything registers", () => {
    expect(isExternalLaunch()).toBe(false)
  })

  it("is cleared by resetDeepLinkOrigins", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold")
    expect(isExternalLaunch()).toBe(true)
    resetDeepLinkOrigins()
    expect(isExternalLaunch()).toBe(false)
  })
})

// The boundary of the narrowing, pinned as a DECISION rather than left to be
// rediscovered. "A watch slug" is not "any URL" because every development-
// client launch carries a wrapper URL, and the wider read would skip the
// animation on every launch anyone can observe locally.
describe("what isExternalLaunch counts as external", () => {
  const listener = () => ({ remove: jest.fn() })

  async function launchWith(url: string | null) {
    initDeepLinkOrigins({
      getInitialURL: () => Promise.resolve(url),
      addUrlListener: listener,
    })
    await whenDeepLinkOriginsReady()
    return isExternalLaunch()
  }

  it("counts a watch link", async () => {
    expect(await launchWith("forgemobile://watch/jesus")).toBe(true)
  })

  it.each([
    ["forgemobile://experience/christmas"],
    ["forgemobile://series/life-of-jesus"],
    ["forgemobile://mission"],
    ["forgemobile://library"],
  ])(
    "does NOT count %s — the splash plays and delays it (accepted)",
    async (url) => {
      expect(await launchWith(url)).toBe(false)
    },
  )

  it("does not count the development-client wrapper, which is the point", async () => {
    expect(
      await launchWith(
        "exp+jesus-film-forge-v2://expo-development-client/?url=http%3A%2F%2F192.168.1.10%3A8081",
      ),
    ).toBe(false)
  })
})

describe("arrival origin", () => {
  it("records a slug-keyed arrival under the origin it is given", () => {
    registerDeepLinkSlug("jesus", "cold", "reminder")

    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "cold",
      origin: "reminder",
    })
  })

  it("records a warm reminder arrival", () => {
    registerDeepLinkSlug("rivka", "warm", "reminder")

    expect(consumeDeepLinkArrival("rivka")).toEqual({
      entry: "warm",
      origin: "reminder",
    })
  })

  it("ignores an empty slug", () => {
    registerDeepLinkSlug("", "cold", "reminder")

    expect(consumeDeepLinkArrival("")).toBeNull()
  })

  it("expires a reminder arrival on the same TTL", () => {
    registerDeepLinkSlug("jesus", "cold", "reminder", 0)

    expect(consumeDeepLinkArrival("jesus", 31_000)).toBeNull()
  })

  it("keeps a cold url arrival over a later warm reminder one", () => {
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold")
    registerDeepLinkSlug("jesus", "warm", "reminder")

    expect(consumeDeepLinkArrival("jesus")).toEqual({
      entry: "cold",
      origin: "url",
    })
  })

  // A reminder tap is not a URL launch. The splash reads the launch answer to
  // decide whether to skip its animation, long before a tap can register.
  it("does not report a reminder arrival as an external launch", () => {
    registerDeepLinkSlug("jesus", "cold", "reminder")

    expect(isExternalLaunch()).toBe(false)
  })

  it("still reports a cold url arrival as an external launch", () => {
    // Anti-vacuous companion: the flag is not simply dead.
    registerDeepLinkUrl("forgemobile://watch/jesus", "cold")

    expect(isExternalLaunch()).toBe(true)
  })
})

// The one slug shape on which this module's URL parser and the reminder
// payload parser disagree. No real JFP slug looks like it, and rejecting such a
// slug would send a real video's reminders to Home, which is worse for the
// viewer than a missing analytics event. The tap handler therefore registers by
// the slug it already validated.
describe("a slug the two parsers read differently", () => {
  const target = buildLapseReminderPayload("day1", { slug: "foo.html" }).target

  it("reads one target as two different slugs", () => {
    expect(target).toBe("forgemobile://watch/foo.html")
    expect(watchSlugFromUrl(target)).toBe("foo")
  })

  it("reaches the watch route when it is keyed by the validated slug", () => {
    registerDeepLinkSlug("foo.html", "cold", "reminder")

    expect(consumeDeepLinkArrival("foo.html")).toEqual({
      entry: "cold",
      origin: "reminder",
    })
  })

  // Falsification, kept: the shape the tap handler must NOT use. The watch
  // route consumes by "foo.html", so a URL-keyed arrival is never claimed and
  // the attribution event is lost with every test on both sides still green.
  it("is stranded when it is keyed by its url instead", () => {
    registerDeepLinkUrl(target, "cold")

    expect(consumeDeepLinkArrival("foo.html")).toBeNull()
    expect(consumeDeepLinkArrival("foo")).toEqual({
      entry: "cold",
      origin: "url",
    })
  })
})
