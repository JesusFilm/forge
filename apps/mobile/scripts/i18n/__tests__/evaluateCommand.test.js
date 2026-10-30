/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// evaluate-translations.mjs end to end. A fake `uv` stands in for GlotLID, so
// the wiring of language ID runs with no model and no network.
const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const {
  MOBILE_DIR,
  makeWorkspace,
  removeTempDirs,
  tempDir,
  writeJson,
} = require("./fixtures/workspace.cjs")

afterAll(removeTempDirs)

const COMMAND = path.join(MOBILE_DIR, "scripts/i18n/evaluate-translations.mjs")

const ENGLISH = {
  "Watch.title": "Watch the film",
  "Watch.share": "Share",
}

function run(args, env = {}) {
  return childProcess.spawnSync(process.execPath, [COMMAND, ...args], {
    encoding: "utf8",
    // No uv on this PATH unless a test puts its fake there.
    env: { PATH: tempDir(), HOME: process.env.HOME, ...env },
  })
}

/** A --local-export folder: es and ar answered, fr exported but unanswered. */
function exportFolder() {
  const dir = tempDir()
  const locales = { es: {}, ar: {}, fr: {} }
  writeJson(path.join(dir, "index.json"), {
    createdOn: "2026-10-06",
    locales: Object.fromEntries(
      Object.keys(locales).map((locale) => [locale, Object.keys(ENGLISH)]),
    ),
  })
  for (const locale of Object.keys(locales)) {
    writeJson(path.join(dir, `${locale}.request.json`), {
      locale,
      system: "You are a translator.",
      prompt: { targetLocale: locale, messagesToTranslate: ENGLISH },
    })
  }
  writeJson(path.join(dir, "es.answer.json"), {
    "Watch.title": "Ver la película",
    "Watch.share": "Compartir",
  })
  // A seeded error: the Arabic answer kept English letters (two words, so no
  // English run of three).
  writeJson(path.join(dir, "ar.answer.json"), {
    "Watch.title": "Watch film",
    "Watch.share": "مشاركة",
  })
  return dir
}

function webDir() {
  const dir = tempDir()
  writeJson(path.join(dir, "messages/en.json"), { W: { share: "Share" } })
  writeJson(path.join(dir, "messages/es.json"), { W: { share: "Compartir" } })
  writeJson(path.join(dir, "messages/ar.json"), { W: { share: "شارك" } })
  return dir
}

/** Every file in a folder, by name, with its text. */
function contents(dir) {
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
  )
}

function readReport(dir) {
  return JSON.parse(
    fs.readFileSync(path.join(dir, "evaluation-report.json"), "utf8"),
  )
}

/** A `uv` that copies the request and prints a canned answer. */
function fakeUv(answer) {
  const bin = tempDir()
  const copy = path.join(bin, "request-copy.json")
  const answerFile = path.join(bin, "answer.json")
  writeJson(answerFile, answer)
  fs.writeFileSync(
    path.join(bin, "uv"),
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "uv 0.0.0-test"; exit 0; fi',
      // uv run --quiet <script> <request file>
      `/bin/cp "$4" ${JSON.stringify(copy)}`,
      `/bin/cat ${JSON.stringify(answerFile)}`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  )
  return { bin, readRequest: () => JSON.parse(fs.readFileSync(copy, "utf8")) }
}

