/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

describe("TV TypeScript module resolution", () => {
  it("augments TV React Native even when mobile React Native is hoisted", () => {
    const root = path.resolve(__dirname, "..")
    const config = ts.readConfigFile(
      path.join(root, "tsconfig.json"),
      ts.sys.readFile,
    )
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
    const resolve = (from) =>
      ts.resolveModuleName("react-native", from, parsed.options, ts.sys)
        .resolvedModule?.resolvedFileName
    const entry = resolve(path.join(root, "probe.ts"))
    expect(entry).toBeDefined()
    const augmentation = path.join(
      path.dirname(entry),
      "public/ReactNativeTVTypes.d.ts",
    )
    expect(fs.existsSync(augmentation)).toBe(true)
    expect(fs.realpathSync(resolve(augmentation))).toBe(fs.realpathSync(entry))
  })
})
