// Plain JS: the RN tsconfig has no Node types and this guard scans sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The lens positions itself from TAB_ROUTE_NAMES, but the ORDER on screen comes
// from the <Tabs.Screen> declarations. If the two drift, the lens slides to the
// wrong cell and nothing else notices.
const ROOT = path.resolve(__dirname, "../..")

function declaredTabOrder() {
  const source = fs.readFileSync(
    path.join(ROOT, "app/(tabs)/_layout.tsx"),
    "utf8",
  )
  return [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map(
    (m) => m[1],
  )
}

function sharedTabOrder() {
  const source = fs.readFileSync(path.join(ROOT, "src/lib/tabBar.ts"), "utf8")
  const block = source.match(/TAB_ROUTE_NAMES\s*=\s*\[([^\]]*)\]/)
  expect(block).not.toBeNull()
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** expo-router appends undeclared app/(tabs)/* files as extra tabs, so the
 *  filesystem — not the <Tabs.Screen> list — decides how many cells the bar
 *  renders. The lens divides its width by TAB_ROUTE_NAMES.length. */
function routeFilesInGroup() {
  // A tab may be a FILE (watch.tsx) or a DIRECTORY holding a nested stack
  // (watch/_layout.tsx) -- the normal expo-router shape once a tab grows one.
  // A file-only scan cannot see the second, and the lens would then divide its
  // width by the wrong cell count.
  return fs
    .readdirSync(path.join(ROOT, "app/(tabs)"), { withFileTypes: true })
    .filter((e) => !e.name.startsWith("_"))
    .filter((e) => e.isDirectory() || /\.[jt]sx?$/.test(e.name))
    .map((e) => e.name.replace(/\.[jt]sx?$/, ""))
    .sort()
}

describe("the lens order matches the rendered tab order", () => {
  it("covers every route in the group, file or directory, declared or not", () => {
    expect(routeFilesInGroup()).toEqual([...sharedTabOrder()].sort())
  })

  it("declares the same names in the same order", () => {
    const declared = declaredTabOrder()
    expect(declared.length).toBeGreaterThan(0)
    expect(sharedTabOrder()).toEqual(declared)
  })

  // R1: the owner chose the second slot over the centre and the fourth.
  it("puts Explore second, right after Home", () => {
    expect(sharedTabOrder().slice(0, 2)).toEqual(["index", "explore"])
    expect(declaredTabOrder().slice(0, 2)).toEqual(["index", "explore"])
    expect(routeFilesInGroup()).toContain("explore")
  })

  it("the guard is falsifiable — it reads real names, not a constant", () => {
    expect(declaredTabOrder()).toContain("index")
    expect(declaredTabOrder()).toContain("profile")
  })

  it("keeps the product order: Home, Explore, Discover, Bible, Profile", () => {
    // feat-553 R2, KD18, with Explore second (feat-552 R1; owner, 2026-09-28).
    // The checks above only prove that two lists agree, so a swap in both would pass them.
    const order = ["index", "explore", "watch", "bible", "profile"]
    expect(sharedTabOrder()).toEqual(order)
    expect(declaredTabOrder()).toEqual(order)
  })
})
