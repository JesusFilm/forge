/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The CI job-summary report (KTD8, R17): lines, never a failure.
const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")
const ops = require("../lib/catalogOps")

const REPORT = path.join(__dirname, "..", "pending-report.mjs")
const roots = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, ops.renderJson(value))
}

function fixture({
  policy,
  nativeLocales = ["en", "es"],
  webTags = ["en", "es", "fr", "de"],
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pending-report-"))
  roots.push(root)
  const mobile = path.join(root, "mobile")
  writeJson(path.join(mobile, "messages/en.json"), {
    Common: { back: "Go back", next: "Next" },
  })
  writeJson(path.join(mobile, "messages/es.json"), {
    Common: { back: "Go back", next: "Next" },
  })
  writeJson(path.join(mobile, "messages/fr.json"), {
    Common: { back: "Retour", next: "Next" },
  })
  if (policy !== null) {
    writeJson(
      path.join(mobile, "i18n/translation-policy.json"),
      policy ?? {
        humanReviewedLocales: ["en"],
        englishOnlyLocales: [],
        pendingKeys: {
          "Common.next": "2026-09-10",
          "Common.back": "2026-09-01",
        },
      },
    )
  }
  writeJson(path.join(mobile, "i18n/native-locales.json"), nativeLocales)
  for (const tag of webTags)
    writeJson(path.join(root, "web/messages", `${tag}.json`), {})
  return {
    root,
    args: ["--mobile-dir", mobile, "--web-dir", path.join(root, "web")],
  }
}

function run(args, env = {}) {
  return childProcess.spawnSync(process.execPath, [REPORT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  })
}

describe("pending-report.mjs", () => {
  it("writes the count, the oldest key, the English holders, and the catalog gaps to the job summary", () => {
    const { root, args } = fixture()
    const summary = path.join(root, "summary.md")
    const result = run(args, { GITHUB_STEP_SUMMARY: summary })
    expect(result.status).toBe(0)
    const text = fs.readFileSync(summary, "utf8")
    expect(text).toContain("Pending keys: 2")
    expect(text).toMatch(
      /Oldest pending key: `Common\.back`, pending since 2026-09-01/,
    )
    expect(text).toMatch(/`Common\.back` still shows English in 1 catalog: es/)
    expect(text).toMatch(
      /`Common\.next` still shows English in 2 catalogs: es, fr/,
    )
    expect(text).toMatch(/Web catalogs that mobile lacks \(1\): de/)
    expect(text).toMatch(
      /Web catalogs that native-locales\.json does not declare \(2\): de, fr/,
    )
  })

  it("prints to stdout when there is no job summary", () => {
    const { args } = fixture({ policy: { pendingKeys: {} } })
    const result = run(args)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Pending keys: 0")
    expect(result.stdout).not.toContain("Oldest pending key")
  })

  it("reports a missing policy as a line and still exits 0", () => {
    const { args } = fixture({ policy: null })
    const result = run(args)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/could not read the pending list/i)
  })

  it("runs on the real files", () => {
    const result = run([])
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Pending keys: \d+/)
  })
})
