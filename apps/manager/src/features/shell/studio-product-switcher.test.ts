// @vitest-environment jsdom

import React, { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  filterStudioProductGroups,
  flattenStudioProductGroups,
  getStudioProductGroups,
  getStudioRouteProductForPathname,
  StudioProductSwitcher,
  type StudioSelectableProduct,
  type StudioSelectableProductKey,
} from "./studio-product-switcher"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// The five former primary-sidebar links, now route entries in the dropdown.
const ROUTE_ENTRIES = [
  ["media", "smart-crop", "Smart Crop", "/dashboard/smart-crop"],
  ["media", "shorts", "Shorts", "/dashboard/shorts"],
  ["marketing", "seo", "SEO", "/dashboard/seo"],
  ["operations", "alerts", "Alerts", "/dashboard/alerts"],
  ["operations", "agents", "Agents", "/dashboard/agents"],
] as const

const SELECTABLE_LABELS = [
  "Subtitles",
  "Audio",
  "Meta",
  "Smart Crop",
  "Shorts",
  "SEO",
  "Alerts",
  "Agents",
]

const fullCatalog = [
  ["Media", ["Subtitles", "Audio", "Meta", "Smart Crop", "Shorts"]],
  ["Marketing", ["SEO", "Campaigns"]],
  ["Support", ["HS Support Agent", "HS User Discovery"]],
  [
    "Operations",
    [
      "Alerts",
      "Agents",
      "Agent Registry",
      "Agent Runs",
      "Automations",
      "Evaluations",
      "Monitoring",
    ],
  ],
  ["Analytics/Data", ["Custom Dashboards", "Reports", "Questions"]],
  ["Website", ["Website Editor"]],
] as const

// Rendered option text: unavailable entries carry a "Coming Soon" badge.
const soon = (label: string) => `${label}Coming Soon`
const rendered = (label: string) =>
  SELECTABLE_LABELS.includes(label) ? label : soon(label)
const renderedCatalog = fullCatalog.map(([group, labels]) => [
  group,
  labels.map(rendered),
])
const catalogSummary = (
  catalog: ReturnType<typeof filterStudioProductGroups>,
) =>
  catalog.map((group) => [
    group.label,
    group.products.map((product) => product.label),
  ])

describe("Studio product catalog", () => {
  it("defines six groups and twenty entries with eight selectable entries", () => {
    expect(catalogSummary([...getStudioProductGroups()])).toEqual(fullCatalog)

    const products = flattenStudioProductGroups(getStudioProductGroups())
    expect(products).toHaveLength(20)
    expect(new Set(products.map((product) => product.label)).size).toBe(20)
    expect(
      products
        .filter((product) => product.available)
        .map((product) => product.label),
    ).toEqual(SELECTABLE_LABELS)
    expect(
      products
        .filter((product) => product.kind === "report")
        .map((product) => product.key),
    ).toEqual(["subtitles", "audio", "meta"])
    expect(
      products.filter((product) => product.kind === "unavailable"),
    ).toHaveLength(12)
    for (const product of products) {
      expect(product.available).toBe(product.kind !== "unavailable")
    }
  })

  it("places each moved link once, in its group, with its exact route", () => {
    const routeEntries = getStudioProductGroups().flatMap((group) =>
      group.products.flatMap((product) =>
        product.kind === "route"
          ? [[group.key, product.key, product.label, product.href]]
          : [],
      ),
    )

    expect(routeEntries).toEqual(ROUTE_ENTRIES)
  })

  it("maps route pathnames (and their sub-pages) to their route entry", () => {
    const keyFor = (pathname: string) =>
      getStudioRouteProductForPathname(pathname)?.key ?? null

    expect(keyFor("/dashboard/smart-crop")).toBe("smart-crop")
    expect(keyFor("/dashboard/smart-crop/job-1")).toBe("smart-crop")
    expect(keyFor("/dashboard/shorts")).toBe("shorts")
    expect(keyFor("/dashboard/shorts/new")).toBe("shorts")
    expect(keyFor("/dashboard/shorts/calendar")).toBe("shorts")
    expect(keyFor("/dashboard/seo")).toBe("seo")
    expect(keyFor("/dashboard/alerts")).toBe("alerts")
    expect(keyFor("/dashboard/agents")).toBe("agents")
    expect(keyFor("/dashboard/agents/run-1")).toBe("agents")

    for (const pathname of [
      "/dashboard",
      "/dashboard/coverage",
      "/dashboard/jobs",
      "/dashboard/jobs/job-1",
      "/dashboard/subtitle-lab",
      "/dashboard/shortsx",
      "/design",
    ]) {
      expect(keyFor(pathname)).toBeNull()
    }
  })
})

