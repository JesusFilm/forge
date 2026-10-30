// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import React, { act, StrictMode, Suspense, type ComponentProps } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup, renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ManagerDashboardShell,
  useManagerShellState,
  useOptionalManagerShellState,
} from "./manager-shell"
import { EditorSession } from "../video-studio/editor-session"
import { guardEditorNavigation } from "../video-studio/editor-navigation"
import { startEditorAutosave } from "../video-studio/editor-autosave"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const navigation = vi.hoisted(() => ({
  pathname: "/dashboard/jobs",
  push: vi.fn(),
  search: "",
}))

const api = vi.hoisted(() => ({ queueTotal: null as number | null }))

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({
    push: navigation.push,
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async () =>
    api.queueTotal == null
      ? new Response(null, { status: 204 })
      : Response.json({ total: api.queueTotal }),
  ),
}))

const REPORT_STORAGE_KEY = "forge-coverage-report"
class IsolatedSaveError extends Error {}

function shellElement(children: React.ReactNode) {
  return React.createElement(
    ManagerDashboardShell,
    {
      user: { email: "manager@forge.test", username: "manager" },
    } as ComponentProps<typeof ManagerDashboardShell>,
    children,
  )
}

function renderShell(pathname: string) {
  navigation.pathname = pathname
  document.body.innerHTML = renderToStaticMarkup(
    shellElement(React.createElement("p", null, "Page")),
  )
}

function ReportProbe() {
  const shell = useManagerShellState()
  return React.createElement("output", { "data-report": shell.reportType })
}

const productTrigger = () =>
  document.querySelector<HTMLButtonElement>(
    'button[aria-label="Switch product"]',
  )

const submenuNav = () =>
  document.querySelector<HTMLElement>(
    ".design-system-sidebar-content nav.design-system-shell-nav",
  )

const submenuLinks = () =>
  Array.from(submenuNav()?.querySelectorAll("a") ?? []).map((link) => [
    link.getAttribute("aria-label"),
    link.getAttribute("href"),
  ])

const activeLinks = () =>
  Array.from(
    submenuNav()?.querySelectorAll('a[aria-current="page"]') ?? [],
  ).map((link) => link.getAttribute("aria-label"))

const reportType = () =>
  document.querySelector("output")?.getAttribute("data-report")

const REPORT_SUBMENU = [
  ["Report", "/dashboard/coverage"],
  ["Jobs", "/dashboard/jobs"],
]

const SUBTITLES_SUBMENU = [
  ...REPORT_SUBMENU,
  ["Subtitle Lab", "/dashboard/subtitle-lab"],
]

const SHORTS_SUBMENU = [
  ["Projects", "/dashboard/shorts"],
  ["New Project", "/dashboard/shorts/new"],
  ["Planning Calendar", "/dashboard/shorts/calendar"],
]

const ROUTE_PRODUCTS = [
  ["Smart Crop", "/dashboard/smart-crop"],
  ["Shorts", "/dashboard/shorts"],
  ["SEO", "/dashboard/seo"],
  ["Alerts", "/dashboard/alerts"],
  ["Agents", "/dashboard/agents"],
] as const

function stubMatchMedia() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  )
}

let mounted: { container: HTMLElement; root: Root } | null = null

async function mountShell(pathname: string, search = "") {
  navigation.pathname = pathname
  navigation.search = search
  stubMatchMedia()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(shellElement(React.createElement(ReportProbe)))
  })

  mounted = { container, root }
  return mounted
}

async function hydrateShell(pathname: string) {
  navigation.pathname = pathname
  stubMatchMedia()
  const element = React.createElement(
    StrictMode,
    null,
    shellElement(React.createElement(ReportProbe)),
  )
  // Render the actual shell without browser storage, then hydrate that HTML
  // with storage present. createRoot and SSR inside jsdom alone miss this seam.
  const browserWindow = window
  let html: string
  vi.stubGlobal("window", undefined)
  try {
    html = renderToString(element)
  } finally {
    vi.stubGlobal("window", browserWindow)
  }
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.append(container)
  const serverNav = container.querySelector("nav.design-system-shell-nav")
  expect(serverNav?.getAttribute("aria-label")).toBe("Subtitles menu")
  const recoverableErrors: unknown[] = []
  await act(async () => {
    mounted = {
      container,
      root: hydrateRoot(container, element, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      }),
    }
  })
  return recoverableErrors
}

