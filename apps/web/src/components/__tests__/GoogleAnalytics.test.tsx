/**
 * @vitest-environment jsdom
 */
import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv, navigationState } = vi.hoisted(() => {
  const mockEnv = {
    NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID: undefined as
      | string
      | undefined,
    // `src/lib/routes.ts` reads this at module evaluation time, and the v2
    // page-view path resolves canonical locations through it.
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://www.jesusfilm.org",
    NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2: undefined as boolean | undefined,
  }
  const navigationState = {
    pathname: "/watch/jesus.html/english.html",
    queryString: "",
  }

  return { mockEnv, navigationState }
})

vi.mock("@/env", () => ({
  env: mockEnv,
}))

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => new URLSearchParams(navigationState.queryString),
}))

vi.mock("next/script", () => ({
  default: ({
    children,
    id,
    src,
    strategy,
  }: {
    children?: string
    id?: string
    src?: string
    strategy?: string
  }) => {
    if (src) {
      return <div data-next-script="" data-src={src} data-strategy={strategy} />
    }
    return (
      <div data-next-script="" id={id} data-strategy={strategy}>
        {children}
      </div>
    )
  },
}))

import GoogleAnalytics, {
  getGoogleAnalyticsMeasurementId,
  reportGoogleAnalyticsEvent,
} from "@/components/GoogleAnalytics"

let container: HTMLDivElement
let root: Root

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

function resetMocks() {
  mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = undefined
  // Default OFF. Every v1 characterization fixture below therefore runs on the
  // rollback path, which is what makes them a rollback proof rather than a
  // description of whichever branch happened to be selected.
  mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = undefined
  navigationState.pathname = "/watch/jesus.html/english.html"
  navigationState.queryString = ""
  window.dataLayer = undefined
  window.gtag = undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("GoogleAnalytics", () => {
  it("does not render scripts when the measurement id is absent", async () => {
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(container.querySelectorAll("[data-next-script]")).toHaveLength(0)
    expect(getGoogleAnalyticsMeasurementId()).toBeNull()
  })

  it("trims blank measurement ids to a disabled state", () => {
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "   "

    expect(getGoogleAnalyticsMeasurementId()).toBeNull()
  })

  it("renders GA4 when configured with the no-prop Watch layout contract", async () => {
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST12345"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    const scripts = Array.from(container.querySelectorAll("[data-next-script]"))
    expect(scripts).toHaveLength(2)
    expect(
      scripts.map((script) => script.getAttribute("data-strategy")),
    ).toEqual(["afterInteractive", "afterInteractive"])
    expect(scripts[0]?.getAttribute("data-src")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-TEST12345",
    )
    expect(scripts[1]?.id).toBe("google-analytics-init")
    expect(scripts[1]?.textContent).toContain(
      "window.gtag('config', \"G-TEST12345\")",
    )
  })

  // v1 CHARACTERIZATION. The assertions below freeze the collector behavior the
  // v2 page-view path (R6-R8) must preserve or deliberately supersede. They
  // describe what the code does today, not what the contract wants.
  it("leaves the initial page view to the Google tag and emits no manual page event (v1)", async () => {
    const gtag = vi.fn()
    window.gtag = gtag
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST12345"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    const bootstrap = Array.from(
      container.querySelectorAll("[data-next-script]"),
    )[1]
    // v1 bootstraps with a bare `config` and no options object, so GA4's
    // automatic `send_page_view` fires for the raw browser URL. R8 requires v2
    // to set `send_page_view: false` here; pinning its absence makes that a
    // visible change rather than a silent one.
    expect(bootstrap?.textContent).toContain(
      "window.gtag('config', \"G-TEST12345\")",
    )
    expect(bootstrap?.textContent).not.toContain("send_page_view")
    // No manual page view is emitted from React on the initial commit.
    expect(gtag).not.toHaveBeenCalled()
  })

  it("reports client-side route changes to GA4", async () => {
    const gtag = vi.fn()
    window.gtag = gtag
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST12345"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(gtag).not.toHaveBeenCalled()

    navigationState.pathname = "/watch/languages.html"
    navigationState.queryString = "source=header"
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(gtag).toHaveBeenCalledWith("config", "G-TEST12345", {
      page_path: "/watch/languages.html?source=header",
    })
    // v1 route changes are `config` calls, not `event`/`page_view` calls, and
    // the query string is part of the reported page identity (superseded by
    // R7).
    expect(gtag).toHaveBeenCalledTimes(1)
    expect(
      gtag.mock.calls.filter(([command]) => command === "event"),
    ).toHaveLength(0)
  })

  it("emits no additional config call for a same-path rerender (v1)", async () => {
    const gtag = vi.fn()
    window.gtag = gtag
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST12345"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    navigationState.pathname = "/watch/languages.html"
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()
    expect(gtag).toHaveBeenCalledTimes(1)

    // Same committed path, rendered again.
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(gtag).toHaveBeenCalledTimes(1)
  })

  it("pins the legacy wire names every v1 Watch event reaches GA4 under", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    // R25: these four strings are external contracts (GA4 key-event settings
    // and existing reports). v2 must not rename them.
    reportGoogleAnalyticsEvent("watch_download_intent", {})
    reportGoogleAnalyticsEvent("watch_language_picker_opened", {})
    reportGoogleAnalyticsEvent("watch_share_opened", {})
    reportGoogleAnalyticsEvent("watch_search.result_clicked", {})

    expect(
      gtag.mock.calls.map(([command, eventName]) => [command, eventName]),
    ).toEqual([
      ["event", "download_intent"],
      ["event", "language_picker_opened"],
      ["event", "share_opened"],
      ["event", "search_result_clicked"],
    ])
  })

  it("reports custom events with GA4-safe names and primitive params", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    reportGoogleAnalyticsEvent("watch_search.result_clicked", {
      "watch_search.result_id": "result-1",
      "watch_search.result_position": 1,
      ignored_null: null,
      ignored_object: { nested: true },
      language_slug: "english",
    })

    expect(gtag).toHaveBeenCalledWith("event", "search_result_clicked", {
      result_id: "result-1",
      result_position: 1,
      language_slug: "english",
    })
  })
})

