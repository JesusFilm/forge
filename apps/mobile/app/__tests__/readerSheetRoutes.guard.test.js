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
const { formSheetOptions } = require("../../src/lib/sheetOptions")
const { LIST_SHEET_DETENTS } = require("../../src/styles/shared")

// Guard (feat-553 U10, KTD9): the reader's sheets are ROOT routes. The mini
// player hides over a sheet only if its pattern is in the suppression list,
// and a route is a sheet only if the root layout declares it as one.

const APP_DIR = path.join(__dirname, "..")
const ROOT_LAYOUT = fs.readFileSync(path.join(APP_DIR, "_layout.tsx"), "utf8")

const ROOT_SHEETS = IN_APP_SHEET_ROUTE_PATTERNS.filter(
  (pattern) => !pattern.includes("/"),
)
// Root sheets that are not the reader's, each with its own options source,
// named one by one so a new root sheet is a deliberate edit here and never
// passes as a reader sheet. feat-705 U9: the feedback options are built at
// render, because the shared sheet helper loads in the guarded require block.
const NON_READER_ROOT_SHEETS = { feedback: "feedbackSheetOptions()" }
const NON_READER_NAMES = Object.keys(NON_READER_ROOT_SHEETS)
const READER_ROOT_SHEETS = ROOT_SHEETS.filter(
  (name) => !NON_READER_NAMES.includes(name),
)

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Pure detector, so a fixture can prove it flags a real omission.
function screensMissingSheetOptions(
  content,
  names,
  optionsSource = "READER_SHEET_SCREEN_OPTIONS",
) {
  const segments = content
    .split("<Stack.Screen")
    .slice(1)
    .map((segment) => segment.split("/>")[0])
  const declared = new RegExp(`options=\\{${escapeRegExp(optionsSource)}\\}`)
  return names.filter(
    (name) =>
      !segments.some(
        (segment) =>
          segment.includes(`name="${name}"`) && declared.test(segment),
      ),
  )
}

// The object that an options builder in the layout source returns.
function optionsBuilderBody(content, builderName) {
  const match = content.match(
    new RegExp(
      `function ${builderName}\\(\\) \\{\\s*return \\{([\\s\\S]*?)\\n\\s*\\}`,
    ),
  )
  return match ? match[1] : ""
}

describe("the reader's root sheet routes", () => {
  it("are the three sheets U11 pushes", () => {
    expect(READER_ROOT_SHEETS).toEqual(
      Object.values(READER_SHEET_PATHNAMES).map((pathname) =>
        pathname.slice(1),
      ),
    )
  })

  it("names every other root sheet on purpose", () => {
    expect(
      ROOT_SHEETS.filter((name) => NON_READER_NAMES.includes(name)),
    ).toEqual(NON_READER_NAMES)
  })

  // expo-router opens a route that the layout does not declare as a sheet as a
  // full-screen card, while the suppression list still treats it as a sheet.
  it("declares each other root sheet with its own sheet options", () => {
    expect(
      NON_READER_NAMES.filter(
        (name) =>
          screensMissingSheetOptions(
            ROOT_LAYOUT,
            [name],
            NON_READER_ROOT_SHEETS[name],
          ).length > 0,
      ),
    ).toEqual([])
  })

  // feat-705 U9: the shared helper gives the form sheet, the system corner and
  // the transparent fill on iOS 26; sheetOptions.test.ts proves both paths.
  it("presents the feedback sheet as one full-height form sheet", () => {
    const body = optionsBuilderBody(ROOT_LAYOUT, "feedbackSheetOptions")
    expect(body).toMatch(/\.\.\.formSheetOptions\(\)/)
    expect(body).toMatch(/sheetAllowedDetents: \[1\]/)
    expect(formSheetOptions().presentation).toBe("formSheet")
    expect(formSheetOptions()).toHaveProperty("contentStyle")
  })

  it("flags another root sheet declared as a card (positive control)", () => {
    const fixture = `
      function feedbackSheetOptions() {
        return {
          presentation: "card" as const,
          sheetAllowedDetents: [0.5, 1],
        }
      }
      <Stack.Screen name="feedback" options={{ headerShown: false }} />
    `
    expect(
      screensMissingSheetOptions(
        fixture,
        ["feedback"],
        "feedbackSheetOptions()",
      ),
    ).toEqual(["feedback"])
    const body = optionsBuilderBody(fixture, "feedbackSheetOptions")
    expect(body).toMatch(/presentation: "card"/)
    expect(body).not.toMatch(/\.\.\.formSheetOptions\(\)/)
    expect(body).not.toMatch(/sheetAllowedDetents: \[1\]/)
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
    expect(screensMissingSheetOptions(ROOT_LAYOUT, READER_ROOT_SHEETS)).toEqual(
      [],
    )
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
