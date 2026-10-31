import { describe, expect, it } from "vitest"
import {
  getActiveStudioSubmenuItemKey,
  getStudioCurrentProductKey,
  getStudioProductSubmenu,
  isPathnameInStudioProductSubmenu,
  isStudioReportProductKey,
} from "./studio-product-submenu"
import {
  flattenStudioProductGroups,
  getStudioProductGroups,
  type StudioSelectableProductKey,
} from "./studio-product-switcher"

const EXPECTED_SUBMENUS: Record<
  StudioSelectableProductKey,
  ReadonlyArray<readonly [string, string]>
> = {
  subtitles: [
    ["Report", "/dashboard/coverage"],
    ["Jobs", "/dashboard/jobs"],
    ["Subtitle Lab", "/dashboard/subtitle-lab"],
  ],
  audio: [
    ["Report", "/dashboard/coverage"],
    ["Jobs", "/dashboard/jobs"],
  ],
  meta: [
    ["Report", "/dashboard/coverage"],
    ["Jobs", "/dashboard/jobs"],
  ],
  "smart-crop": [["Smart Crop", "/dashboard/smart-crop"]],
  shorts: [
    ["Projects", "/dashboard/shorts"],
    ["New Project", "/dashboard/shorts/new"],
    ["Planning Calendar", "/dashboard/shorts/calendar"],
  ],
  seo: [
    ["Overview", "/dashboard/seo"],
    // The existing run-history view; run reports nest under /dashboard/seo/runs.
    ["Runs", "/dashboard/seo?view=runs"],
  ],
  alerts: [["Alerts", "/dashboard/alerts"]],
  agents: [["Agents", "/dashboard/agents"]],
}

const submenu = (key: StudioSelectableProductKey) =>
  getStudioProductSubmenu(key).map((item) => [item.label, item.href])

const activeLabel = (
  key: StudioSelectableProductKey,
  pathname: string,
  search?: string,
) => {
  const items = getStudioProductSubmenu(key)
  const activeKey = getActiveStudioSubmenuItemKey(items, pathname, search)
  return items.find((item) => item.key === activeKey)?.label ?? null
}

describe("Studio product submenus", () => {
  it("defines the exact submenu for every selectable product", () => {
    const products = flattenStudioProductGroups(getStudioProductGroups())
    const selectableKeys = products.flatMap((product) =>
      product.available ? [product.key] : [],
    )

    expect(selectableKeys).toEqual(Object.keys(EXPECTED_SUBMENUS))
    for (const key of selectableKeys) {
      expect(submenu(key)).toEqual(EXPECTED_SUBMENUS[key])
    }
  })

  it("exposes no submenu for Coming Soon products", () => {
    const lookup = getStudioProductSubmenu as (key: string) => unknown
    const unavailable = flattenStudioProductGroups(
      getStudioProductGroups(),
    ).filter((product) => !product.available)

    expect(unavailable).toHaveLength(12)
    for (const product of unavailable) {
      expect(lookup(product.key)).toBeUndefined()
    }
  })

  it("shows the job queue badge only on Jobs, which only report products own", () => {
    for (const key of Object.keys(
      EXPECTED_SUBMENUS,
    ) as StudioSelectableProductKey[]) {
      const badged = getStudioProductSubmenu(key)
        .filter((item) => item.badge === "job-queue")
        .map((item) => item.label)

      expect(badged).toEqual(isStudioReportProductKey(key) ? ["Jobs"] : [])
    }
  })

  it("identifies the report products", () => {
    expect(
      (Object.keys(EXPECTED_SUBMENUS) as StudioSelectableProductKey[]).filter(
        isStudioReportProductKey,
      ),
    ).toEqual(["subtitles", "audio", "meta"])
  })
})