describe("evaluate-translations.mjs --answers", () => {
  it("writes a report beside the answers and changes nothing else", () => {
    const dir = exportFolder()
    const before = contents(dir)
    const result = run([
      "--answers",
      dir,
      "--web-dir",
      webDir(),
      "--no-language-id",
    ])

    expect(result.status).toBe(0)
    const after = contents(dir)
    delete after["evaluation-report.json"]
    expect(after).toEqual(before)
    const report = readReport(dir)
    expect(report.languageId).toEqual({ status: "off" })
    expect(report.skipped).toEqual({ fr: "no answer file" })
    expect(report.locales.es.findings).toEqual([])
    expect(report.locales.ar.findings).toMatchObject([
      { rule: "script", severity: "error", key: "Watch.title" },
    ])
    expect(report.locales.es.webAgreement).toMatchObject({
      compared: 1,
      agreed: 1,
    })
    expect(report.summary).toMatchObject({ locales: 2, error: 1 })
    expect(result.stdout).toContain("ar  error  script  Watch.title: ")
    expect(result.stdout).toContain(
      `Full report: ${path.join(dir, "evaluation-report.json")}`,
    )
  })

  it("checks only --locales, and names a tag that the export lacks", () => {
    const dir = exportFolder()
    const result = run([
      "--answers",
      dir,
      "--web-dir",
      webDir(),
      "--no-language-id",
      "--locales",
      "es,xx",
    ])

    expect(result.status).toBe(0)
    const report = readReport(dir)
    expect(Object.keys(report.locales)).toEqual(["es"])
    expect(report.skipped).toEqual({ xx: "not found" })
  })

  it("counts the keys an answer leaves out, and skips an answer it cannot read", () => {
    const dir = exportFolder()
    writeJson(path.join(dir, "es.answer.json"), {
      "Watch.title": "Ver la película",
    })
    fs.writeFileSync(path.join(dir, "fr.answer.json"), "{ not json")
    const result = run([
      "--answers",
      dir,
      "--web-dir",
      webDir(),
      "--no-language-id",
    ])

    expect(result.status).toBe(0)
    const report = readReport(dir)
    expect(report.locales.es).toMatchObject({ keys: 1, missing: 1 })
    expect(report.skipped.fr).toMatch(/is not valid JSON/)
  })

  it("skips language ID with a reason when uv is not installed", () => {
    const dir = exportFolder()
    const result = run(["--answers", dir, "--web-dir", webDir()])

    expect(result.status).toBe(0)
    expect(readReport(dir).languageId).toMatchObject({
      status: "skipped",
      reason: expect.stringMatching(/^uv is not installed/),
    })
  })

  it("merges the language ID answer and sends the shipped tags", () => {
    const dir = exportFolder()
    const web = webDir()
    const uv = fakeUv({
      model: "cis-lmu/glotlid@test",
      locales: {
        es: {
          expected: "spa",
          supported: true,
          verdict: "match",
          top: [{ label: "spa_Latn", probability: 0.99, accepted: true }],
          messages: {},
        },
        ar: {
          expected: "ara",
          supported: true,
          verdict: "mismatch",
          top: [{ label: "eng_Latn", probability: 0.9, accepted: false }],
          messages: {},
        },
      },
    })
    const result = run(["--answers", dir, "--web-dir", web], {
      PATH: uv.bin,
    })

    expect(result.status).toBe(0)
    const report = readReport(dir)
    expect(report.languageId).toEqual({
      status: "ran",
      model: "cis-lmu/glotlid@test",
    })
    expect(report.locales.ar.languageId.verdict).toBe("mismatch")
    expect(report.locales.ar.findings).toMatchObject([
      { rule: "language", severity: "error" },
      { rule: "script", severity: "error", key: "Watch.title" },
    ])
    const request = uv.readRequest()
    expect(request.shipped).toEqual(["ar", "en", "es"])
    expect(request.locales.es.catalog).toBe("Ver la película Compartir")
  })

  it("names a language ID failure and still writes the report", () => {
    const dir = exportFolder()
    const bin = tempDir()
    fs.writeFileSync(
      path.join(bin, "uv"),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\necho "language-id: boom" >&2\nexit 1\n',
      { mode: 0o755 },
    )
    const result = run(["--answers", dir, "--web-dir", webDir()], {
      PATH: bin,
    })

    expect(result.status).toBe(0)
    expect(readReport(dir).languageId).toEqual({
      status: "failed",
      reason: "language-id: boom",
    })
  })
})

describe("evaluate-translations.mjs --catalogs", () => {
  function catalogWorkspace() {
    return makeWorkspace({
      en: { Watch: { title: "Watch the film", share: "Share" } },
      catalogs: {
        // Share still shows English: a pending key, not a translation.
        es: { Watch: { title: "Ver la película", share: "Share" } },
        crk: { Watch: { title: "Watch the film", share: "Share" } },
      },
      policy: { englishOnlyLocales: ["crk"] },
    })
  }

  it("checks every translated catalog and changes no file", () => {
    const workspace = catalogWorkspace()
    const before = workspace.snapshot()
    const out = path.join(tempDir(), "report.json")
    const result = run([
      "--catalogs",
      ...workspace.args.slice(0, 4),
      "--no-language-id",
      "--out",
      out,
    ])

    expect(result.status).toBe(0)
    expect(workspace.snapshot()).toEqual(before)
    const report = JSON.parse(fs.readFileSync(out, "utf8"))
    expect(Object.keys(report.locales)).toEqual(["es"])
    expect(report.locales.es.keys).toBe(1)
    expect(report.skipped).toEqual({ crk: "English-only locale" })
  })

  it("prints the summary and no file without --out", () => {
    const workspace = catalogWorkspace()
    const result = run([
      "--catalogs",
      ...workspace.args.slice(0, 4),
      "--no-language-id",
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Pass --out <file> for the full report.")
  })
})

describe("evaluate-translations.mjs arguments", () => {
  it.each([
    ["no mode", [], "Choose one mode"],
    ["both modes", ["--answers", "/tmp/x", "--catalogs"], "Choose one mode"],
    [
      "--out with --answers",
      ["--answers", "/tmp/x", "--out", "/tmp/r.json"],
      "work only with --catalogs",
    ],
    ["an unknown argument", ["--catalogs", "--json"], "Unknown argument"],
  ])("refuses %s", (_label, args, message) => {
    const result = run(args)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(message)
  })
})
