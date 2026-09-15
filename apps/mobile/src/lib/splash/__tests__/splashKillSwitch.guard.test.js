// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path/crypto to read sources and a PNG.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

// The kill-switch has four halves that no behavioural suite ties together: the
// flag file, the session call site, the generator, and the committed native
// asset. A drift in any one ships a wrong cold launch with every suite green.

const MOBILE = path.join(__dirname, "..", "..", "..", "..")
const FLAG = path.join(
  MOBILE,
  "src",
  "lib",
  "splash",
  "animatedSplashEnabled.ts",
)
const SESSION = path.join(MOBILE, "src", "lib", "splash", "splashSession.ts")
const GENERATOR = path.join(MOBILE, "scripts", "generate-app-icon.mjs")
const SPLASH_ICON = path.join(MOBILE, "assets", "splash-icon.png")

const FLAG_PATTERN = /^export const ANIMATED_SPLASH_ENABLED = (true|false)$/gm

// What the generator emits for each flag state, from sharp 0.34.5 at
// compressionLevel 9. A sharp bump that changes the encoding must regenerate
// and re-pin here; a hand-edited or mis-generated PNG must never pass.
const ASSET_MD5 = {
  off: "b3b28de172a24275e72f0e6abd3a45cf", // the symbol on transparency (RGBA)
  on: "3e3a1aa5127cb5de40453cd2a82b24b0", // the flat #1c1917 field (RGB)
}
const COLOUR_TYPE = { off: 6, on: 2 }

/** All declarations in a source, so a commented duplicate is visible. */
function readFlags(source) {
  return [...source.matchAll(FLAG_PATTERN)].map((m) => m[1] === "true")
}

function readIhdr(bytes) {
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR")
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colourType: bytes[25],
  }
}

function md5(bytes) {
  return crypto.createHash("md5").update(bytes).digest("hex")
}

/** The generator's `if (animatedSplash) { … } else { … }`, brace-matched. */
function splitSplashBranch(source) {
  const head = "if (animatedSplash) {"
  const open = source.indexOf(head)
  if (open === -1) return null
  let depth = 0
  let elseAt = -1
  for (let i = open + head.length - 1; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1
    else if (source[i] === "}") {
      depth -= 1
      if (depth === 0) {
        if (elseAt === -1) {
          if (!source.startsWith("} else {", i)) return null
          elseAt = i
          depth = 1
          i += "} else {".length - 1
        } else {
          return {
            on: source.slice(open + head.length, elseAt),
            off: source.slice(elseAt + "} else {".length, i),
          }
        }
      }
    }
  }
  return null
}

describe("the animated splash kill-switch", () => {
  it("parses the flag the same way the generator does (positive control)", () => {
    expect(readFlags("export const ANIMATED_SPLASH_ENABLED = false")).toEqual([
      false,
    ])
    expect(readFlags("export const ANIMATED_SPLASH_ENABLED = true")).toEqual([
      true,
    ])
    // A rewrite that breaks the one-line contract must fail, not default.
    expect(readFlags("export const ANIMATED_SPLASH_ENABLED = !prod")).toEqual(
      [],
    )
    expect(readFlags("const ANIMATED_SPLASH_ENABLED = false")).toEqual([])
    // A duplicate inside a block comment is what a first-match read would take.
    expect(
      readFlags(
        "/* export const ANIMATED_SPLASH_ENABLED = true */\nexport const ANIMATED_SPLASH_ENABLED = false",
      ),
    ).toEqual([false])
    expect(
      readFlags(
        "/*\nexport const ANIMATED_SPLASH_ENABLED = true\n*/\nexport const ANIMATED_SPLASH_ENABLED = false",
      ),
    ).toEqual([true, false])
  })

  it("declares the flag exactly once, on one line, as a bare literal", () => {
    expect(readFlags(fs.readFileSync(FLAG, "utf8"))).toHaveLength(1)
  })

  it("threads the constant into the app-wide session, not a literal", () => {
    const session = fs.readFileSync(SESSION, "utf8")
    const call = session.slice(
      session.indexOf("export function getSplashSession"),
    )
    expect(call.length).toBeGreaterThan(100)
    expect(call).toContain("animatedSplashEnabled: ANIMATED_SPLASH_ENABLED,")
    expect(call).not.toMatch(/animatedSplashEnabled:\s*(true|false)/)
  })

  it("has the generator read the flag from the same file, with the same pattern", () => {
    const generator = fs.readFileSync(GENERATOR, "utf8")
    expect(generator).toContain("src/lib/splash/animatedSplashEnabled.ts")
    expect(generator).toContain(FLAG_PATTERN.source)
  })

  it("splits a branch the same way the generator writes one (positive control)", () => {
    const halves = splitSplashBranch(
      "if (animatedSplash) {\n A \n} else {\n B \n}",
    )
    expect(halves).toEqual({ on: "\n A \n", off: "\n B \n" })
    expect(splitSplashBranch("if (somethingElse) {\n A \n}")).toBeNull()
  })

  // The generator runs by hand, so nothing executes this branch until someone
  // regenerates — by which time a swapped branch has already written the wrong
  // asset. Pin which emission each half calls.
  it("emits the flat field on the ON half and the symbol on the OFF half", () => {
    const halves = splitSplashBranch(fs.readFileSync(GENERATOR, "utf8"))
    expect(halves).not.toBeNull()
    expect(halves.on).toContain("flatSvg(SIZE, SPLASH_GROUND)")
    expect(halves.on).not.toContain("markSvg(")
    expect(halves.off).toContain("markSvg(SIZE, WIDTH_SPLASH)")
    expect(halves.off).not.toContain("flatSvg(")
  })

  it("commits the asset the flag calls for", () => {
    const [enabled] = readFlags(fs.readFileSync(FLAG, "utf8"))
    const state = enabled ? "on" : "off"
    const bytes = fs.readFileSync(SPLASH_ICON)
    const ihdr = readIhdr(bytes)
    expect(ihdr.width).toBe(1024)
    expect(ihdr.height).toBe(1024)
    expect(ihdr.colourType).toBe(COLOUR_TYPE[state])
    expect(md5(bytes)).toBe(ASSET_MD5[state])
  })
})