async function hydrateDelayedReport(
  pathname: string,
  useShellState:
    | typeof useManagerShellState
    | typeof useOptionalManagerShellState,
) {
  navigation.pathname = pathname
  stubMatchMedia()
  let server = true
  let ready = false
  let release!: () => void
  const pending = new Promise<void>((resolve) => (release = resolve))
  const clientSetters: Array<
    ReturnType<typeof useManagerShellState>["setReportType"]
  > = []
  function DelayedReport() {
    const shell = useShellState()
    if (!shell) throw new Error("Expected the real shell provider")
    if (!server) clientSetters.push(shell.setReportType)
    if (!server && !ready) throw pending
    return React.createElement(
      "output",
      { "data-report": shell.reportType },
      shell.reportType,
    )
  }
  const element = React.createElement(
    StrictMode,
    null,
    shellElement(
      React.createElement(
        Suspense,
        { fallback: React.createElement("p", null, "Loading report") },
        React.createElement(DelayedReport),
      ),
    ),
  )
  const browserWindow = window
  let html: string
  vi.stubGlobal("window", undefined)
  try {
    html = renderToString(element)
  } finally {
    vi.stubGlobal("window", browserWindow)
  }
  server = false
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.append(container)
  expect(reportType()).toBe("subtitles")
  const errors: unknown[] = []
  await act(async () => {
    mounted = {
      container,
      root: hydrateRoot(container, element, {
        onRecoverableError: (error) => errors.push(error),
      }),
    }
  })
  return {
    errors,
    async resume() {
      await act(async () => {
        ready = true
        release()
        await pending
      })
      expect(new Set(clientSetters).size).toBe(1)
    },
  }
}

/** Simulates the router finishing a navigation to `pathname`. */
async function navigateTo(pathname: string, search = "") {
  navigation.pathname = pathname
  navigation.search = search
  await act(async () => {
    mounted!.root.render(shellElement(React.createElement(ReportProbe)))
  })
}

const options = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))

const currentOptions = () =>
  options()
    .filter((option) => option.getAttribute("aria-selected") === "true")
    .map((option) => option.textContent)

async function chooseProduct(label: string) {
  await act(async () => {
    productTrigger()!.click()
  })
  const option = options().find(
    (candidate) =>
      candidate.textContent === label ||
      candidate.textContent === `${label}Current` ||
      candidate.textContent === `${label}Coming Soon`,
  )!
  await act(async () => {
    option.click()
  })
}