describe("getActiveStudioSubmenuItemKey", () => {
  it("matches report routes, the dashboard root and nested job pages", () => {
    expect(activeLabel("audio", "/dashboard")).toBe("Report")
    expect(activeLabel("audio", "/dashboard/coverage")).toBe("Report")
    expect(activeLabel("meta", "/dashboard/jobs")).toBe("Jobs")
    expect(activeLabel("meta", "/dashboard/jobs/job-1")).toBe("Jobs")
    expect(activeLabel("subtitles", "/dashboard/subtitle-lab/runs/r1")).toBe(
      "Subtitle Lab",
    )
    expect(activeLabel("audio", "/dashboard/subtitle-lab")).toBeNull()
    expect(activeLabel("audio", "/dashboard/jobsx")).toBeNull()
    expect(activeLabel("audio", "/dashboard/shorts")).toBeNull()
  })

  it("marks only the most specific Shorts item", () => {
    expect(activeLabel("shorts", "/dashboard/shorts")).toBe("Projects")
    expect(activeLabel("shorts", "/dashboard/shorts/project-1")).toBe(
      "Projects",
    )
    expect(activeLabel("shorts", "/dashboard/shorts/new")).toBe("New Project")
    expect(activeLabel("shorts", "/dashboard/shorts/calendar")).toBe(
      "Planning Calendar",
    )
  })

  it("marks only the most specific SEO item", () => {
    expect(activeLabel("seo", "/dashboard/seo")).toBe("Overview")
    expect(activeLabel("seo", "/dashboard/seo", "view=proposals")).toBe(
      "Overview",
    )
    expect(activeLabel("seo", "/dashboard/seo", "view=runs")).toBe("Runs")
    expect(
      activeLabel(
        "seo",
        "/dashboard/seo",
        new URLSearchParams("view=runs&cursor=c1").toString(),
      ),
    ).toBe("Runs")
    expect(activeLabel("seo", "/dashboard/seo/runs/run-1")).toBe("Runs")
    expect(
      getActiveStudioSubmenuItemKey(
        getStudioProductSubmenu("seo"),
        "/dashboard/seo",
        new URLSearchParams("view=runs"),
      ),
    ).toBe("seo-runs")
  })

  it("matches single-item route products on their root and sub-pages", () => {
    expect(activeLabel("smart-crop", "/dashboard/smart-crop/job-1")).toBe(
      "Smart Crop",
    )
    expect(activeLabel("alerts", "/dashboard/alerts")).toBe("Alerts")
    expect(activeLabel("agents", "/dashboard/agents")).toBe("Agents")
  })
})

describe("getStudioCurrentProductKey", () => {
  it("selects route products from the pathname, including sub-pages", () => {
    for (const [pathname, key] of [
      ["/dashboard/smart-crop", "smart-crop"],
      ["/dashboard/smart-crop/job-1", "smart-crop"],
      ["/dashboard/shorts", "shorts"],
      ["/dashboard/shorts/new", "shorts"],
      ["/dashboard/shorts/calendar", "shorts"],
      ["/dashboard/seo", "seo"],
      ["/dashboard/seo/runs/run-1", "seo"],
      ["/dashboard/alerts", "alerts"],
      ["/dashboard/agents", "agents"],
    ] as const) {
      expect(getStudioCurrentProductKey(pathname, "audio")).toBe(key)
    }
  })

  it("follows the report type on shared Report and Jobs pages", () => {
    for (const reportType of ["subtitles", "audio", "meta"] as const) {
      expect(
        getStudioCurrentProductKey("/dashboard/coverage", reportType),
      ).toBe(reportType)
      expect(
        getStudioCurrentProductKey("/dashboard/jobs/job-1", reportType),
      ).toBe(reportType)
    }
  })

  it("keeps Subtitle Lab under Subtitles", () => {
    expect(getStudioCurrentProductKey("/dashboard/subtitle-lab", "audio")).toBe(
      "subtitles",
    )
    expect(
      getStudioCurrentProductKey("/dashboard/subtitle-lab/runs/r1", "meta"),
    ).toBe("subtitles")
  })
})

describe("isPathnameInStudioProductSubmenu", () => {
  it("keeps shared report routes and sends other routes to the report", () => {
    for (const key of ["subtitles", "audio", "meta"] as const) {
      expect(isPathnameInStudioProductSubmenu(key, "/dashboard/coverage")).toBe(
        true,
      )
      expect(
        isPathnameInStudioProductSubmenu(key, "/dashboard/jobs/job-1"),
      ).toBe(true)
      expect(isPathnameInStudioProductSubmenu(key, "/dashboard/shorts")).toBe(
        false,
      )
    }

    expect(
      isPathnameInStudioProductSubmenu("subtitles", "/dashboard/subtitle-lab"),
    ).toBe(true)
    expect(
      isPathnameInStudioProductSubmenu("audio", "/dashboard/subtitle-lab"),
    ).toBe(false)
    expect(
      isPathnameInStudioProductSubmenu(
        "meta",
        "/dashboard/subtitle-lab/runs/r1",
      ),
    ).toBe(false)
  })
})
