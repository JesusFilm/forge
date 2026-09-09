// Plain JS (like the other guards here): the RN tsconfig has no Node types,
// and this guard reads source files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: every module below `rawExportRuntime.ts` is pure and injected, which
// is what makes the export path unit-testable without a native mock. The cost
// of that design is that ALL of it stays green when the composition root stops
// wiring the real bindings — the suite proves the decisions, never the runtime.
// This guard is the only thing standing between that and a feature whose sheet
// dismisses and then does nothing.
//
// The write-only flag is the sharpest case. `requestPermissionsAsync(true)`
// asks for the add-only scope KTD7 declares. Dropping the argument asks for
// FULL access — and because `app.json` deliberately deletes
// `NSPhotoLibraryUsageDescription`, iOS terminates the app the moment it is
// requested. That is a one-character edit, it typechecks, and no other test in
// this repo can see it.

const APP_ROOT = path.resolve(__dirname, "../../..")

function read(relative) {
  return fs.readFileSync(path.join(APP_ROOT, relative), "utf8")
}

const RUNTIME = "src/lib/rawExportRuntime.ts"
const PROVIDER = "src/contexts/DownloadsProvider.tsx"

// There are TWO download sheets, and each starts its own kind of export. A
// guard that reads one of them leaves the other free to dismiss and save
// nothing — which is the failure mode this whole file is named for.
const WATCH_ROUTE = "app/watch/download.tsx"
const SERIES_ROUTE = "app/series/download.tsx"

const WATCH_WIRING = ["getRawExportAdapter()", "exportVideo("]
const SERIES_WIRING = [
  "getRawExportAdapter()",
  "buildSeriesExportRun(",
  "runSeriesRawExport(",
  // R21 folds a whole run into one report. Without the channel every episode
  // saves and the viewer is told nothing.
  "publishExportReport",
]

/** Strip comments so a mention inside prose cannot satisfy an assertion. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** Pure detector, so a control can prove it reads code and not prose. */
function missingWiring(source, required) {
  const stripped = stripComments(source)
  return required.filter((token) => !stripped.includes(token))
}

describe("the raw-export composition root wires its native bindings", () => {
  it("requests the ADD-ONLY photo-library scope on both permission calls", () => {
    const source = stripComments(read(RUNTIME))

    // The literal `true` is the write-only flag. Both calls, or iOS terminates
    // the app against a deliberately absent usage string.
    expect(source).toMatch(/getPermissionsAsync\(\s*true\s*\)/)
    expect(source).toMatch(/requestPermissionsAsync\(\s*true\s*\)/)
    // Anti-vacuous: prove the matchers above would not pass on a bare call.
    expect(
      /getPermissionsAsync\(\s*true\s*\)/.test("getPermissionsAsync()"),
    ).toBe(false)
  })

  it("binds the engine, the media library and the app state", () => {
    const source = stripComments(read(RUNTIME))

    for (const binding of [
      "startMediaDownload",
      "stopTask",
      "notifyIosBackgroundComplete",
      "saveToLibraryAsync",
      "createAssetAsync",
      "createAlbumAsync",
      "AppState.currentState",
      "publishExportReport",
      "buildExportRoot",
    ]) {
      expect(source).toContain(binding)
    }
  })

  it("stages OUTSIDE the offline root", () => {
    // KTD2. The offline root is the player's trust prefix, and the offline
    // delete path removes a whole per-video directory by slug.
    const source = stripComments(read(RUNTIME))

    expect(source).toContain("buildExportRoot(documentDirectory)")
    expect(source).not.toContain("OFFLINE_ROOT")
  })

  it("hands the library a COPY, never a move", () => {
    // R38: a library that consumes what it is given must not be able to
    // destroy the offline copy the app still owns.
    const source = stripComments(read(RUNTIME))

    expect(source).toContain("copyFile")
    expect(source).not.toMatch(/\bmoveFile\b/)
  })

  it("is reachable from the app: the provider attaches it", () => {
    // Without this the adapter reads NO offline record, so R36 reuse silently
    // never matches and every export re-transfers.
    expect(stripComments(read(PROVIDER))).toContain("attachRawExportRuntime(")
  })

  it("is reachable from the app: the per-video route starts an export", () => {
    // The route dismissing the sheet and doing nothing else is exactly the
    // state this unit shipped in before the runtime existed.
    expect(missingWiring(read(WATCH_ROUTE), WATCH_WIRING)).toEqual([])
  })

  it("is reachable from the app: the series route starts a run", () => {
    // The same failure mode on the other sheet. It went uncovered because the
    // guard named one route file and nobody counted the sheets.
    expect(missingWiring(read(SERIES_ROUTE), SERIES_WIRING)).toEqual([])
  })

  it("positive control: a gutted series raw branch is caught", () => {
    // The real file with its run start deleted — the shape of "Confirm
    // dismisses and saves nothing".
    const gutted = read(SERIES_ROUTE)
      .replace(/runSeriesRawExport\(/g, "noop(")
      .replace(/buildSeriesExportRun\(/g, "noop(")
    expect(missingWiring(gutted, SERIES_WIRING)).toEqual([
      "buildSeriesExportRun(",
      "runSeriesRawExport(",
    ])
  })

  it("negative control: wiring named only in prose does not satisfy it", () => {
    // Both routes' checks read CODE. A comment describing the call is not one.
    const prose = SERIES_WIRING.map((token) => `// ${token}`).join("\n")
    expect(missingWiring(prose, SERIES_WIRING)).toEqual(SERIES_WIRING)
    expect(missingWiring(prose, WATCH_WIRING)).toEqual(WATCH_WIRING)
  })

  it("negative control: the reader sees an absent call, not a default", () => {
    // Proves each assertion above reads real source rather than passing on a
    // string every file happens to contain.
    const stripped = stripComments("// getRawExportAdapter().exportVideo(x)\n")

    expect(stripped).not.toContain("getRawExportAdapter()")
  })
})
