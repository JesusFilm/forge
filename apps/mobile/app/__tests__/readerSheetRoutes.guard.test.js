// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the layout source.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const {
  IN_APP_SHEET_ROUTE_PATTERNS,
} = require("../../src/lib/miniPlayer/suppression")
const { READER_SHEET_PATHNAMES } = require("../../src/lib/bible/sheets/routes")
const {
  READER_SHEET_SCREEN_OPTIONS,
} = require("../../src/lib/bible/sheets/screenOptions")
const { LIST_SHEET_DETENTS } = require("../../src/styles/shared")

// Guard (feat-553 U10, KTD9): the reader's sheets are ROOT routes. The mini
// player hides over a sheet only if its pattern is in the suppression list,
// and a route is a sheet only if the root layout declares it as one.

const APP_DIR = path.join(__dirname, "..")
const ROOT_LAYOUT = fs.readFileSync(path.join(APP_DIR, "_layout.tsx"), "utf8")

const ROOT_SHEETS = IN_APP_SHEET_ROUTE_PATTERNS.filter(
  (pattern) => !pattern.includes("/"),
)

// Pure detector, so a fixture can prove it flags a real omission.
function screensMissingSheetOptions(content, names) {
  const segments = content
    .split("<Stack.Screen")
    .slice(1)
    .map((segment) => segment.split("/>")[0])
  return names.filter(
    (name) =>
      !segments.some(
        (segment) =>
          segment.includes(`name="${name}"`) &&
          /options=\{READER_SHEET_SCREEN_OPTIONS\}/.test(segment),
      ),
  )
}

describe("the reader's root sheet routes", () => {
  it("are the three sheets U11 pushes", () => {
    expect(ROOT_SHEETS).toEqual(
      Object.values(READER_SHEET_PATHNAMES).map((pathname) =>
        pathname.slice(1),
      ),
    )
  })

  it.each(ROOT_SHEETS)("has a route file for %s", (name) => {
    expect(fs.existsSync(path.join(APP_DIR, `${name}.tsx`))).toBe(true)
  })

  it("flags a sheet the layout does not declare (positive control)", () => {
    const fixture = `
      <Stack.Screen name="reader-passage" options={READER_SHEET_SCREEN_OPTIONS} />
      <Stack.Screen name="reader-settings" />
    `
    expect(
      screensMissingSheetOptions(fixture, [
        "reader-passage",
        "reader-translation",
        "reader-settings",
      ]),
    ).toEqual(["reader-translation", "reader-settings"])
  })

  it("declares each one as a sheet in the root layout", () => {
    expect(screensMissingSheetOptions(ROOT_LAYOUT, ROOT_SHEETS)).toEqual([])
  })

  it("presents them as form sheets sized by the shared list detents", () => {
    expect(READER_SHEET_SCREEN_OPTIONS.presentation).toBe("formSheet")
    // useSheetListHeight reads LIST_SHEET_DETENTS by the detent index.
    expect(READER_SHEET_SCREEN_OPTIONS.sheetAllowedDetents).toEqual([
      ...LIST_SHEET_DETENTS,
    ])
  })

  it("leaves no app/reader-*.tsx sheet out of the suppression list", () => {
    const files = fs
      .readdirSync(APP_DIR)
      .filter((name) => /^reader-.+\.tsx$/.test(name))
      .map((name) => name.replace(/\.tsx$/, ""))
    expect(files.length).toBeGreaterThanOrEqual(3)
    expect(files.filter((name) => !ROOT_SHEETS.includes(name))).toEqual([])
  })
})
