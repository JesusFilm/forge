/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// check-lists: the committed lists load, and each list check fails on the
// mistake it exists for (KTD10, KTD11, KTD12, R23, R28).
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { print } = require("graphql")

const {
  CONFIG_DIR,
  LIST_FILES,
  MOBILE_DIR,
  documentDigest,
  readJson,
  routeScreenId,
  runCheckLists,
  screenInventory,
  sheetRoutePatterns,
  watchSearchDocumentText,
} = require("../lib/lists")
const { WATCH_SEARCH } = require("../../src/lib/queries")
const {
  IN_APP_SHEET_ROUTE_PATTERNS,
} = require("../../src/lib/miniPlayer/suppression")

const CLI = path.join(__dirname, "..", "cli.mjs")
const FIXTURES = path.join(__dirname, "fixtures")

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-lists-"))
  tempDirs.push(dir)
  return dir
}

// A copy of the committed lists with one change, checked by check-lists.
function findingsWith(change) {
  const configDir = tempDir()
  const lists = {}
  for (const [name, file] of Object.entries(LIST_FILES)) {
    lists[name] = readJson(path.join(CONFIG_DIR, file))
  }
  change(lists)
  for (const [name, file] of Object.entries(LIST_FILES)) {
    fs.writeFileSync(path.join(configDir, file), JSON.stringify(lists[name]))
  }
  return runCheckLists({ configDir }).findings.map((finding) => finding.message)
}

describe("check-lists on the committed lists", () => {
  it("passes", () => {
    const result = runCheckLists()
    expect(result.findings).toEqual([])
    expect(result.passed).toBe(true)
  })

  it("returns a machine-readable result and exit 0 from the command", () => {
    const result = childProcess.spawnSync(
      process.execPath,
      [CLI, "check-lists", "--json"],
      { encoding: "utf8" },
    )
    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output).toMatchObject({ mode: "check-lists", passed: true })
    expect(output.findings).toEqual([])
    expect(output.counts.notTested).toBe(
      readJson(path.join(CONFIG_DIR, "not-tested.json")).entries.length,
    )
  })

  it("keeps the four Not-Tested entries that R23 requires", () => {
    const targets = readJson(
      path.join(CONFIG_DIR, "not-tested.json"),
    ).entries.map((entry) => entry.target)
    expect(targets).toEqual(
      expect.arrayContaining([
        "sign-in",
        "account",
        "my-watch-signed-in",
        "for-you-shelf",
      ]),
    )
  })
})

describe("journey links", () => {
  it("fails a journey that opens a website and names the file", () => {
    const journeysDir = path.join(FIXTURES, "journeys-external-link")
    const result = runCheckLists({ journeysDir })
    expect(result.passed).toBe(false)
    expect(result.findings).toEqual([
      {
        list: "journeys",
        file: "apps/mobile/release-check/__tests__/fixtures/journeys-external-link/open-website.yaml",
        message:
          "line 3 opens `https://www.jesusfilm.org/`; a journey opens only forgemobile:// links",
      },
    ])
  })
})

describe("screen names", () => {
  it("fails a Not-Tested entry for a screen that no longer exists", () => {
    let index = null
    const findings = findingsWith((lists) => {
      index = lists.notTested.entries.length
      lists.notTested.entries.push({
        kind: "screen",
        target: "watch-quality",
        platforms: ["ios"],
        reason: "A screen the app removed.",
      })
    })
    expect(findings).toEqual([
      `entries[${index}] names screen watch-quality, which does not exist`,
    ])
  })

  it("fails a reach entry for a screen that no longer exists", () => {
    const findings = findingsWith((lists) => {
      lists.screens.reach[0].screen = "tab-library"
    })
    expect(findings).toEqual([
      "reach[0] names screen tab-library, which does not exist",
    ])
  })

  it("fails a reach rule whose settings key is not in the test settings", () => {
    const findings = findingsWith((lists) => {
      lists.screens.reach[0].hiddenUnless.key = "EXPO_PUBLIC_EXPLORE_ENABLE"
    })
    expect(findings).toEqual([
      "reach[0] key EXPO_PUBLIC_EXPLORE_ENABLE is not in test-settings.json",
    ])
  })

  it.each([
    ["(tabs)/index.tsx", "tab-home"],
    ["(tabs)/watch/index.tsx", "tab-watch"],
    ["(tabs)/profile.tsx", "tab-profile"],
    ["watch/[slug].tsx", "watch"],
    ["watch/language.tsx", "watch-language"],
    ["collection/[sectionKey].tsx", "collection"],
    ["reader-passage.tsx", "reader-passage"],
    ["(tabs)/watch/_layout.ios.tsx", null],
    ["+native-intent.tsx", null],
    ["account.ios.tsx", "account"],
  ])("maps the route file %s to %s", (file, id) => {
    expect(routeScreenId(file)).toBe(id)
  })

  it("reads the sheet ids and the sheet routes from suppression.ts", () => {
    const source = fs.readFileSync(
      path.join(MOBILE_DIR, "src/lib/miniPlayer/suppression.ts"),
      "utf8",
    )
    expect(sheetRoutePatterns(source)).toEqual([...IN_APP_SHEET_ROUTE_PATTERNS])
    expect(screenInventory({ hand: [] }).sheets).toEqual([
      "feedback-modal",
      "library-delete-action-sheet",
      "library-delete-confirm",
      "player-settings",
      "sdui-quiz",
    ])
  })

  it("fails a sheet route pattern that maps to no route file", () => {
    const mobileDir = tempDir()
    fs.mkdirSync(path.join(mobileDir, "app/watch"), { recursive: true })
    fs.mkdirSync(path.join(mobileDir, "src/lib/miniPlayer"), {
      recursive: true,
    })
    fs.writeFileSync(path.join(mobileDir, "app/watch/language.tsx"), "")
    fs.writeFileSync(
      path.join(mobileDir, "src/lib/miniPlayer/suppression.ts"),
      [
        "export const IN_APP_SHEET_ROUTE_PATTERNS = [",
        '  "watch/language",',
        '  "watch/quality",',
        "] as const",
        "",
        'export type NonRouteSheetId = "playerSettings"',
        "",
      ].join("\n"),
    )
    expect(screenInventory({ hand: [] }, mobileDir).problems).toEqual([
      "sheet route watch/quality maps to no route file under app/",
    ])
  })
})