describe("StudioProductSwitcher", () => {
  let container: HTMLDivElement
  let outside: HTMLButtonElement
  let root: ReturnType<typeof createRoot>
  let onSelect: ReturnType<
    typeof vi.fn<(product: StudioSelectableProduct) => void>
  >

  async function renderSwitcher(currentKey: StudioSelectableProductKey) {
    await act(async () => {
      root.render(
        React.createElement(
          StrictMode,
          null,
          React.createElement(StudioProductSwitcher, {
            currentKey,
            onSelect,
            triggerClassName: "topbar-button",
          }),
        ),
      )
    })
  }

  beforeEach(async () => {
    container = document.createElement("div")
    outside = document.createElement("button")
    document.body.append(container, outside)
    root = createRoot(container)
    onSelect = vi.fn<(product: StudioSelectableProduct) => void>()

    await renderSwitcher("subtitles")
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    outside.remove()
  })

  const trigger = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch product"]',
    )!
  const input = () =>
    container.querySelector<HTMLInputElement>('input[role="combobox"]')
  const options = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
  const option = (text: string) =>
    options().find((candidate) => candidate.textContent === text)!
  const groups = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="group"]'))
  const groupName = (group: HTMLElement) =>
    document.getElementById(group.getAttribute("aria-labelledby") ?? "")
      ?.textContent
  const groupSummary = () =>
    groups().map((group) => [
      groupName(group),
      Array.from(
        group.querySelectorAll<HTMLElement>('[role="option"]'),
        (entry) => entry.textContent,
      ),
    ])
  const activeOption = () =>
    document.getElementById(
      input()?.getAttribute("aria-activedescendant") ?? "",
    )
  const comingSoonBadges = (entry: HTMLElement) =>
    Array.from(
      entry.querySelectorAll<HTMLElement>(".studio-product-switch-coming-soon"),
    )
  const ACTIVE_HIGHLIGHT =
    "bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)]"
  const optionClasses = (entry: HTMLElement) =>
    entry.className.split(/\s+/).filter(Boolean)
  const lastSelected = () => onSelect.mock.lastCall?.[0]

  async function press(key: string) {
    await act(async () => {
      input()!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key }),
      )
    })
  }

  async function openSwitcher() {
    await act(async () => {
      trigger().click()
    })
  }

  async function hover(entry: HTMLElement) {
    await act(async () => {
      entry.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    })
  }

  function expectNoActiveDescendant() {
    expect(input()?.hasAttribute("aria-activedescendant")).toBe(false)
    expect(activeOption()).toBeNull()
  }

  function expectClosedWithFocusOnTrigger() {
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(input()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  }

  async function typeQuery(value: string) {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!

    await act(async () => {
      setValue.call(input(), value)
      input()!.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  it("renders only the closed trigger until opened", () => {
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(trigger().className).toContain("topbar-button")
    expect(trigger().className).toContain("studio-product-switch-trigger")
    expect(trigger().className).toContain("w-full")
    expect(container.textContent).toContain("Switch product")
    expect(input()).toBeNull()
    expect(options()).toHaveLength(0)
  })

  it("opens with focus in the filter, labelled groups and Subtitles current", async () => {
    await openSwitcher()

    expect(trigger().getAttribute("aria-expanded")).toBe("true")
    expect(document.activeElement).toBe(input())
    expect(groupSummary()).toEqual([
      ["Media", ["SubtitlesCurrent", "Audio", "Meta", "Smart Crop", "Shorts"]],
      ...renderedCatalog.slice(1),
    ])
    for (const group of groups()) {
      expect(group.parentElement?.getAttribute("role")).toBe("listbox")
    }

    const subtitles = options()[0]
    expect(subtitles.getAttribute("aria-selected")).toBe("true")
    expect(
      options().filter(
        (entry) => entry.getAttribute("aria-selected") === "true",
      ),
    ).toEqual([subtitles])

    const selectable = options().filter(
      (entry) => !entry.hasAttribute("aria-disabled"),
    )
    expect(
      selectable.map((entry) => entry.textContent?.replace("Current", "")),
    ).toEqual(SELECTABLE_LABELS)
    for (const entry of selectable) {
      expect(comingSoonBadges(entry)).toHaveLength(0)
      expect(entry.textContent).not.toContain("Coming Soon")
      expect(optionClasses(entry)).toContain("cursor-pointer")
      expect(optionClasses(entry)).not.toContain("cursor-not-allowed")
      expect(
        optionClasses(entry).some((name) => name.startsWith("opacity-")),
      ).toBe(false)
    }

    const future = options().filter((entry) =>
      entry.hasAttribute("aria-disabled"),
    )
    expect(future).toHaveLength(12)
    for (const entry of future) {
      expect(entry.getAttribute("aria-selected")).toBe("false")
      expect(entry.getAttribute("aria-disabled")).toBe("true")
      const badges = comingSoonBadges(entry)
      expect(badges).toHaveLength(1)
      expect(badges[0].textContent).toBe("Coming Soon")
      expect(optionClasses(entry)).toEqual(
        expect.arrayContaining(["opacity-50", "cursor-not-allowed"]),
      )
      expect(optionClasses(entry)).not.toContain("cursor-pointer")
      expect(optionClasses(entry)).not.toContain(ACTIVE_HIGHLIGHT)
    }
    expect(
      container.querySelectorAll(".studio-product-switch-coming-soon"),
    ).toHaveLength(12)
    expect(activeOption()).toBe(subtitles)
    expect(optionClasses(subtitles)).toContain(ACTIVE_HIGHLIGHT)
  })

  it("marks the supplied report or route key as current and starts there", async () => {
    for (const [key, label] of [
      ["audio", "Audio"],
      ["meta", "Meta"],
      ["smart-crop", "Smart Crop"],
      ["shorts", "Shorts"],
      ["seo", "SEO"],
      ["alerts", "Alerts"],
      ["agents", "Agents"],
    ] as const) {
      await renderSwitcher(key)
      await openSwitcher()

      expect(
        options()
          .filter((entry) => entry.getAttribute("aria-selected") === "true")
          .map((entry) => entry.textContent),
      ).toEqual([`${label}Current`])
      expect(activeOption()?.textContent).toBe(`${label}Current`)

      await press("Escape")
    }
  })

  it("passes Audio and Meta report entries to onSelect, then closes", async () => {
    await openSwitcher()
    await press("ArrowDown")
    expect(activeOption()?.textContent).toBe("Audio")
    await press("Enter")

    expect(lastSelected()).toMatchObject({ kind: "report", key: "audio" })
    expectClosedWithFocusOnTrigger()

    await renderSwitcher("audio")
    await openSwitcher()
    await act(async () => {
      option("Meta").click()
    })

    expect(lastSelected()).toMatchObject({ kind: "report", key: "meta" })
    expect(onSelect).toHaveBeenCalledTimes(2)
    expectClosedWithFocusOnTrigger()

    // Search keeps report entries selectable.
    await renderSwitcher("meta")
    await openSwitcher()
    await typeQuery("sub")
    await press("Enter")
    expect(lastSelected()).toMatchObject({ kind: "report", key: "subtitles" })
    expectClosedWithFocusOnTrigger()
  })

  it("passes each moved route entry, with its exact href, to onSelect by click", async () => {
    for (const [, key, label, href] of ROUTE_ENTRIES) {
      await openSwitcher()
      await act(async () => {
        option(label).click()
      })

      expect(lastSelected()).toMatchObject({ kind: "route", key, href, label })
      expectClosedWithFocusOnTrigger()
    }
    expect(onSelect).toHaveBeenCalledTimes(5)
  })

  it("selects route entries by keyboard and by search", async () => {
    await openSwitcher()
    for (let step = 0; step < 3; step += 1) {
      await press("ArrowDown")
    }
    expect(activeOption()?.textContent).toBe("Smart Crop")
    await press("Enter")
    expect(lastSelected()).toMatchObject({
      kind: "route",
      href: "/dashboard/smart-crop",
    })
    expectClosedWithFocusOnTrigger()

    for (const [query, href] of [
      ["shorts", "/dashboard/shorts"],
      ["seo", "/dashboard/seo"],
      ["alert", "/dashboard/alerts"],
    ] as const) {
      await openSwitcher()
      await typeQuery(query)
      await press("Enter")
      expect(lastSelected()).toMatchObject({ kind: "route", href })
      expectClosedWithFocusOnTrigger()
    }

    await openSwitcher()
    await press("End")
    expect(activeOption()?.textContent).toBe("Agents")
    await press("Enter")
    expect(lastSelected()).toMatchObject({
      kind: "route",
      href: "/dashboard/agents",
    })
  })

  it("moves the active option only across selectable entries with arrow, Home and End keys", async () => {
    await openSwitcher()

    const visited: string[] = []
    for (let step = 0; step < 9; step += 1) {
      await press("ArrowDown")
      visited.push(activeOption()?.textContent ?? "")
    }
    expect(visited).toEqual([
      "Audio",
      "Meta",
      "Smart Crop",
      "Shorts",
      "SEO",
      "Alerts",
      "Agents",
      "SubtitlesCurrent",
      "Audio",
    ])

    await press("ArrowUp")
    expect(activeOption()?.textContent).toBe("SubtitlesCurrent")
    await press("ArrowUp")
    expect(activeOption()?.textContent).toBe("Agents")
    await press("ArrowUp")
    expect(activeOption()?.textContent).toBe("Alerts")
    await press("Home")
    expect(activeOption()?.textContent).toBe("SubtitlesCurrent")
    await press("End")
    expect(activeOption()?.textContent).toBe("Agents")
    await press("ArrowDown")
    expect(activeOption()?.textContent).toBe("SubtitlesCurrent")

    // Every key lands on a selectable, highlighted option.
    for (const key of ["End", "ArrowUp", "Home", "ArrowUp", "ArrowDown"]) {
      await press(key)
      expect(activeOption()?.getAttribute("aria-disabled")).toBeNull()
      expect(optionClasses(activeOption()!)).toContain(ACTIVE_HIGHLIGHT)
    }
  })

  it("keeps keyboard movement on selectable entries in filtered results", async () => {
    await openSwitcher()
    await typeQuery("ts")

    expect(groupSummary()).toEqual([
      ["Media", ["Shorts"]],
      ["Operations", ["Alerts", "Agents"]],
      ["Analytics/Data", [soon("Reports")]],
    ])
    expect(activeOption()?.textContent).toBe("Shorts")
    const visited: string[] = []
    for (let step = 0; step < 3; step += 1) {
      await press("ArrowDown")
      visited.push(activeOption()?.textContent ?? "")
    }
    expect(visited).toEqual(["Alerts", "Agents", "Shorts"])
    await press("ArrowUp")
    expect(activeOption()?.textContent).toBe("Agents")
    await press("End")
    expect(activeOption()?.textContent).toBe("Agents")
    await press("Home")
    expect(activeOption()?.textContent).toBe("Shorts")

    await typeQuery("ta")
    expect(groupSummary()).toEqual([
      ["Media", ["Meta"]],
      [
        "Analytics/Data",
        ["Custom Dashboards", "Reports", "Questions"].map(soon),
      ],
    ])
    expect(activeOption()?.textContent).toBe("Meta")
    for (const key of ["ArrowDown", "ArrowUp", "End", "Home"]) {
      await press(key)
      expect(activeOption()?.textContent).toBe("Meta")
    }
    await press("Enter")
    expect(lastSelected()).toMatchObject({ kind: "report", key: "meta" })
    expectClosedWithFocusOnTrigger()
  })

  it("omits the active descendant and ignores Enter when results are all Coming Soon", async () => {
    await openSwitcher()
    await typeQuery("support")

    expect(groupSummary()).toEqual([
      ["Support", ["HS Support Agent", "HS User Discovery"].map(soon)],
    ])
    expectNoActiveDescendant()

    for (const key of ["End", "ArrowDown", "ArrowUp", "Home", "Enter"]) {
      await press(key)
      expectNoActiveDescendant()
    }
    expect(trigger().getAttribute("aria-expanded")).toBe("true")
    expect(onSelect).not.toHaveBeenCalled()
    for (const entry of options()) {
      expect(optionClasses(entry)).not.toContain(ACTIVE_HIGHLIGHT)
    }

    // Hovering a disabled-only result still activates nothing.
    await hover(options()[0])
    expectNoActiveDescendant()
    await press("Enter")
    expect(onSelect).not.toHaveBeenCalled()

    for (const query of ["data", "website", "registry"]) {
      await typeQuery(query)
      expect(options().length).toBeGreaterThan(0)
      expectNoActiveDescendant()
      await press("Enter")
      expect(onSelect).not.toHaveBeenCalled()
    }

    await typeQuery("sub")
    expect(groupSummary()).toEqual([["Media", ["SubtitlesCurrent"]]])
    expect(activeOption()?.textContent).toContain("Subtitles")

    await press("Enter")
    expectClosedWithFocusOnTrigger()
  })

  it("ignores hover and click on Coming Soon entries", async () => {
    await openSwitcher()
    const subtitles = options()[0]
    const campaigns = option(soon("Campaigns"))

    await hover(campaigns)
    expect(activeOption()).toBe(subtitles)
    expect(optionClasses(campaigns)).not.toContain(ACTIVE_HIGHLIGHT)
    expect(optionClasses(subtitles)).toContain(ACTIVE_HIGHLIGHT)

    await act(async () => {
      campaigns.click()
    })
    expect(trigger().getAttribute("aria-expanded")).toBe("true")
    expect(activeOption()).toBe(subtitles)
    expect(onSelect).not.toHaveBeenCalled()

    // Hovering a selectable entry still moves the active option.
    await hover(option("SEO"))
    expect(activeOption()?.textContent).toBe("SEO")
    await hover(options().at(-1)!)
    expect(activeOption()?.textContent).toBe("SEO")

    // Enter after hovering a disabled entry selects only the active one.
    await press("Enter")
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(lastSelected()).toMatchObject({
      kind: "route",
      href: "/dashboard/seo",
    })
  })

  it("closes and restores focus when Escape is pressed", async () => {
    await openSwitcher()
    await press("Escape")

    expectClosedWithFocusOnTrigger()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("filters entries, omits empty groups and reports an empty match", async () => {
    expect(catalogSummary(filterStudioProductGroups(""))).toEqual(fullCatalog)
    expect(catalogSummary(filterStudioProductGroups("  CAMP "))).toEqual([
      ["Marketing", ["Campaigns"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("marketing"))).toEqual([
      ["Marketing", ["SEO", "Campaigns"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("meta"))).toEqual([
      ["Media", ["Meta"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("media"))).toEqual([
      ["Media", ["Subtitles", "Audio", "Meta", "Smart Crop", "Shorts"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("content"))).toEqual([])
    expect(catalogSummary(filterStudioProductGroups("discovery"))).toEqual([
      ["Support", ["HS User Discovery"]],
    ])

    // Each moved entry is findable on its own.
    expect(catalogSummary(filterStudioProductGroups("smart crop"))).toEqual([
      ["Media", ["Smart Crop"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("SHORTS"))).toEqual([
      ["Media", ["Shorts"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("seo"))).toEqual([
      ["Marketing", ["SEO"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("alerts"))).toEqual([
      ["Operations", ["Alerts"]],
    ])
    expect(catalogSummary(filterStudioProductGroups("agents"))).toEqual([
      ["Operations", ["Agents"]],
    ])

    // Group-name matches keep every entry in the group.
    expect(catalogSummary(filterStudioProductGroups("DATA"))).toEqual([
      ["Analytics/Data", ["Custom Dashboards", "Reports", "Questions"]],
    ])
    expect(catalogSummary(filterStudioProductGroups(" OPERAT"))).toEqual(
      fullCatalog.filter(([label]) => label === "Operations"),
    )
    expect(catalogSummary(filterStudioProductGroups("website"))).toEqual([
      ["Website", ["Website Editor"]],
    ])

    await openSwitcher()
    await typeQuery("agent")
    expect(groupSummary()).toEqual([
      ["Support", [soon("HS Support Agent")]],
      ["Operations", ["Agents", ...["Agent Registry", "Agent Runs"].map(soon)]],
    ])
    expect(activeOption()?.textContent).toBe("Agents")
    await press("ArrowDown")
    expect(activeOption()?.textContent).toBe("Agents")

    await typeQuery("operations")
    expect(groupSummary()).toEqual(
      renderedCatalog.filter(([label]) => label === "Operations"),
    )
    expect(activeOption()?.textContent).toBe("Alerts")
    await press("End")
    expect(activeOption()?.textContent).toBe("Agents")

    await typeQuery("au")
    expect(groupSummary()).toEqual([
      ["Media", ["Audio"]],
      ["Operations", [soon("Automations")]],
    ])
    expect(activeOption()?.textContent).toBe("Audio")
    await press("End")
    expect(activeOption()?.textContent).toBe("Audio")

    await typeQuery("zzz")
    expect(options()).toHaveLength(0)
    expect(groups()).toHaveLength(0)
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "zzz",
    )
  })

  it("closes on an outside pointer press and resets the filter", async () => {
    await openSwitcher()
    await act(async () => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })

    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(onSelect).not.toHaveBeenCalled()

    await openSwitcher()
    expect(input()?.value).toBe("")
    expect(options()).toHaveLength(20)
    expect(groups()).toHaveLength(6)
  })
})
