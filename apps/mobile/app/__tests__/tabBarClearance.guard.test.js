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
const APPLIED = /(paddingBottom|bottom):[^\n]*(tabBarClearance|clearance)/

/** Comments do not run. A commented-out call must not satisfy the guard. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
}

const SURFACES = [
  "src/components/home/HomeScreen.tsx",
  "app/(tabs)/watch.tsx",
  "src/components/search/BrowseTopics.tsx",
  "app/(tabs)/library.tsx",
  "app/(tabs)/profile.tsx",
  "src/components/ui/Snackbar.tsx",
]

describe("every scroll surface clears the floating tab bar", () => {
  it.each(SURFACES)("%s reads AND applies the shared clearance", (relative) => {
    const full = path.join(ROOT, relative)
    expect(fs.existsSync(full)).toBe(true)
    const source = stripComments(fs.readFileSync(full, "utf8"))
    expect(source).toMatch(CLEARANCE)
    expect(source).toMatch(APPLIED)
  })

  it("would reject a surface that imports the hook without applying it", () => {
    const decoy =
      "const tabBarClearance = useTabBarClearance()\nfoo(tabBarClearance)"
    expect(decoy).toMatch(CLEARANCE)
    expect(decoy).not.toMatch(APPLIED)
  })

  it("would reject a commented-out call", () => {
    expect(stripComments("// const x = useTabBarClearance()")).not.toMatch(
      CLEARANCE,
    )
  })

  it("names every surface the enumeration is meant to cover", () => {
    // A shrinking list is the failure mode this guard cannot otherwise see.
    expect(SURFACES).toHaveLength(6)
  })
})
