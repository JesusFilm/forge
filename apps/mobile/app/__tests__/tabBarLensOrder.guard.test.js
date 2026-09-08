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
  return fs
    .readdirSync(path.join(ROOT, "app/(tabs)"))
    .filter((f) => /\.[jt]sx?$/.test(f) && !f.startsWith("_"))
    .map((f) => f.replace(/\.[jt]sx?$/, ""))
    .sort()
}

describe("the lens order matches the rendered tab order", () => {
  it("covers every route file in the group, declared or not", () => {
    expect(routeFilesInGroup()).toEqual([...sharedTabOrder()].sort())
  })

  it("declares the same names in the same order", () => {
    const declared = declaredTabOrder()
    expect(declared.length).toBeGreaterThan(0)
    expect(sharedTabOrder()).toEqual(declared)
  })

  it("the guard is falsifiable — it reads real names, not a constant", () => {
    expect(declaredTabOrder()).toContain("index")
    expect(declaredTabOrder()).toContain("profile")
  })
})
