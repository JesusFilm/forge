// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read two sources that must agree.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The word's typeface is named TWICE. `app.json` declares it to the expo-font
// plugin, which emits the string verbatim into Android's addCustomFont, and
// the sequence asks for it by that same name. Nothing links the two copies.
//
// A rename or a swapped file on either side makes Android fall back to a
// system face and ships the brand frame in the wrong typeface. Nothing goes
// red: the suite pins the word's geometry and its opacity, never its family.
// iOS resolves by the file's own PostScript name, so one platform rendering
// correctly proves nothing about the other (assets/fonts/README.md).

const APP_JSON = path.join(__dirname, "..", "..", "..", "..", "app.json")
const SEQUENCE = path.join(__dirname, "..", "SplashSequence.tsx")

function readSource(file) {
  const content = fs.readFileSync(file, "utf8")
  // A broken path resolution must not vacuously pass every assertion below.
  expect(content.length).toBeGreaterThan(500)
  return content
}

/**
 * Pure, so a positive-control fixture can prove the detector flags a real
 * drift rather than only that today's two copies happen to agree.
 */
function declaredFamily(source) {
  const match = source.match(/WORD_FAMILY = "([^"]+)"/)
  return match ? match[1] : null
}

/** The expo-font plugin entry, or null when it is absent altogether. */
function fontPlugin(appJson) {
  const plugins = appJson.expo.plugins || []
  const entry = plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-font",
  )
  return entry ? entry[1] : null
}

describe("the splash word's typeface is named the same on both sides", () => {
  it("flags a drifted name (positive control)", () => {
    expect(declaredFamily('const WORD_FAMILY = "NotoSerif-SemiBold"')).toBe(
      "NotoSerif-SemiBold",
    )
    expect(declaredFamily('const WORD_FAMILY = "Marcellus"')).not.toBe(
      "NotoSerif-SemiBold",
    )
    expect(declaredFamily("const WORD_FAMILY = System")).toBeNull()
    expect(fontPlugin({ expo: { plugins: ["expo-router"] } })).toBeNull()
  })

  it("asks Android for exactly the family app.json declares", () => {
    const appJson = JSON.parse(readSource(APP_JSON))
    const family = declaredFamily(readSource(SEQUENCE))
    expect(family).not.toBeNull()

    const plugin = fontPlugin(appJson)
    expect(plugin).not.toBeNull()
    expect(plugin.android.fonts).toHaveLength(1)
    // Android takes the family name from HERE, not from the file.
    expect(plugin.android.fonts[0].fontFamily).toBe(family)
  })

  it("points both platforms at one embedded file", () => {
    const appJson = JSON.parse(readSource(APP_JSON))
    const plugin = fontPlugin(appJson)
    const file = "./assets/fonts/NotoSerif-SemiBold.ttf"

    // iOS resolves the face by its PostScript name, so the FILE is the only
    // thing that ties its side of the pair to the name the sequence asks for.
    expect(plugin.ios.fonts).toEqual([file])
    expect(plugin.android.fonts[0].fontDefinitions).toHaveLength(1)
    expect(plugin.android.fonts[0].fontDefinitions[0].path).toBe(file)

    const onDisk = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      file.replace("./", ""),
    )
    expect(fs.existsSync(onDisk)).toBe(true)
  })
})
