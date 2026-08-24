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
  }: {
    children?: string
    id?: string
    src?: string
  }) => {
    if (src) return <div data-next-script="" data-src={src} />
    return (
      <div data-next-script="" id={id}>
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

  it("renders the GA4 bootstrap scripts when configured", async () => {
    mockEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST12345"

    act(() => {
      root.render(<GoogleAnalytics />)
    })
    await flushEffects()

    const scripts = Array.from(container.querySelectorAll("[data-next-script]"))
    expect(scripts).toHaveLength(2)
    expect(scripts[0]?.getAttribute("data-src")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-TEST12345",
    )
    expect(scripts[1]?.id).toBe("google-analytics-init")
    expect(scripts[1]?.textContent).toContain(
      "window.gtag('config', \"G-TEST12345\")",
    )
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

  it("swallows a throwing gtag implementation so analytics cannot block UI behavior", () => {
    window.gtag = vi.fn(() => {
      throw new Error("analytics unavailable")
    })

    expect(() =>
      reportGoogleAnalyticsEvent("watch_share_guidance_viewed", {
        guidance_scope: "video",
        surface: "watch_share_modal",
      }),
    ).not.toThrow()
  })
})
