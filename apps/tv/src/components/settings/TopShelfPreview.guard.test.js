/* global require, describe, it, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const source = fs.readFileSync(
  path.join(__dirname, "SettingsScreen.tsx"),
  "utf8",
)
const profiles = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../eas.json"), "utf8"),
).build

describe("beta Top Shelf settings", () => {
  it("explicitly disables the selector in the production build profile", () => {
    expect(
      profiles.production.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED,
    ).toBe("false")
    expect(profiles.preview.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED).toBe(
      "true",
    )
    expect(
      profiles.development.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED,
    ).toBe("true")
  })

  it("uses the shared Apple-TV-only gate and existing remote-focus rows", () => {
    expect(source).toContain("topShelfPreviewEnabled(")
    expect(source).toContain("Platform.isTV")
    expect(source).toContain("TOP_SHELF_PREVIEW_OPTIONS.map")
    expect(source).toContain("setTopShelfPreviewStyle(option.value)")
    expect(source).toContain('pathname === "/settings" && topShelfPreviewStyle')
    expect(source).toContain("<BetaTopShelfPreviewSync />")
    expect(source).toContain("useTopShelfSync(model, entries, true, true)")
    expect(source).toContain("accessibilityRole={")
    expect(source).toContain('useFocusVisual("option"')
  })

  it("allows the longer beta menu to scroll to every row", () => {
    expect(source).toContain("flexGrow: 1")
    expect(source).toContain("paddingBottom: scale(80)")
  })

  it("writes and reads the bounded atomic snapshot in the shared tvOS cache", () => {
    const root = path.join(__dirname, "../../../")
    const writer = fs.readFileSync(
      path.join(root, "modules/top-shelf/ios/TopShelfModule.swift"),
      "utf8",
    )
    const reader = fs.readFileSync(
      path.join(root, "top-shelf/ContentProvider.swift"),
      "utf8",
    )
    expect(writer).toContain(
      'appendingPathComponent("Library/Caches", isDirectory: true)',
    )
    expect(writer).toContain(
      "createDirectory(at: cache, withIntermediateDirectories: true)",
    )
    expect(writer).toContain('cache.appendingPathComponent("top-shelf.json")')
    expect(writer).toContain("options: .atomic")
    expect(writer).toContain("data.count <= 65536")
    expect(writer).toContain(
      "private static let snapshotQueue = DispatchQueue(",
    )
    expect(writer.match(/runOnQueue\(Self.snapshotQueue\)/g)).toHaveLength(2)
    expect(reader).toContain(
      'appendingPathComponent("Library/Caches/top-shelf.json")',
    )
  })
})