// -----------------------------------------------------------------------------
// v2 collector (R6-R8, R24, KTD2, KTD6). Flag ON.
// -----------------------------------------------------------------------------

const MEASUREMENT_ID = "G-TEST12345"

function pageViews(gtag: ReturnType<typeof vi.fn>) {
  return gtag.mock.calls
    .filter(([command, name]) => command === "event" && name === "page_view")
    .map(([, , params]) => (params ?? {}) as Record<string, unknown>)
}

describe("GoogleAnalytics — v2 explicit SPA page views", () => {
  beforeEach(() => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = true
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = MEASUREMENT_ID
  })

  it("renders no script and no event path when GA is unconfigured", async () => {
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = undefined
    const gtag = vi.fn()
    window.gtag = gtag

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(container.querySelectorAll("[data-next-script]")).toHaveLength(0)
    expect(gtag).not.toHaveBeenCalled()
  })

  it("disables the Google tag's automatic page view (R8)", async () => {
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    const bootstrap = Array.from(
      container.querySelectorAll("[data-next-script]"),
    )[1]
    expect(bootstrap?.textContent).toContain('"send_page_view":false')
  })

  it("emits one initial page view with canonical standard fields (AE1)", async () => {
    const gtag = vi.fn()
    window.gtag = gtag
    navigationState.pathname = "/watch/jesus.html/english.html"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(pageViews(gtag)).toHaveLength(1)
    expect(pageViews(gtag)[0]).toMatchObject({
      page_path: "/watch/jesus.html",
      page_location: "https://www.jesusfilm.org/watch/jesus.html",
      watch_raw_path: "/watch/jesus.html/english.html",
      watch_route_variant: "explicit_language_compatibility",
      watch_route_type: "video",
      watch_entry_intent: "direct",
    })
    // v2 owns page views explicitly; it must not also fire v1's `config` call.
    expect(
      gtag.mock.calls.filter(([command]) => command === "config"),
    ).toHaveLength(0)
  })

  it("emits one more page view for a real client navigation and none for a rerender (AE2)", async () => {
    const gtag = vi.fn()
    window.gtag = gtag

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()
    expect(pageViews(gtag)).toHaveLength(1)

    navigationState.pathname = "/watch/jesus.html/urdu.html"
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(pageViews(gtag)).toHaveLength(2)
    expect(pageViews(gtag)[1]).toMatchObject({
      page_path: "/watch/jesus.html/urdu.html",
      watch_raw_path: "/watch/jesus.html/urdu.html",
      watch_route_variant: "canonical",
      watch_language_class: "non_english",
    })

    // Same committed route, rendered again.
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()
    expect(pageViews(gtag)).toHaveLength(2)

    // And a repeated navigation back to the identical path is still one commit.
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()
    expect(pageViews(gtag)).toHaveLength(2)
  })

  it("emits no duplicate under React Strict Mode effect replay", async () => {
    const gtag = vi.fn()
    window.gtag = gtag

    act(() => {
      root.render(
        <StrictMode>
          <GoogleAnalytics />
        </StrictMode>,
      )
    })
    await flushEffects()

    expect(pageViews(gtag)).toHaveLength(1)
  })

  it("emits no duplicate when query cleanup rewrites a non-campaign query", async () => {
    const gtag = vi.fn()
    window.gtag = gtag
    navigationState.pathname = "/watch/jesus.html"
    navigationState.queryString = "_lr=1&t=42"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()
    expect(pageViews(gtag)).toHaveLength(1)

    // `history.replaceState` strips the one-shot params; the committed route
    // key is unchanged because Watch one-shot params never create an identity.
    navigationState.queryString = ""
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(pageViews(gtag)).toHaveLength(1)
  })

  it("emits one page view for the latest key when two routes commit in one frame", async () => {
    const gtag = vi.fn()
    window.gtag = gtag

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()
    gtag.mockClear()

    // Two commits batched into a single React turn. The page-view path does
    // NOT inherit the dispatcher's frame deferral: the deduper and the emit
    // happen together, so the assertion holds without yielding a frame.
    act(() => {
      navigationState.pathname = "/watch/jesus.html/urdu.html"
      root.render(<GoogleAnalytics />)
      navigationState.pathname = "/watch/jesus.html/russian.html"
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(pageViews(gtag)).toHaveLength(1)
    expect(pageViews(gtag)[0]).toMatchObject({
      page_path: "/watch/jesus.html/russian.html",
    })
  })

  it("retains only the latest committed route across two changes before readiness", async () => {
    vi.useFakeTimers()
    try {
      // No Google tag yet: the script has not executed.
      window.gtag = undefined
      navigationState.pathname = "/watch/jesus.html"

      act(() => {
        root.render(<GoogleAnalytics />)
      })

      navigationState.pathname = "/watch/jesus.html/urdu.html"
      act(() => {
        root.render(<GoogleAnalytics />)
      })

      navigationState.pathname = "/watch/jesus.html/russian.html"
      act(() => {
        root.render(<GoogleAnalytics />)
      })

      const gtag = vi.fn()
      window.gtag = gtag

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(pageViews(gtag)).toHaveLength(1)
      expect(pageViews(gtag)[0]).toMatchObject({
        page_path: "/watch/jesus.html/russian.html",
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("GoogleAnalytics — flag-off rollback (R24)", () => {
  it("keeps the v1 config-call route path and emits no page_view event", async () => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = false
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = MEASUREMENT_ID
    const gtag = vi.fn()
    window.gtag = gtag

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    navigationState.pathname = "/watch/jesus.html/urdu.html"
    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    expect(pageViews(gtag)).toHaveLength(0)
    expect(gtag).toHaveBeenCalledWith("config", MEASUREMENT_ID, {
      page_path: "/watch/jesus.html/urdu.html",
    })
    const bootstrap = Array.from(
      container.querySelectorAll("[data-next-script]"),
    )[1]
    expect(bootstrap?.textContent).not.toContain("send_page_view")
  })
})
