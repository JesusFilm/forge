// Plain JS: the RN tsconfig has no Node types and this guard scans sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// On iOS the bar floats, so the screen container runs full height and nothing
// compensates. This is an ENUMERATION, not a sweep: a seventh scroll surface
// escapes it silently. Add a row whenever you add one.
const ROOT = path.resolve(__dirname, "../..")
const CLEARANCE = /useTabBarClearance/
// Presence of the identifier is not application: three of these surfaces use
// the value twice, so dropping only the offset term would leave it "used".
// scrollIndicatorInsets={{ bottom: tabBarClearance }} contains "bottom: ..."
// and would satisfy a naive pattern -- which is the exact "used twice" case
// this pin exists to close. Strip that prop before matching.
const APPLIED = /(paddingBottom|bottom):[^\n]*(tabBarClearance|clearance)/

/** Comments do not run. A commented-out call must not satisfy the guard. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
}

/** The scroll-indicator inset is cosmetic; it must not stand in for padding. */
function stripIndicatorInsets(source) {
  return source.replace(/scrollIndicatorInsets=\{\{[^}]*\}\}/g, "")
}

const SURFACES = [
  "src/components/home/HomeScreen.tsx",
  "app/(tabs)/watch.tsx",
  "src/components/search/BrowseTopics.tsx",
  "app/(tabs)/library.tsx",
  "app/(tabs)/profile.tsx",
  "src/components/ui/Snackbar.tsx",
  "src/components/ExportReportHost.tsx",
]

describe("every scroll surface clears the floating tab bar", () => {
  it.each(SURFACES)("%s reads AND applies the shared clearance", (relative) => {
    const full = path.join(ROOT, relative)
    expect(fs.existsSync(full)).toBe(true)
    const source = stripComments(fs.readFileSync(full, "utf8"))
    expect(source).toMatch(CLEARANCE)
    expect(stripIndicatorInsets(source)).toMatch(APPLIED)
  })

  it("would reject a surface that imports the hook without applying it", () => {
    const decoy =
      "const tabBarClearance = useTabBarClearance()\nfoo(tabBarClearance)"
    expect(decoy).toMatch(CLEARANCE)
    expect(decoy).not.toMatch(APPLIED)
  })

  it("would reject a commented-out call, leading or trailing", () => {
    expect(stripComments("// const x = useTabBarClearance()")).not.toMatch(
      CLEARANCE,
    )
    expect(stripComments("const y = 1 // useTabBarClearance()")).not.toMatch(
      CLEARANCE,
    )
  })

  it("names every surface the enumeration is meant to cover", () => {
    // A shrinking list is the failure mode this guard cannot otherwise see.
    expect(SURFACES).toHaveLength(7)
  })
})

// Each tab route file names the surface that clears the bar for it. A new tab
// must add a row here, so it cannot escape the list above without notice.
const TAB_ROUTES = {
  index: { surface: "src/components/home/HomeScreen.tsx" },
  watch: { surface: "app/(tabs)/watch.tsx" },
  library: { surface: "app/(tabs)/library.tsx" },
  profile: { surface: "app/(tabs)/profile.tsx" },
  // feat-551: no scroll surface. The reader puts its footer above the bar
  // with readerBottomInset, from the tab screen's own inset (chrome.ts).
  bible: { reader: "app/(tabs)/bible.tsx" },
}

function tabRouteNames() {
  return fs
    .readdirSync(path.join(ROOT, "app/(tabs)"), { withFileTypes: true })
    .filter((e) => !e.name.startsWith("_"))
    .filter((e) => e.isDirectory() || /\.[jt]sx?$/.test(e.name))
    .map((e) => e.name.replace(/\.[jt]sx?$/, ""))
    .sort()
}

describe("every tab route is accounted for", () => {
  it("has one row per route file in app/(tabs)", () => {
    expect(tabRouteNames()).toEqual(Object.keys(TAB_ROUTES).sort())
  })

  it.each(Object.entries(TAB_ROUTES).filter(([, row]) => row.surface))(
    "%s clears the bar through an enumerated surface",
    (_name, row) => {
      expect(SURFACES).toContain(row.surface)
    },
  )

  it("puts the Bible tab's reader on the tab host, which clears the bar", () => {
    const source = stripComments(
      fs.readFileSync(path.join(ROOT, TAB_ROUTES.bible.reader), "utf8"),
    )
    expect(source).toMatch(/<BibleReader\b[^>]*\bhost="tab"/)
    const chrome = stripComments(
      fs.readFileSync(
        path.join(ROOT, "src/lib/bible/reader/chrome.ts"),
        "utf8",
      ),
    )
    // Only Android's tab takes no inset; its bar sits below the screen.
    expect(chrome).toMatch(
      /if \(host === "tab" && platform !== "ios"\) return 0\s+return safeAreaBottom/,
    )
  })
})
