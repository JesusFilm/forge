/* global require, describe, it, expect, jest */
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("expo/config-plugins", () => ({
  withPodfile: (config, action) => action(config),
}))
const plugin = require("./withTVPodDeploymentTarget")
const original =
  "post_install do |installer|\n  react_native_post_install(installer)\nend"

describe("TV Pod deployment minimum", () => {
  it("uses the app target and preserves higher Pod targets", () => {
    const config = {
      plugins: [
        ["@react-native-tvos/config-tv", { tvosDeploymentTarget: "16.0" }],
      ],
      modResults: { contents: original },
    }
    const result = plugin(config).modResults.contents
    expect(result).toContain(
      "Gem::Version.new(value) < Gem::Version.new('16.0')",
    )
    expect(result).toContain("react_native_post_install(installer)")
    expect(result).not.toContain("IPHONEOS_DEPLOYMENT_TARGET")
    expect(plugin.patchPodfile(result, "16.0")).toBe(result)
  })

  it("rejects an unexpected Podfile template", () => {
    expect(() => plugin.patchPodfile("", "16.0")).toThrow("post_install")
  })

  it("requires the configured tvOS target", () => {
    expect(() => plugin({ plugins: [] })).toThrow("tvosDeploymentTarget")
  })
})
