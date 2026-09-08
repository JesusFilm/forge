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

const SURFACES = [
  "src/components/home/HomeScreen.tsx",
  "app/(tabs)/watch.tsx",
  "src/components/search/BrowseTopics.tsx",
  "app/(tabs)/library.tsx",
  "app/(tabs)/profile.tsx",
  "src/components/ui/Snackbar.tsx",
]

describe("every scroll surface clears the floating tab bar", () => {
  it.each(SURFACES)("%s reads the shared clearance", (relative) => {
    const full = path.join(ROOT, relative)
    expect(fs.existsSync(full)).toBe(true)
    expect(fs.readFileSync(full, "utf8")).toMatch(CLEARANCE)
  })

  it("names every surface the enumeration is meant to cover", () => {
    // A shrinking list is the failure mode this guard cannot otherwise see.
    expect(SURFACES).toHaveLength(6)
  })
})
