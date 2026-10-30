/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The Known-Bug List match (R28, KTD14): journey, device, step label, and
// check. A label, never a step index, so a new earlier step keeps the match.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { matchKnownBug, staleKnownBugs } = require("../lib/journeys/knownBugs")
const { readAttemptOutput } = require("../lib/journeys/results")
const { attemptRecord } = require("../lib/journeys/retry")

const ENTRY = {
  journey: "player-language",
  devices: ["iphone-se", "android-phone"],
  step: "The language sheet shows",
  check: "assertion_failed",
  ticket: "FORGE-42",
}
const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function entry(type, label, status, extra = {}) {
  return {
    command: { [type]: { label, optional: false, ...extra } },
    metadata: { status, timestamp: 1, duration: 10, depth: 0 },
  }
}

// commands.json as Maestro writes it: two set-up entries, then the steps.
function attemptDir(labels, failedLabel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-kb-"))
  tempDirs.push(dir)
  const commands = [
    entry("defineVariablesCommand", undefined, "COMPLETED"),
    entry("applyConfigurationCommand", undefined, "COMPLETED"),
    ...labels.map((label) =>
      label === failedLabel
        ? {
            ...entry("assertConditionCommand", label, "FAILED"),
            metadata: {
              status: "FAILED",
              duration: 17000,
              depth: 0,
              error: { message: "Assertion is false: id: x is visible" },
            },
          }
        : entry("tapOnElement", label, "COMPLETED"),
    ),
  ]
  const flowDir = path.join(dir, "debug", "player-language")
  fs.mkdirSync(flowDir, { recursive: true })
  fs.writeFileSync(
    path.join(flowDir, "commands.json"),
    JSON.stringify(commands),
  )
  return dir
}

describe("matchKnownBug", () => {
  const failure = {
    journey: "player-language",
    deviceId: "iphone-se",
    step: "The language sheet shows",
    check: "assertion_failed",
  }

  it("matches only when the journey, a device, the step label, and the check all match", () => {
    expect(matchKnownBug([ENTRY], failure)).toBe(ENTRY)
    expect(
      matchKnownBug([ENTRY], { ...failure, deviceId: "ipad-pro-13" }),
    ).toBe(null)
    expect(
      matchKnownBug([ENTRY], { ...failure, step: "Open the player" }),
    ).toBe(null)
    expect(
      matchKnownBug([ENTRY], { ...failure, check: "selector_not_found" }),
    ).toBe(null)
    expect(matchKnownBug([ENTRY], { ...failure, journey: "other" })).toBe(null)
  })

  it("still matches after a new step is added before the labelled failing step", () => {
    const before = readAttemptOutput(
      attemptDir(
        [
          "Open the video",
          "Open the language sheet",
          "The language sheet shows",
        ],
        "The language sheet shows",
      ),
    )
    const after = readAttemptOutput(
      attemptDir(
        [
          "Open the video",
          "Wait for the player",
          "Open the language sheet",
          "The language sheet shows",
        ],
        "The language sheet shows",
      ),
    )
    const indexOf = (output) => output.commands.indexOf(output.failed)
    expect(indexOf(after)).toBe(indexOf(before) + 1)
    for (const output of [before, after]) {
      expect(
        matchKnownBug([ENTRY], {
          ...failure,
          step: output.failed.label,
        }),
      ).toBe(ENTRY)
    }
  })
})

describe("staleKnownBugs", () => {
  const attempt = (deviceId, label, status = "passed") =>
    attemptRecord({
      journey: "player-language",
      deviceId,
      status,
      label,
    })

  it("names an entry whose journey passed on the first try on every device it ran on", () => {
    expect(staleKnownBugs([ENTRY], [attempt("iphone-se", "pass")])).toEqual([
      ENTRY,
    ])
  })

  it("keeps an entry while its journey still fails on one of its devices, or did not run", () => {
    expect(
      staleKnownBugs(
        [ENTRY],
        [
          attempt("iphone-se", "pass"),
          attempt("android-phone", "known", "failed"),
        ],
      ),
    ).toEqual([])
    expect(
      staleKnownBugs([ENTRY], [attempt("iphone-se", "not_run", "not_run")]),
    ).toEqual([])
    expect(staleKnownBugs([ENTRY], [attempt("ipad-pro-13", "pass")])).toEqual(
      [],
    )
  })
})
