// Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
// no Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require, __dirname */
const fs = require("fs")
const path = require("path")

// Guard: bibleCardArt must stay a pure derivation. It re-runs several times per
// screen open, so a log here would weight the ladder-outcome signal by render
// count and bias it toward false stock outcomes; the hook owns the one emit.
const FORBIDDEN = [
  { token: "datadog", why: "the hook owns the ladder-outcome emit, not this" },
  { token: 'from "react', why: "the module must stay renderer-free" },
  { token: "@apollo", why: "the module must not reach the network" },
  {
    token: "expo-image",
    why: "the module returns URLs, it does not load them",
  },
]

describe("bibleCardArt purity", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "bibleCardArt.ts"),
    "utf8",
  )

  it("reads the module it is guarding", () => {
    // Anti-vacuous: a typo in the path would make every assertion below pass
    // against an empty string.
    expect(source).toContain("export function deriveBibleCardArt")
  })

  for (const { token, why } of FORBIDDEN) {
    it(`does not reference ${token} — ${why}`, () => {
      expect(source.toLowerCase()).not.toContain(token.toLowerCase())
    })
  }
})
