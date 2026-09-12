/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv, navigationState } = vi.hoisted(() => {
  const mockEnv = {
    NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID: undefined as
      | string
      | undefined,
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
