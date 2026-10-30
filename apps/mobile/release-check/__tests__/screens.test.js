/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The screen list check (KTD11, R22, AE4, AE13): every screen that a platform
// shows needs a journey on that platform that asserts its root testID, or a
// Not-Tested entry. A screen that the settings hide is a skipped platform.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { CONFIG_DIR, JOURNEYS_DIR, MOBILE_DIR } = require("../lib/lists")
const {
  checkScreensCommand,
  notReachedScreens,
  planJourneys,
  runCheckScreens,
} = require("../lib/journeys/screens")
const { parseFlow } = require("../lib/journeys/flow")
const { attemptRecord } = require("../lib/journeys/retry")

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

// A copy of the app's route files and the sheet list, so a test can add a
// route without touching the app.
function mobileCopy({ withApp = true } = {}) {
  const dir = tempDir("release-check-mobile-")
  if (withApp) {
    fs.cpSync(path.join(MOBILE_DIR, "app"), path.join(dir, "app"), {
      recursive: true,
    })
  } else {
    fs.mkdirSync(path.join(dir, "app"))
  }
  const suppression = "src/lib/miniPlayer/suppression.ts"
  fs.mkdirSync(path.dirname(path.join(dir, suppression)), { recursive: true })
  fs.copyFileSync(
    path.join(MOBILE_DIR, suppression),
    path.join(dir, suppression),
  )
  return dir
}

function configCopy(edit = () => {}) {
  const dir = tempDir("release-check-config-")
  fs.cpSync(CONFIG_DIR, dir, { recursive: true })
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))
  const lists = {
    settings: read("test-settings.json"),
    notTested: read("not-tested.json"),
    screens: read("screens.json"),
  }
  edit(lists)
  fs.writeFileSync(
    path.join(dir, "test-settings.json"),
    JSON.stringify(lists.settings),
  )
  fs.writeFileSync(
    path.join(dir, "not-tested.json"),
    JSON.stringify(lists.notTested),
  )
  fs.writeFileSync(
    path.join(dir, "screens.json"),
    JSON.stringify(lists.screens),
  )
  return dir
}

function journeysWith(files) {
  const dir = tempDir("release-check-journeys-")
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source)
  }
  return dir
}

function assertJourney(testId, header = "") {
  return [
    "appId: org.jesusfilm.forgewatch",
    header,
    "---",
    "- assertVisible:",
    `    id: ${testId}`,
    `    label: ${testId} shows`,
  ].join("\n")
}

function captured(run) {
  const out = []
  const err = []
  const exitCode = run({
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  })
  return { exitCode, out: out.join("\n"), err: err.join("\n") }
}

const gapsFor = (result, screen) =>
  result.gaps.filter((gap) => gap.screen === screen)

describe("a new screen (AE4)", () => {
  const mobileDir = mobileCopy()
  fs.writeFileSync(
    path.join(mobileDir, "app", "new-screen.tsx"),
    "export default function NewScreen() { return null }\n",
  )

  it("fails check-screens and names a route with no journey and no Not-Tested entry", () => {
    const result = captured((io) =>
      checkScreensCommand({ flags: {} }, { ...io, mobileDir }),
    )
    expect(result.exitCode).toBe(1)
    expect(result.out).toContain("- new-screen on ios: no journey on ios")
    expect(result.out).toContain(
      "- new-screen on android: no journey on android",
    )
  })

  it("counts no gap for the same app without the route", () => {
    const result = runCheckScreens({ mobileDir: mobileCopy() })
    expect(gapsFor(result, "new-screen")).toEqual([])
  })

  it("counts no gap when a journey asserts it or the Not-Tested List names it", () => {
    const covered = runCheckScreens({
      mobileDir,
      journeysDir: journeysWith({
        "new-screen.yaml": assertJourney("screen-new-screen"),
      }),
    })
    expect(gapsFor(covered, "new-screen")).toEqual([])
    const listed = runCheckScreens({
      mobileDir,
      configDir: configCopy(({ notTested }) => {
        notTested.entries.push({
          kind: "screen",
          target: "new-screen",
          platforms: ["android"],
          reason: "A test entry.",
        })
      }),
    })
    expect(gapsFor(listed, "new-screen")).toEqual([
      { screen: "new-screen", platform: "ios" },
    ])
  })

  it("counts no coverage from an assertion that a condition can skip", () => {
    const conditional = [
      "appId: org.jesusfilm.forgewatch",
      "---",
      "- runFlow:",
      "    when:",
      "      platform: iOS",
      "    commands:",
      "      - assertVisible:",
      "          id: screen-new-screen",
      "          label: New screen shows",
      "    label: Check the new screen",
    ].join("\n")
    const result = runCheckScreens({
      mobileDir,
      journeysDir: journeysWith({ "new-screen.yaml": conditional }),
    })
    expect(gapsFor(result, "new-screen")).toHaveLength(2)
  })
})

