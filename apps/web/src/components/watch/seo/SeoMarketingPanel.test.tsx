// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SeoMarketingPanel } from "./SeoMarketingPanel"
import {
  createSampleWatchSeoData as sampleData,
  sampleEvidence as evidence,
} from "./sample-data"
import { WatchSeoTab } from "./WatchSeoTab"
import type { AiTrafficEvidence } from "./types"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) =>
    createElement("span", { role: "img", "aria-label": alt }),
}))

let root: Root | null = null
let container: HTMLDivElement
function renderPanel(data = sampleData()) {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      createElement(SeoMarketingPanel, {
        id: "seo-panel",
        labelledBy: "seo-tab",
        state: { status: "ready", data },
        adminOrigin: "https://admin.example.org",
        adminConfirmationUrl: "https://admin.example.org/seo/confirm",
      }),
    ),
  )
  return container
}
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
})

describe("Watch SEO presentation", () => {
  it.each([null, "direct_http", "rendered"] as const)(
    "describes crawler rendering mode without inferring no-JS execution (%s)",
    (renderingMode) => {
      const data = sampleData()
      data.crawler.data!.renderingMode = renderingMode
      const ui = renderPanel(data).querySelector('[data-seo-family="crawler"]')!
      expect(ui.textContent).not.toContain("without browser JavaScript")
      expect(ui.textContent).toContain(
        renderingMode === "direct_http"
          ? "Stored direct HTTP observation"
          : renderingMode === "rendered"
            ? "Browser-rendered observation"
            : "Unknown — rendering mode was not recorded",
      )
    },
  )

  it("shows unavailable ranking history without a chart or invented page totals", () => {
    const data = sampleData()
    data.rankings = {
      ...data.rankings,
      state: "unavailable",
      data: null,
      window: null,
      note: "Only thresholded selection snapshots from rolling windows are retained.",
    }
    const ui = renderPanel(data).querySelector('[data-seo-family="rankings"]')!
    expect(ui.textContent).toContain("Unavailable")
    expect(ui.textContent).toContain("selection snapshots")
    expect(ui.querySelector("svg")).toBeNull()
    expect(ui.querySelector("[data-metric]")).toBeNull()
  })

  it("masks the complete panel and exposes its parent-owned tab relationship", () => {
    const panel = renderPanel().querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute("data-dd-privacy")).toBe("mask")
    expect(panel.id).toBe("seo-panel")
    expect(panel.getAttribute("aria-labelledby")).toBe("seo-tab")
  })

  it("preserves measured zero and explains unavailable metrics and watch-depth denominators", () => {
    const ui = renderPanel()
    const reach = ui.querySelector('[data-seo-family="reach"]')!
    expect(reach.textContent).toContain("Partial coverage")
    expect(
      reach.querySelector('[data-metric="Page views"]')?.textContent,
    ).toContain("0")
    expect(
      reach.querySelector('[data-metric="Visitors"]')?.textContent,
    ).toContain("Unavailable")
    const viewing = ui.querySelector('[data-seo-family="viewing"]')!
    expect(viewing.textContent).toContain("48%")
    expect(viewing.textContent).toContain("90 of 120 starts")
    expect(viewing.textContent).toContain("50% of the video")
    expect(viewing.textContent).toContain("Unavailable")
  })

  it("labels ranking direction, axes, legend and missing-day gaps without fabricating a line", () => {
    const ui = renderPanel()
    const graph = ui.querySelector('svg[role="img"]')!
    expect(graph.textContent).toContain("Higher is better")
    expect(graph.textContent).toContain("Position 1 is best")
    expect(graph.textContent).toContain("Average search position")
    expect(graph.textContent).toContain("Date")
    expect(graph.querySelectorAll("polyline")).toHaveLength(0)
    expect(graph.querySelectorAll("circle")).toHaveLength(2)
    expect(ui.textContent).toContain("Gaps mean no observation")
    const table = ui.querySelector('table[aria-label="Ranking observations"]')!
    expect(table.textContent).toContain("Oct 2, 2026")
    expect(table.textContent).toContain("Unavailable")
    const point = graph.querySelector<SVGElement>('[tabindex="0"]')!
    act(() => point.dispatchEvent(new FocusEvent("focusin", { bubbles: true })))
    expect(ui.querySelector('[role="tooltip"]')?.textContent).toContain(
      "position 8",
    )
    act(() =>
      point.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    )
    expect(ui.querySelector('[role="tooltip"]')).toBeNull()
  })

  it("shows per-CTA clicks and outcome evidence and hands immutable actions to Admin", () => {
    const ui = renderPanel()
    const opportunity = ui.querySelector(
      '[data-proposal-id="sample/proposal"]',
    )!
    expect(opportunity.textContent).toContain("Download video")
    expect(opportunity.textContent).toContain("0 clicks")
    expect(opportunity.textContent).toContain(
      "Completed downloads: Unavailable",
    )
    expect(opportunity.textContent).toContain("120")
    expect(opportunity.textContent).toContain("Sample stored observation")
    expect(opportunity.textContent).toContain("Creates a draft for review.")
    expect(opportunity.textContent).toContain("never publishes")
    for (const action of ["apply", "decline"]) {
      const link = opportunity.querySelector<HTMLAnchorElement>(
        `a[data-decision="${action}"]`,
      )!
      const url = new URL(link.href)
      expect(url.origin).toBe("https://admin.example.org")
      expect(url.pathname).toBe("/seo/confirm")
      expect(url.searchParams.get("proposalId")).toBe("sample/proposal")
      expect(url.searchParams.get("version")).toBe("2")
      expect(url.searchParams.get("payloadDigest")).toBe("sample-digest+v2")
      expect(url.searchParams.get("decision")).toBe(action)
      expect(link.rel).toContain("noreferrer")
    }
  })

  it.each([
    "stale",
    "expired",
    "already_decided",
    "conflict",
    "replay",
    "rejected",
    "retryable_error",
  ] as const)(
    "explains %s proposals and disables decisions",
    (decisionState) => {
      const data = sampleData()
      data.opportunities.data!.items[0].decisionState = decisionState
      const card = renderPanel(data).querySelector("[data-proposal-id]")!
      expect(card.querySelector("a[data-decision]")).toBeNull()
      expect(card.querySelector('[role="status"]')?.textContent).toBeTruthy()
    },
  )

  it.each([
    "available",
    "partial",
    "unavailable",
    "not_connected",
    "stale",
    "compacted",
  ] as const)("keeps the %s family state explicit", (state) => {
    const data = sampleData()
    data.aiTraffic = evidence<AiTrafficEvidence>(null, state)
    const family = renderPanel(data).querySelector(
      '[data-seo-family="aiTraffic"]',
    )!
    expect(family.getAttribute("data-availability")).toBe(state)
    expect(family.textContent).toContain("Unavailable")
  })

  it("provides content, crawler, social and chat previews with provenance and warnings", () => {
    const ui = renderPanel()
    for (const heading of [
      "Search reach",
      "Video performance",
      "Calls to action",
      "AI-assistant traffic",
      "Content analysis",
      "How bots see it",
      "Social preview",
      "Chat preview",
      "Opportunities",
    ]) {
      expect(
        [...ui.querySelectorAll("h3, h4")].some(
          (node) => node.textContent === heading,
        ),
      ).toBe(true)
    }
    expect(ui.querySelector('[role="alert"]')?.textContent).toContain(
      "Some evidence is missing",
    )
    expect(ui.textContent).toContain("Stored direct HTTP observation")
    expect(ui.textContent).toContain("does not prove search indexing")
    expect(ui.textContent).toContain("Sample stored observation")
    expect(ui.querySelectorAll("[data-preview-kind]")).toHaveLength(2)
  })

  it("does not expose retained data from unavailable or compacted families", () => {
    const data = sampleData()
    data.content.state = "compacted"
    data.content.data!.title = "Do not render retained detailed evidence"
    const ui = renderPanel(data)
    expect(ui.textContent).not.toContain(
      "Do not render retained detailed evidence",
    )
  })

  it("fails closed for a confirmation URL on a different origin", () => {
    container = document.createElement("div")
    root = createRoot(container)
    act(() =>
      root!.render(
        createElement(SeoMarketingPanel, {
          id: "seo",
          labelledBy: "tab",
          state: { status: "ready", data: sampleData() },
          adminOrigin: "https://admin.example.org",
          adminConfirmationUrl: "https://other.example.org/confirm",
        }),
      ),
    )
    expect(container.querySelector("a[data-decision]")).toBeNull()
    expect(container.textContent).toContain("Admin confirmation is unavailable")
  })

  it.each(["loading", "error", "empty"] as const)(
    "renders a masked %s state with a usable retry when supplied",
    (status) => {
      const onRetry = vi.fn()
      container = document.createElement("div")
      root = createRoot(container)
      act(() =>
        root!.render(
          createElement(SeoMarketingPanel, {
            id: "seo",
            labelledBy: "tab",
            state: { status },
            onRetry,
            adminOrigin: "https://admin.example.org",
            adminConfirmationUrl: "https://admin.example.org/confirm",
          }),
        ),
      )
      expect(container.querySelector('[data-dd-privacy="mask"]')).not.toBeNull()
      expect(
        container.querySelector('[role="tabpanel"]')?.getAttribute("aria-busy"),
      ).toBe(status === "loading" ? "true" : "false")
      if (status === "error") {
        act(() => container.querySelector("button")?.click())
        expect(onRetry).toHaveBeenCalledOnce()
      }
    },
  )

  it("provides a controlled, keyboard-operable tab without initiating loading", () => {
    const onSelect = vi.fn()
    container = document.createElement("div")
    root = createRoot(container)
    act(() =>
      root!.render(
        createElement(WatchSeoTab, {
          id: "seo-tab",
          panelId: "seo-panel",
          selected: false,
          onSelect,
        }),
      ),
    )
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]')!
    expect(tab.hasAttribute("aria-controls")).toBe(false)
    expect(tab.getAttribute("aria-selected")).toBe("false")
    expect(onSelect).not.toHaveBeenCalled()
    act(() => tab.click())
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
