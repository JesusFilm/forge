/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The journey file rules that check-lists adds (README section 2, KTD12) and
// the one Maestro call per attempt (KTD7).
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { parseFlow } = require("../lib/journeys/flow")
const {
  IOS_DRIVER_HOST_PORT,
  maestroArgs,
  maestroEnv,
} = require("../lib/journeys/maestro")
const { JOURNEYS_DIR, runCheckLists } = require("../lib/lists")

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function journeysWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-rules-"))
  tempDirs.push(dir)
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source)
  }
  return dir
}

function journeyFindings(journeysDir) {
  return runCheckLists({ journeysDir })
    .findings.filter((finding) => finding.list === "journeys")
    .map((finding) => finding.message)
}

const LAUNCH = [
  "appId: org.jesusfilm.forgewatch",
  "---",
  "- launchApp:",
  "    permissions:",
  "      notifications: deny",
]

describe("check-lists journey rules", () => {
  it("passes the committed journeys", () => {
    expect(journeyFindings(JOURNEYS_DIR)).toEqual([])
  })

  it("rejects clearState in launchApp and as its own step", () => {
    const messages = journeyFindings(
      journeysWith({
        "launch.yaml": [
          ...LAUNCH,
          "    clearState: true",
          "    label: Launch",
        ].join("\n"),
        "clear.yaml": [...LAUNCH, "    label: Launch", "- clearState"].join(
          "\n",
        ),
      }),
    )
    expect(messages).toEqual([
      expect.stringMatching(/^line 7 runs clearState/),
      expect.stringMatching(/^line 3 sets clearState in launchApp/),
    ])
  })

  it("rejects a launchApp that does not deny notifications", () => {
    const messages = journeyFindings(
      journeysWith({
        "allow.yaml": [
          "appId: org.jesusfilm.forgewatch",
          "---",
          "- launchApp:",
          "    label: Launch",
        ].join("\n"),
      }),
    )
    expect(messages).toEqual([
      expect.stringMatching(
        /^line 3 launches the app without `permissions: \{ notifications: deny \}`/,
      ),
    ])
  })

  it("names a journey it cannot read", () => {
    const messages = journeyFindings(
      journeysWith({
        "broken.yaml": [
          "appId: x",
          "---",
          "- tapOn:",
          "      id: a",
          "    label: b",
        ].join("\n"),
      }),
    )
    expect(messages).toEqual([
      expect.stringMatching(/^cannot read the journey: line 5/),
    ])
  })
})

describe("the journey reader", () => {
  it("reads labels, nested conditional steps, and platform tags", () => {
    const flow = parseFlow(
      fs.readFileSync(path.join(JOURNEYS_DIR, "settings-probe.yaml"), "utf8"),
    )
    expect(flow.name).toBe("settings-probe")
    expect(flow.steps.every((step) => step.label !== null)).toBe(true)
    const hidden = flow.steps.find(
      (step) => step.label === "The Explore tab is hidden",
    )
    expect(hidden).toEqual(
      expect.objectContaining({ depth: 1, conditional: true }),
    )
    expect(
      parseFlow(
        ["appId: x", "tags:", "  - platform:ios", "---", "- back"].join("\n"),
      ).pinnedPlatforms,
    ).toEqual(["ios"])
  })
})

describe("the Maestro call", () => {
  const base = {
    deviceRef: "UDID",
    flowFile: "/run/journeys/cold-launch-home.yaml",
    outputDir: "/run/attempts/cold-launch-home/iphone-se/1",
    variables: { EXPLORE_TAB: "hidden" },
  }

  it("names the device, its output, and the iOS driver port, and never asks for analysis", () => {
    const ios = maestroArgs({ ...base, platform: "ios" })
    expect(ios).toEqual([
      "test",
      "--device",
      "UDID",
      "--driver-host-port",
      String(IOS_DRIVER_HOST_PORT),
      "--format",
      "JUNIT",
      "--output",
      "/run/attempts/cold-launch-home/iphone-se/1/junit.xml",
      "--debug-output",
      "/run/attempts/cold-launch-home/iphone-se/1/debug",
      "--flatten-debug-output",
      "--no-ansi",
      "-e",
      "EXPLORE_TAB=hidden",
      "/run/journeys/cold-launch-home.yaml",
    ])
    const android = maestroArgs({ ...base, platform: "android" })
    expect(android).not.toContain("--driver-host-port")
    expect(
      [...ios, ...android].some((arg) => /analy[sz]e|cloud/.test(arg)),
    ).toBe(false)
  })

  it("gives Maestro its three switches and no key from the caller's environment", () => {
    const env = maestroEnv({
      HOME: "/Users/tester",
      PATH: "/opt/bin",
      EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "secret",
    })
    expect(env).toEqual(
      expect.objectContaining({
        HOME: "/Users/tester",
        MAESTRO_CLI_NO_ANALYTICS: "1",
        MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
        MAESTRO_DISABLE_UPDATE_CHECK: "true",
      }),
    )
    expect(env).not.toHaveProperty("EXPO_PUBLIC_DATADOG_CLIENT_TOKEN")
  })
})