describe("a screen that the settings hide (AE13)", () => {
  const configDir = configCopy(({ settings }) => {
    settings.copiedFromProduction.EXPO_PUBLIC_EXPLORE_ENABLED = "1"
    settings.copiedFromProduction.EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED = null
  })
  const journeysDir = journeysWith({
    "explore-five-clips.yaml": assertJourney("screen-tab-explore"),
  })

  it("schedules the Explore journey on iOS only and counts no Explore gap on Android", () => {
    const result = runCheckScreens({ configDir, journeysDir })
    expect(result.journeys).toEqual([
      { id: "explore-five-clips", platforms: ["ios"] },
    ])
    expect(gapsFor(result, "tab-explore")).toEqual([])
    expect(result.skippedPlatforms).toContainEqual({
      screen: "tab-explore",
      platform: "android",
      setting: "EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED",
    })
    expect(result.skippedPlatforms).not.toContainEqual(
      expect.objectContaining({ screen: "tab-explore", platform: "ios" }),
    )
  })

  it("counts an iOS gap for Explore when no journey asserts it", () => {
    const result = runCheckScreens({
      configDir,
      journeysDir: journeysWith({}),
    })
    expect(gapsFor(result, "tab-explore")).toEqual([
      { screen: "tab-explore", platform: "ios" },
    ])
  })

  it("runs the journey on both platforms once Android shows Explore too", () => {
    const result = runCheckScreens({
      configDir: configCopy(({ settings }) => {
        settings.copiedFromProduction.EXPO_PUBLIC_EXPLORE_ENABLED = "1"
        settings.copiedFromProduction.EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED =
          "true"
      }),
      journeysDir,
    })
    expect(result.journeys[0].platforms).toEqual(["ios", "android"])
  })

  it("keeps a journey on the platform that its tag pins", () => {
    const flow = parseFlow(
      assertJourney("screen-tab-home", "tags:\n  - platform:android"),
    )
    const plan = planJourneys(
      [{ id: "home-android", flow }],
      { reach: [], hand: [] },
      {},
    )
    expect(plan[0].platforms).toEqual(["android"])
  })
})

describe("a text match for a generated sheet", () => {
  const actionSheet = {
    id: "library-delete-action-sheet",
    generated: true,
    kind: "actionSheet",
    match: "Delete 1 video.",
    platforms: ["ios"],
    source: "apps/mobile/src/lib/library/deleteActionSheet.ts",
  }
  const configDir = configCopy(({ screens }) => {
    screens.hand = [
      ...screens.hand.filter((entry) => entry.id !== actionSheet.id),
      actionSheet,
    ]
  })
  const textJourney = [
    "appId: org.jesusfilm.forgewatch",
    "---",
    "- assertVisible:",
    "    text: Delete 1 video.",
    "    label: The delete action sheet shows",
  ].join("\n")

  it("counts a journey that asserts the sheet's text, on the sheet's platform", () => {
    const result = runCheckScreens({
      configDir,
      journeysDir: journeysWith({ "delete-sheet.yaml": textJourney }),
    })
    expect(result.journeys).toEqual([
      { id: "delete-sheet", platforms: ["ios"] },
    ])
    expect(gapsFor(result, actionSheet.id)).toEqual([])
  })

  it("counts an iOS gap when no journey asserts the text", () => {
    const result = runCheckScreens({
      configDir,
      journeysDir: journeysWith({}),
    })
    expect(gapsFor(result, actionSheet.id)).toEqual([
      { screen: actionSheet.id, platform: "ios" },
    ])
  })
})

describe("the file-count floor", () => {
  it("refuses an empty scan instead of passing with no screens", () => {
    const result = captured((io) =>
      checkScreensCommand(
        { flags: {} },
        { ...io, mobileDir: mobileCopy({ withApp: false }) },
      ),
    )
    expect(result.exitCode).toBe(2)
    expect(result.err).toMatch(/found 0 route screens, fewer than 20/)
  })

  it("reads the real app and journeys with no refusal", () => {
    const result = runCheckScreens({ journeysDir: JOURNEYS_DIR })
    expect(result.counts.routes).toBeGreaterThanOrEqual(20)
    expect(gapsFor(result, "tab-home")).toEqual([])
    expect(gapsFor(result, "tab-profile")).toEqual([])
  })
})

describe("screens not reached at run time", () => {
  it("names each screen that a device's journeys assert and that no attempt reached", () => {
    const plan = [
      { id: "settings-probe", screens: ["tab-home", "tab-profile"] },
      { id: "watch-language", screens: ["watch", "watch-language"] },
    ]
    const attempts = [
      attemptRecord({
        journey: "settings-probe",
        deviceId: "iphone-se",
        status: "passed",
        screensReached: ["tab-home", "tab-profile"],
      }),
      attemptRecord({
        journey: "watch-language",
        deviceId: "iphone-se",
        screensReached: ["watch"],
      }),
    ]
    expect(notReachedScreens(attempts, plan)).toEqual([
      { screen: "watch-language", deviceId: "iphone-se" },
    ])
  })
})