describe("known bugs", () => {
  const entry = {
    journey: "cold-launch-home",
    devices: ["iphone-se"],
    step: "Home shows the hero",
    check: "assertion_failed",
    ticket: "feat-775",
  }

  it("accepts a complete entry", () => {
    expect(
      findingsWith((lists) => lists.knownBugs.entries.push(entry)),
    ).toEqual([])
  })

  it("fails an entry with no ticket", () => {
    const withoutTicket = { ...entry }
    delete withoutTicket.ticket
    expect(
      findingsWith((lists) => lists.knownBugs.entries.push(withoutTicket)),
    ).toEqual(["entries[0] needs a ticket"])
  })

  it.each([
    [{ step: 3 }, "entries[0] needs the failing step's label"],
    [
      { devices: ["pixel-9a"] },
      "entries[0] names device pixel-9a, which is not in devices.json",
    ],
  ])("fails an entry with %j", (change, message) => {
    expect(
      findingsWith((lists) =>
        lists.knownBugs.entries.push({ ...entry, ...change }),
      ),
    ).toEqual([message])
  })
})

describe("saved search answers", () => {
  it("reads the WatchSearch text that the app sends", () => {
    const source = fs.readFileSync(
      path.join(MOBILE_DIR, "src/lib/queries.ts"),
      "utf8",
    )
    const { parse } = require("graphql")
    expect(print(parse(watchSearchDocumentText(source)))).toBe(
      print(WATCH_SEARCH),
    )
    expect(
      readJson(path.join(CONFIG_DIR, "search-answers.json")).documentDigest,
    ).toBe(documentDigest(WATCH_SEARCH))
  })

  it("fails answers recorded for another WatchSearch document", () => {
    const findings = findingsWith((lists) => {
      lists.searchAnswers.documentDigest = "0".repeat(64)
      lists.searchAnswers.answers.push({
        query: "jesus",
        limit: 24,
        offset: 0,
        language: "english",
      })
    })
    expect(findings).toEqual([
      "the WatchSearch document changed after these answers were recorded; run `record-search` again",
    ])
  })
})

describe("writes on read", () => {
  it("fails an entry whose admin source file does not exist", () => {
    const findings = findingsWith((lists) => {
      lists.operations.writesOnRead[0].source =
        "apps/admin/src/services/passage-cache.service.ts"
    })
    expect(findings).toEqual([
      "writesOnRead[0] names apps/admin/src/services/passage-cache.service.ts, which does not exist",
    ])
  })
})

describe("Mux Data key digests", () => {
  const digest = "0".repeat(64)

  it("accepts a digest with the key's length", () => {
    expect(
      findingsWith((lists) =>
        lists.testSettings.muxDataEnvKeyDigests.push({
          sha256: digest,
          length: 26,
        }),
      ),
    ).toEqual([])
  })

  // The build check hashes windows of the key's length, so a digest alone
  // cannot match anything.
  it.each([
    ["a bare digest", digest],
    ["a digest without its length", { sha256: digest }],
    ["a length that is not a whole number", { sha256: digest, length: 2.5 }],
  ])("fails %s", (_label, entry) => {
    expect(
      findingsWith((lists) =>
        lists.testSettings.muxDataEnvKeyDigests.push(entry),
      ),
    ).toEqual([
      "muxDataEnvKeyDigests must list { sha256, length } entries: a SHA-256 hex digest and the key's length",
    ])
  })
})

describe("devices", () => {
  it("fails a simulator name without the Forge RC prefix", () => {
    const findings = findingsWith((lists) => {
      lists.devices.devices[0].name = "iPhone SE"
    })
    expect(findings).toEqual(['devices[0] name must start with "Forge RC "'])
  })
})
