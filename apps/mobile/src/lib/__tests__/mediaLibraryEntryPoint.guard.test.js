// Plain JS (like the other guards here): the RN tsconfig has no Node types,
// and this guard reads installed package files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: raw export must import expo-media-library from its `/legacy` subpath.
//
// Since SDK 54 the PACKAGE ROOT re-exports `legacyWarnings`, whose
// saveToLibraryAsync / createAssetAsync / createAlbumAsync are stubs whose whole
// body is `throw errorOnLegacyMethodUse(...)` — the package's own doc comment
// says "This method will throw in runtime." The root's TYPED surface is
// identical, so importing the wrong entry point typechecks, lints, and passes
// every mocked test while every export fails on a real device.
//
// This is why the sibling wiring guard was not enough: it greps the composition
// root for the call NAMES, and the names are present either way. The entry point
// is the part that decides whether they work.
//
// Three independent layers below: the runtime capability (can the module this
// app imports actually supply the calls), the upstream premise (does the root
// still ship throwing stubs), and the wiring (does the source name `/legacy`).

const APP_ROOT = path.resolve(__dirname, "../../..")
const RUNTIME = "src/lib/rawExportRuntime.ts"
const LEGACY_SPECIFIER = "expo-media-library/legacy"

/** Exactly the calls the composition root makes. */
const REQUIRED_CALLS = [
  "getPermissionsAsync",
  "requestPermissionsAsync",
  "saveToLibraryAsync",
  "createAssetAsync",
  "createAlbumAsync",
]

/** The three the package root replaces with throwing stubs. */
const THROWING_ON_ROOT = [
  "saveToLibraryAsync",
  "createAssetAsync",
  "createAlbumAsync",
]

function readRuntimeSource() {
  return fs.readFileSync(path.join(APP_ROOT, RUNTIME), "utf8")
}

describe("raw export imports the media library that actually works", () => {
  it("the subpath this app imports really supplies every call it makes", () => {
    // The strongest layer: resolve the module and look at what is there, rather
    // than trusting the specifier string.
    const legacy = require(LEGACY_SPECIFIER)

    for (const call of REQUIRED_CALLS) {
      expect(typeof legacy[call]).toBe("function")
    }
  })

  it("upstream premise: the package root still ships throwing stubs", () => {
    // Read the installed package, not a copy. If a future SDK stops shipping
    // these stubs this test goes red and the whole guard can be revisited —
    // which is the point of pinning a premise this app cannot otherwise see.
    const pkg = path.dirname(
      require.resolve("expo-media-library/package.json", { paths: [APP_ROOT] }),
    )
    const source = fs.readFileSync(
      path.join(pkg, "build/legacyWarnings.js"),
      "utf8",
    )

    for (const call of THROWING_ON_ROOT) {
      const body = new RegExp(
        `export async function ${call}\\([^)]*\\)\\s*\\{[^}]*throw errorOnLegacyMethodUse`,
      )
      expect(source).toMatch(body)
    }
  })

  it("the composition root names the legacy subpath, not the package root", () => {
    const source = readRuntimeSource()

    expect(source).toContain(`from "${LEGACY_SPECIFIER}"`)
    // The bare root specifier must not appear at all: it is the exact edit that
    // reintroduces the break, and it is one character shorter.
    expect(source).not.toMatch(/from\s+"expo-media-library"/)
  })

  it("negative control: the specifier check rejects the root import", () => {
    // Proves the assertion above is not satisfied by any string containing the
    // package name — it is the bare-root form specifically that must fail.
    const broken = 'import * as MediaLibrary from "expo-media-library"\n'

    expect(broken).not.toContain(`from "${LEGACY_SPECIFIER}"`)
    expect(broken).toMatch(/from\s+"expo-media-library"/)
  })
})