describe("ManagerDashboardShell product submenu", () => {
  afterEach(async () => {
    if (mounted) {
      const { root } = mounted
      await act(async () => {
        root.unmount()
      })
      mounted = null
    }
    document.body.innerHTML = ""
    window.sessionStorage.clear()
    navigation.push.mockReset()
    navigation.search = ""
    api.queueTotal = null
    vi.unstubAllGlobals()
  })

  describe.each([
    ["required", useManagerShellState],
    ["optional", useOptionalManagerShellState],
  ] as const)("%s shell consumer hydration", (_hook, useShellState) => {
    it.each(
      ["/dashboard/jobs", "/dashboard/coverage"].flatMap((pathname) =>
        ["audio", "meta"].map((stored) => ({ pathname, stored })),
      ),
    )(
      "keeps the SSR snapshot while $stored on $pathname is delayed",
      async ({ pathname, stored }) => {
        window.sessionStorage.setItem(REPORT_STORAGE_KEY, stored)
        const write = vi.spyOn(Storage.prototype, "setItem")
        try {
          const delayed = await hydrateDelayedReport(pathname, useShellState)
          expect(submenuNav()?.dataset.product).toBe(stored)
          expect(reportType()).toBe("subtitles")
          await delayed.resume()
          expect(delayed.errors).toEqual([])
          expect(reportType()).toBe(stored)
          expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe(stored)
          expect(write).not.toHaveBeenCalled()
        } finally {
          write.mockRestore()
        }
      },
    )

    it.each([null, "invalid", "subtitles"])(
      "preserves the default with delayed stored %s",
      async (stored) => {
        if (stored !== null)
          window.sessionStorage.setItem(REPORT_STORAGE_KEY, stored)
        const delayed = await hydrateDelayedReport(
          "/dashboard/coverage",
          useShellState,
        )
        await delayed.resume()
        expect(delayed.errors).toEqual([])
        expect(reportType()).toBe("subtitles")
        expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe(stored)
      },
    )

    it("preserves Subtitle Lab ownership for a delayed consumer", async () => {
      window.sessionStorage.setItem(REPORT_STORAGE_KEY, "meta")
      const delayed = await hydrateDelayedReport(
        "/dashboard/subtitle-lab",
        useShellState,
      )
      await delayed.resume()
      expect(delayed.errors).toEqual([])
      expect(reportType()).toBe("subtitles")
      expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe(
        "subtitles",
      )
    })

    it.each(["Audio", "Meta"])(
      "retains in-memory %s chosen while denied-storage consumer is delayed",
      async (product) => {
        const read = Storage.prototype.getItem
        const write = Storage.prototype.setItem
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
          this: Storage,
          key,
        ) {
          if (this === window.sessionStorage)
            throw new DOMException("Storage denied", "SecurityError")
          return read.call(this, key)
        })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
          this: Storage,
          key,
          value,
        ) {
          if (this === window.sessionStorage)
            throw new DOMException("Storage denied", "SecurityError")
          return write.call(this, key, value)
        })
        try {
          const delayed = await hydrateDelayedReport(
            "/dashboard/coverage",
            useShellState,
          )
          expect(reportType()).toBe("subtitles")
          await chooseProduct(product)
          expect(submenuNav()?.dataset.product).toBe(product.toLowerCase())
          await delayed.resume()
          expect(delayed.errors).toEqual([])
          expect(reportType()).toBe(product.toLowerCase())
          expect(navigation.push).not.toHaveBeenCalled()
        } finally {
          vi.restoreAllMocks()
        }
      },
    )
  })

  it.each(
    ["/dashboard/jobs", "/dashboard/coverage"].flatMap((pathname) =>
      [null, "invalid", "subtitles", "audio", "meta"].map((stored) => ({
        pathname,
        stored,
      })),
    ),
  )(
    "hydrates stored $stored on $pathname without recovery",
    async ({ pathname, stored }) => {
      if (stored !== null)
        window.sessionStorage.setItem(REPORT_STORAGE_KEY, stored)
      const errors = await hydrateShell(pathname)
      expect(errors).toEqual([])
      const expected =
        stored === "audio" || stored === "meta" ? stored : "subtitles"
      expect(reportType()).toBe(expected)
      expect(submenuNav()?.dataset.product).toBe(expected)
      expect(submenuLinks()).toEqual(
        expected === "subtitles" ? SUBTITLES_SUBMENU : REPORT_SUBMENU,
      )
      expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe(stored)
    },
  )

  it.each(["audio", "meta"])(
    "keeps Subtitle Lab authoritative over stored %s during hydration",
    async (stored) => {
      window.sessionStorage.setItem(REPORT_STORAGE_KEY, stored)
      expect(await hydrateShell("/dashboard/subtitle-lab")).toEqual([])
      expect(reportType()).toBe("subtitles")
      expect(submenuLinks()).toEqual(SUBTITLES_SUBMENU)
      expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe(
        "subtitles",
      )
    },
  )

  it.each(["/dashboard/jobs", "/dashboard/coverage"])(
    "hydrates with denied storage and keeps in-memory changes on %s",
    async (pathname) => {
      const read = Storage.prototype.getItem
      const write = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
        key,
      ) {
        if (this === window.sessionStorage)
          throw new DOMException("Storage denied", "SecurityError")
        return read.call(this, key)
      })
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key,
        value,
      ) {
        if (this === window.sessionStorage)
          throw new DOMException("Storage denied", "SecurityError")
        return write.call(this, key, value)
      })
      try {
        expect(await hydrateShell(pathname)).toEqual([])
        expect(reportType()).toBe("subtitles")
        await chooseProduct("Audio")
        expect(reportType()).toBe("audio")
        expect(submenuLinks()).toEqual(REPORT_SUBMENU)
        expect(navigation.push).not.toHaveBeenCalled()
      } finally {
        vi.restoreAllMocks()
      }
    },
  )

  // Real shell option/combobox handlers + the real editor session and guard.
  // Only the Next router boundary is recorded; no navigation helper is mocked.
  it.each(
    ["click", "Enter"].flatMap((input) =>
      ["SEO", "Audio"].flatMap((product) =>
        ["failed", "pending"].flatMap((save) =>
          [false, true].map((storageDenied) => ({
            input,
            product,
            save,
            storageDenied,
          })),
        ),
      ),
    ),
  )(
    "guards $input to $product with $save autosave (storage denied: $storageDenied)",
    async ({ input, product, save, storageDenied }) => {
      window.sessionStorage.setItem(REPORT_STORAGE_KEY, "meta")
      await mountShell("/dashboard/shorts/project")
      const session = new EditorSession(
        {
          projectId: "project",
          revision: 1,
          lifecycle: "DRAFT",
          firstPublishedAt: null,
          actor: { kind: "human", id: "operator" },
          document: {
            version: 1,
            title: "Saved",
            language: "english",
            runtimeVersion: "studio-proof-1",
            width: 1080,
            height: 1920,
            fps: 30,
            durationInFrames: 300,
            tracks: [],
            components: [],
            items: [],
          },
        },
        {
          read: vi.fn(),
          apply: () =>
            save === "pending"
              ? new Promise(() => {})
              : Promise.reject(new IsolatedSaveError("Isolated save failure")),
        },
      )
      const stopGuard = guardEditorNavigation(session, window, document)
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
      const readStorage = Storage.prototype.getItem
      const writeStorage = Storage.prototype.setItem
      if (storageDenied) {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
          this: Storage,
          key,
        ) {
          if (this === window.sessionStorage)
            throw new DOMException("Storage denied", "SecurityError")
          return readStorage.call(this, key)
        })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
          this: Storage,
          key,
          value,
        ) {
          if (this === window.sessionStorage)
            throw new DOMException("Storage denied", "SecurityError")
          writeStorage.call(this, key, value)
        })
      }
      vi.useFakeTimers()
      const stopAutosave = startEditorAutosave(session)
      try {
        session.edit((doc) => ({ ...doc, title: "Unsaved" }))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(750)
        })
        expect(session.getSnapshot()).toMatchObject({
          hasUnsavedChanges: true,
          status: save === "pending" ? "saving" : "failed",
        })
        await act(async () => productTrigger()!.click())
        // Arrow keys exercise the actual combobox path without a test-only
        // selection helper. Shorts -> SEO; Shorts -> Audio via Home/Down.
        if (input === "Enter") {
          const combo =
            document.querySelector<HTMLInputElement>('[role="combobox"]')!
          for (const key of product === "SEO"
            ? ["ArrowDown", "Enter"]
            : ["Home", "ArrowDown", "Enter"]) {
            await act(async () => {
              combo.dispatchEvent(
                new KeyboardEvent("keydown", { key, bubbles: true }),
              )
            })
          }
        } else {
          await act(async () => {
            options()
              .find((option) => option.textContent === product)!
              .click()
          })
        }
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(navigation.push).not.toHaveBeenCalled()
        expect(navigation.pathname).toBe("/dashboard/shorts/project")
        expect(reportType()).toBe("meta")
        expect(
          readStorage.call(window.sessionStorage, REPORT_STORAGE_KEY),
        ).toBe("meta")
        expect(submenuNav()?.getAttribute("aria-label")).toBe("Shorts menu")
        expect(currentOptions()).toEqual(["ShortsCurrent"])

        // Accept the same real option; state may commit only now.
        confirm.mockReturnValue(true)
        await act(async () => {
          options()
            .find((option) => option.textContent === product)!
            .click()
        })
        expect(navigation.push).toHaveBeenCalledWith(
          product === "SEO" ? "/dashboard/seo" : "/dashboard/coverage",
        )
        expect(submenuNav()?.getAttribute("aria-label")).toBe(`${product} menu`)
        expect(reportType()).toBe(product === "Audio" ? "audio" : "meta")
      } finally {
        stopAutosave()
        stopGuard()
        vi.useRealTimers()
        vi.restoreAllMocks()
      }
    },
  )

  it("renders the switcher at the top of the sidebar, followed by the product submenu", () => {
    for (const pathname of [
      "/dashboard/jobs",
      "/dashboard/shorts/new",
      "/dashboard/seo",
    ]) {
      renderShell(pathname)

      const sidebarContent = document.querySelector(
        ".design-system-shell-sidebar .design-system-sidebar-content",
      )

      expect(
        document.querySelectorAll('[aria-label="Switch product"]'),
      ).toHaveLength(1)
      expect(sidebarContent?.children).toHaveLength(2)
      expect(
        sidebarContent?.firstElementChild?.contains(productTrigger()),
      ).toBe(true)
      expect(sidebarContent?.children[1]).toBe(submenuNav())
      expect(
        document.querySelector('[aria-label="Report selector"]'),
      ).toBeNull()
      expect(document.querySelector(".design-system-report-switch")).toBeNull()
      expect(document.body.textContent).not.toContain("Standalone projects")
    }
  })

  it("keeps the top bar free of the switcher", () => {
    renderShell("/dashboard/jobs")

    const actions = document.querySelector(".design-system-topbar-actions")

    expect(actions).not.toBeNull()
    expect(actions?.contains(productTrigger())).toBe(false)
    expect(
      Array.from(actions?.querySelectorAll("button") ?? []).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toContain("Notifications")
  })

  it("renders the selected report product's submenu on shared report pages", async () => {
    for (const [stored, label, expected] of [
      ["subtitles", "Subtitles", SUBTITLES_SUBMENU],
      ["audio", "Audio", REPORT_SUBMENU],
      ["meta", "Meta", REPORT_SUBMENU],
    ] as const) {
      window.sessionStorage.setItem(REPORT_STORAGE_KEY, stored)
      await mountShell("/dashboard/jobs/job-1")

      expect(submenuNav()?.getAttribute("aria-label")).toBe(`${label} menu`)
      expect(submenuLinks()).toEqual(expected)
      expect(activeLinks()).toEqual(["Jobs"])

      const { root } = mounted!
      await act(async () => {
        root.unmount()
      })
      mounted = null
    }
  })

  it("renders each route product's submenu and selects it from the pathname", async () => {
    window.sessionStorage.setItem(REPORT_STORAGE_KEY, "audio")

    for (const [pathname, search, label, expected, active] of [
      [
        "/dashboard/smart-crop/job-1",
        "",
        "Smart Crop",
        [["Smart Crop", "/dashboard/smart-crop"]],
        "Smart Crop",
      ],
      ["/dashboard/shorts", "", "Shorts", SHORTS_SUBMENU, "Projects"],
      ["/dashboard/shorts/new", "", "Shorts", SHORTS_SUBMENU, "New Project"],
      [
        "/dashboard/shorts/calendar",
        "",
        "Shorts",
        SHORTS_SUBMENU,
        "Planning Calendar",
      ],
      ["/dashboard/shorts/project-1", "", "Shorts", SHORTS_SUBMENU, "Projects"],
      [
        "/dashboard/seo",
        "",
        "SEO",
        [
          ["Overview", "/dashboard/seo"],
          ["Runs", "/dashboard/seo?view=runs"],
        ],
        "Overview",
      ],
      [
        "/dashboard/seo",
        "view=runs",
        "SEO",
        [
          ["Overview", "/dashboard/seo"],
          ["Runs", "/dashboard/seo?view=runs"],
        ],
        "Runs",
      ],
      [
        "/dashboard/seo/runs/run-1",
        "returnTo=%2Fdashboard%2Fseo%3Fview%3Druns",
        "SEO",
        [
          ["Overview", "/dashboard/seo"],
          ["Runs", "/dashboard/seo?view=runs"],
        ],
        "Runs",
      ],
      [
        "/dashboard/alerts",
        "",
        "Alerts",
        [["Alerts", "/dashboard/alerts"]],
        "Alerts",
      ],
      [
        "/dashboard/agents",
        "",
        "Agents",
        [["Agents", "/dashboard/agents"]],
        "Agents",
      ],
    ] as const) {
      await mountShell(pathname, search)

      expect(submenuNav()?.getAttribute("aria-label")).toBe(`${label} menu`)
      expect(submenuLinks()).toEqual(expected)
      expect(activeLinks()).toEqual([active])

      await act(async () => {
        productTrigger()!.click()
      })
      expect(currentOptions()).toEqual([`${label}Current`])
      expect(reportType()).toBe("audio")

      const { root } = mounted!
      await act(async () => {
        root.unmount()
      })
      mounted = null
    }
  })

  it("keeps Subtitle Lab under Subtitles and selects that report there", async () => {
    window.sessionStorage.setItem(REPORT_STORAGE_KEY, "audio")
    await mountShell("/dashboard/subtitle-lab/runs/run-1")

    expect(submenuNav()?.getAttribute("aria-label")).toBe("Subtitles menu")
    expect(submenuLinks()).toEqual(SUBTITLES_SUBMENU)
    expect(activeLinks()).toEqual(["Subtitle Lab"])
    expect(reportType()).toBe("subtitles")
    expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe("subtitles")
  })

  it("switches the report in place on Report and Jobs pages", async () => {
    window.sessionStorage.setItem(REPORT_STORAGE_KEY, "subtitles")
    await mountShell("/dashboard/coverage")
    expect(submenuLinks()).toEqual(SUBTITLES_SUBMENU)

    await chooseProduct("Audio")

    expect(navigation.push).not.toHaveBeenCalled()
    expect(reportType()).toBe("audio")
    expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe("audio")
    expect(submenuNav()?.getAttribute("aria-label")).toBe("Audio menu")
    expect(submenuLinks()).toEqual(REPORT_SUBMENU)
    expect(activeLinks()).toEqual(["Report"])
    expect(productTrigger()!.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(productTrigger())

    await navigateTo("/dashboard/jobs")
    await chooseProduct("Meta")

    expect(navigation.push).not.toHaveBeenCalled()
    expect(reportType()).toBe("meta")
    expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe("meta")
    expect(submenuLinks()).toEqual(REPORT_SUBMENU)
    expect(activeLinks()).toEqual(["Jobs"])

    await chooseProduct("Subtitles")

    expect(navigation.push).not.toHaveBeenCalled()
    expect(reportType()).toBe("subtitles")
    expect(submenuLinks()).toEqual(SUBTITLES_SUBMENU)
    expect(activeLinks()).toEqual(["Jobs"])

    await act(async () => {
      productTrigger()!.click()
    })
    expect(currentOptions()).toEqual(["SubtitlesCurrent"])
  })

  it("redirects Audio and Meta from Subtitle Lab to the report", async () => {
    for (const label of ["Audio", "Meta"] as const) {
      window.sessionStorage.setItem(REPORT_STORAGE_KEY, "subtitles")
      await mountShell("/dashboard/subtitle-lab")

      await chooseProduct(label)

      const key = label.toLowerCase()
      expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/coverage",
      )
      expect(reportType()).toBe(key)
      expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBe(key)
      // The submenu switches before the report route loads.
      expect(submenuNav()?.getAttribute("aria-label")).toBe(`${label} menu`)
      expect(submenuLinks()).toEqual(REPORT_SUBMENU)
      expect(activeLinks()).toEqual([])

      await navigateTo("/dashboard/coverage")
      expect(reportType()).toBe(key)
      expect(submenuLinks()).toEqual(REPORT_SUBMENU)
      expect(activeLinks()).toEqual(["Report"])

      const { root } = mounted!
      await act(async () => {
        root.unmount()
      })
      mounted = null
      navigation.push.mockReset()
    }
  })

  it("keeps Subtitles on Subtitle Lab", async () => {
    await mountShell("/dashboard/subtitle-lab")

    await chooseProduct("Subtitles")

    expect(navigation.push).not.toHaveBeenCalled()
    expect(submenuLinks()).toEqual(SUBTITLES_SUBMENU)
    expect(activeLinks()).toEqual(["Subtitle Lab"])
  })

  it("redirects report products from route-product pages to the report", async () => {
    for (const [pathname, label] of [
      ["/dashboard/shorts/calendar", "Subtitles"],
      ["/dashboard/smart-crop", "Audio"],
      ["/dashboard/seo", "Meta"],
    ] as const) {
      await mountShell(pathname)

      await chooseProduct(label)

      expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/coverage",
      )
      expect(reportType()).toBe(label.toLowerCase())
      expect(submenuNav()?.getAttribute("aria-label")).toBe(`${label} menu`)
      expect(submenuLinks()).toEqual(
        label === "Subtitles" ? SUBTITLES_SUBMENU : REPORT_SUBMENU,
      )
      expect(activeLinks()).toEqual([])

      await navigateTo("/dashboard/coverage")
      expect(activeLinks()).toEqual(["Report"])

      const { root } = mounted!
      await act(async () => {
        root.unmount()
      })
      mounted = null
      navigation.push.mockReset()
    }
  })

  it("navigates to each route product's root and switches the submenu immediately", async () => {
    await mountShell("/dashboard/coverage")

    for (const [label, href] of ROUTE_PRODUCTS) {
      await chooseProduct(label)

      expect(navigation.push).toHaveBeenLastCalledWith(href)
      expect(submenuNav()?.getAttribute("aria-label")).toBe(`${label} menu`)
      expect(productTrigger()!.getAttribute("aria-expanded")).toBe("false")
      expect(document.activeElement).toBe(productTrigger())
    }
    expect(navigation.push.mock.calls).toEqual(
      ROUTE_PRODUCTS.map(([, href]) => [href]),
    )

    await navigateTo("/dashboard/shorts")
    await chooseProduct("Shorts")
    expect(submenuLinks()).toEqual(SHORTS_SUBMENU)
    expect(activeLinks()).toEqual(["Projects"])

    await navigateTo("/dashboard/shorts/new")
    expect(activeLinks()).toEqual(["New Project"])

    // Route products never change the report context.
    expect(reportType()).toBe("subtitles")
    expect(window.sessionStorage.getItem(REPORT_STORAGE_KEY)).toBeNull()
  })

  it("shows the job queue badge only in submenus that include Jobs", async () => {
    api.queueTotal = 3

    await mountShell("/dashboard/coverage")
    const badges = () =>
      Array.from(
        submenuNav()?.querySelectorAll(".studio-shell-nav-badge") ?? [],
      ).map((badge) => [
        badge.closest("a")?.getAttribute("aria-label"),
        badge.textContent,
      ])

    expect(badges()).toEqual([["Jobs", "3"]])

    await chooseProduct("Meta")
    expect(badges()).toEqual([["Jobs", "3"]])

    for (const pathname of [
      "/dashboard/shorts",
      "/dashboard/seo",
      "/dashboard/smart-crop",
      "/dashboard/alerts",
      "/dashboard/agents",
    ]) {
      await navigateTo(pathname)
      expect(badges()).toEqual([])
    }
  })

  it("never selects a Coming Soon product or changes the submenu for it", async () => {
    await mountShell("/dashboard/shorts")

    for (const label of ["Campaigns", "Agent Registry", "Website Editor"]) {
      await chooseProduct(label)

      expect(navigation.push).not.toHaveBeenCalled()
      expect(submenuNav()?.getAttribute("aria-label")).toBe("Shorts menu")
      expect(submenuLinks()).toEqual(SHORTS_SUBMENU)
      expect(activeLinks()).toEqual(["Projects"])
      expect(currentOptions()).toEqual(["ShortsCurrent"])

      await act(async () => {
        document.body.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true }),
        )
      })
    }
    expect(reportType()).toBe("subtitles")
  })

  it("leaves no responsive grid row for the removed report selector", () => {
    const css = readFileSync(
      resolve(__dirname, "../../app/globals.css"),
      "utf8",
    )

    expect(css).not.toMatch(/design-system-report-switch/)
    expect(css).not.toMatch(/"switcher/)
    expect(css).toContain('"brand nav"\n      "product product";')
    // On phones the switcher stacks directly above its product submenu.
    expect(css).toContain('"brand"\n      "product"\n      "nav";')
  })
})
