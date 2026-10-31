/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// --local-export and --local-import through web's REAL script. Each run points
// OPENAI_BASE_URL at a closed port and sets a sentinel key, so a request that
// leaves the command's server, or a key that reaches it, fails on this host.
const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const ops = require("../lib/catalogOps")
const {
  MOBILE_DIR,
  REAL_INVENTORY,
  REAL_WEB_DIR,
  makeWorkspace,
  removeTempDirs,
  runCommand,
  tempDir,
  writeJson,
} = require("./fixtures/workspace.cjs")

afterAll(removeTempDirs)

const TRANSLATOR = "claude-opus-5-5"
const LOCAL_ENV = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "sentinel-real-key",
  API_OPENAI: "sentinel-real-key",
}
const EN = {
  Probe: {
    back: "Go back",
    play: "Play {title}",
    count: "{count, plural, one {# video} other {# videos}}",
    brand: "BibleProject",
  },
}
const CONTEXTS = {
  product: "a Christian video app for phones, under test",
  namespaces: { Probe: "The probe screen of the test app." },
}
const ANSWERS = {
  es: {
    "Probe.back": "Volver",
    "Probe.play": "Reproducir {title}",
    "Probe.count": "{count, plural, one {# vídeo} other {# vídeos}}",
  },
  fr: {
    "Probe.back": "Retour",
    "Probe.play": "Lire {title}",
    "Probe.count": "{count, plural, one {# vidéo} other {# vidéos}}",
  },
}
const STALE = "the export did not record this key with its current English"

function workspace(options = {}) {
  return makeWorkspace({
    en: EN,
    catalogs: { es: {}, fr: {} },
    policy: { intentionallyLocaleNeutral: ["Probe.brand"] },
    contexts: CONTEXTS,
    webDir: REAL_WEB_DIR,
    inventory: REAL_INVENTORY,
    ...options,
  })
}

function readWork(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))
}

// Web's real folder holds every catalog, so an export without --locales would
// cover all of them.
function exportTo(ws, args = ["--locales", "es,fr"]) {
  const dir = path.join(tempDir(), "work")
  const result = runCommand(ws, ["--local-export", dir, ...args], LOCAL_ENV)
  return { dir, result }
}

function answer(dir, locale, values) {
  writeJson(path.join(dir, `${locale}.answer.json`), values)
}

function importFrom(ws, dir, args = []) {
  return runCommand(
    ws,
    ["--local-import", dir, "--translator", TRANSLATOR, ...args],
    LOCAL_ENV,
  )
}

describe("--local-export", () => {
  it("writes web's exact request for each locale, and translates nothing", () => {
    const ws = workspace()
    const predicted = JSON.parse(
      runCommand(ws, ["--dry-run", "--json", "--locales", "es,fr"]).stdout,
    ).groups[0].locales
    const { dir, result } = exportTo(ws)
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    for (const locale of ["es", "fr"]) {
      const request = readWork(dir, `${locale}.request.json`)
      expect(request.locale).toBe(locale)
      expect(request.system).toContain(CONTEXTS.product)
      expect(request.prompt.targetLocale).toBe(locale)
      expect(Object.keys(request.prompt.messagesToTranslate)).toEqual(
        predicted[locale],
      )
      expect(request.prompt.messageContexts["Probe.back"].surface).toBe(
        CONTEXTS.namespaces.Probe,
      )
      expect(ws.readCatalog(locale)).toEqual({})
    }
    const index = readWork(dir, "index.json")
    expect(index.locales).toEqual(predicted)
    expect(index.englishDigest).toBe(ops.contentDigest(ops.flattenCatalog(EN)))
    expect(ws.readJson("provenance").machineTranslatedLocales).toEqual({})
  })

  it("covers every translated web catalog without --locales, as U16 does", () => {
    const ws = workspace({ catalogs: {} })
    const { dir, result } = exportTo(ws, [])
    expect(result.status).toBe(0)
    const english = new Set(["en", "crk", "mey-Latn"])
    const targets = fs
      .readdirSync(path.join(REAL_WEB_DIR, "messages"))
      .map((name) => name.replace(/\.json$/, ""))
      .filter((tag) => !english.has(tag))
    expect(targets.length).toBeGreaterThan(200)
    expect(Object.keys(readWork(dir, "index.json").locales).sort()).toEqual(
      targets.sort(),
    )
    expect(ws.readCatalog("crk")).toEqual(ops.flattenCatalog(EN))
  })

  it("asks only for a new key, and sends the existing translations as references", () => {
    const ws = workspace({
      en: { Probe: { ...EN.Probe, share: "Share" } },
      catalogs: {
        es: ops.unflattenCatalog({
          ...ANSWERS.es,
          "Probe.brand": "BibleProject",
        }),
      },
      record: Object.fromEntries(
        Object.entries(ops.flattenCatalog(EN)).map(([key, text]) => [
          key,
          ops.englishHash(text),
        ]),
      ),
    })
    const { dir, result } = exportTo(ws, ["--locales", "es"])
    expect(result.status).toBe(0)
    const { prompt } = readWork(dir, "es.request.json")
    expect(prompt.messagesToTranslate).toEqual({ "Probe.share": "Share" })
    expect(prompt.existingReferenceTranslations).toMatchObject({
      "Probe.back": "Volver",
      "Probe.play": "Reproducir {title}",
    })
  })
})

describe("--local-import", () => {
  it("writes the answers through web's script, records the translator, and then has nothing left", () => {
    const ws = workspace()
    const { dir } = exportTo(ws)
    answer(dir, "es", ANSWERS.es)
    answer(dir, "fr", ANSWERS.fr)
    const result = importFrom(ws, dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Finished 2 locales: es, fr/)
    expect(ws.readCatalog("es")).toEqual({
      ...ANSWERS.es,
      "Probe.brand": "BibleProject",
    })
    const date = new Date().toISOString().slice(0, 10)
    expect(ws.readJson("provenance").machineTranslatedLocales).toEqual({
      es: { model: TRANSLATOR, generatedOn: date },
      fr: { model: TRANSLATOR, generatedOn: date },
    })
    const again = importFrom(ws, dir)
    expect(again.status).toBe(0)
    expect(again.stdout).toContain("No locale needs a translation")
  })

  it("names every problem in a bad locale, writes nothing for it, and still writes the good one", () => {
    const ws = workspace()
    const { dir } = exportTo(ws)
    answer(dir, "es", ANSWERS.es)
    // Web's script would accept the select: only mobile's plural check names it.
    answer(dir, "fr", {
      "Probe.back": "Go back",
      "Probe.play": "Lire",
      "Probe.count": "{count, select, one {# vidéo} other {# vidéos}}",
    })
    const result = importFrom(ws, dir)
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/Finished 1 locale: es/)
    const [, failed] = result.stdout.split("Failed 1 locale:\n")
    expect(failed).toMatch(
      /^ {2}fr:\n {4}Probe\.back: the translation equals the English\n {4}ICU variable mismatch: Probe\.play\n {4}Plural or select mismatch: Probe\.count/,
    )
    expect(ws.readCatalog("fr")).toEqual({})
    expect(
      Object.keys(ws.readJson("provenance").machineTranslatedLocales),
    ).toEqual(["es"])
  })

  it("writes a report with every status and problem, and finishes a fixed locale on the next run", () => {
    const ws = workspace()
    const { dir } = exportTo(ws)
    answer(dir, "es", ANSWERS.es)
    fs.writeFileSync(path.join(dir, "fr.answer.json"), "{")
    const first = importFrom(ws, dir)
    expect(first.status).toBe(1)
    expect(first.stdout).toContain(`Full report, with every problem:`)
    expect(readWork(dir, "import-report.json").locales).toEqual({
      es: { status: "finished" },
      fr: {
        status: "failed",
        problems: [expect.stringContaining("is not valid JSON")],
      },
    })
    answer(dir, "fr", ANSWERS.fr)
    const second = importFrom(ws, dir)
    expect(second.status).toBe(0)
    expect(second.stdout).toMatch(/Finished 1 locale: fr/)
    expect(readWork(dir, "import-report.json").locales).toEqual({
      fr: { status: "finished" },
    })
  })

  it("applies web's own script check, which mobile's checks do not copy", () => {
    const ws = workspace({ catalogs: { "az-Cyrl": {} } })
    const { dir } = exportTo(ws, ["--locales", "az-Cyrl"])
    answer(dir, "az-Cyrl", {
      "Probe.back": "Geri qayıt",
      "Probe.play": "{title} oynat",
      "Probe.count": "{count, plural, one {# video} other {# videolar}}",
    })
    const result = importFrom(ws, dir)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Explicit Cyrl script mismatch: Probe.back")
    expect(ws.readCatalog("az-Cyrl")).toEqual({})
  })

  it("fails a key whose English changed after the export", () => {
    const ws = workspace()
    const { dir } = exportTo(ws, ["--locales", "es"])
    answer(dir, "es", ANSWERS.es)
    writeJson(path.join(ws.messagesDir, "en.json"), {
      Probe: { ...EN.Probe, back: "Go back now" },
    })
    const result = importFrom(ws, dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("en.json changed after the export")
    expect(result.stdout).toContain(`Probe.back: ${STALE}`)
    expect(ws.readCatalog("es")).toEqual({})
  })

  it("fails every key when its screen context changed after the export", () => {
    const ws = workspace()
    const { dir } = exportTo(ws, ["--locales", "es"])
    answer(dir, "es", ANSWERS.es)
    writeJson(ws.files.contexts, {
      ...CONTEXTS,
      namespaces: { Probe: "The settings screen of the test app." },
    })
    const result = importFrom(ws, dir)
    expect(result.status).toBe(1)
    for (const key of ["Probe.back", "Probe.play", "Probe.count"])
      expect(result.stdout).toContain(`${key}: ${STALE}`)
    expect(ws.readCatalog("es")).toEqual({})
  })

  it("imports the answered locales, names the rest, and seeds no catalog outside the export", () => {
    const ws = workspace()
    const { dir } = exportTo(ws)
    answer(dir, "es", ANSWERS.es)
    const result = importFrom(ws, dir)
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/Finished 1 locale: es/)
    expect(result.stdout).toMatch(/No answer file yet for 1 locale: fr/)
    expect(fs.existsSync(path.join(ws.messagesDir, "de.json"))).toBe(false)
    expect(fs.existsSync(path.join(ws.messagesDir, "crk.json"))).toBe(false)
  })

  it("refuses an import with no answer file, and changes nothing", () => {
    const ws = workspace()
    const { dir } = exportTo(ws)
    const before = ws.snapshot()
    const result = importFrom(ws, dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("has no answer file")
    expect(ws.snapshot()).toEqual(before)
  })
})

describe("refusals before any change", () => {
  function refusal(args, setup) {
    const ws = workspace()
    if (setup) setup(ws)
    const before = ws.snapshot()
    const result = runCommand(ws, args, LOCAL_ENV)
    expect(ws.snapshot()).toEqual(before)
    return result
  }

  it.each([
    [["--local-import", "/tmp/x"], "needs --translator"],
    [
      ["--local-import", "/tmp/x", "--translator", "codex-local-agent"],
      "needs --translator",
    ],
    [
      ["--local-import", "/tmp/x", "--translator", "claude-code"],
      "needs --translator",
    ],
    [
      ["--local-import", "/tmp/x", "--translator", "claude-opus-5-5[1m]"],
      "no brackets",
    ],
    [["--translator", TRANSLATOR], "works only with --local-import"],
    [["--local-export", "/tmp/x", "--dry-run"], "Choose one mode"],
  ])("refuses %j", (args, message) => {
    const result = refusal(args)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(message)
  })

  it("refuses a work folder inside the repository", () => {
    const result = refusal([
      "--local-export",
      path.join(MOBILE_DIR, "local-work"),
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("outside every git repository")
    expect(fs.existsSync(path.join(MOBILE_DIR, "local-work"))).toBe(false)
  })

  it("refuses a work folder that a symlink puts inside the repository", () => {
    const link = path.join(tempDir(), "repo-link")
    fs.symlinkSync(MOBILE_DIR, link)
    const result = refusal(["--local-export", path.join(link, "local-work")])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("outside every git repository")
    expect(fs.existsSync(path.join(MOBILE_DIR, "local-work"))).toBe(false)
  })

  // Only the git check catches this: the path is outside this repository.
  it("refuses a work folder inside another git repository", () => {
    const other = tempDir()
    childProcess.spawnSync("git", ["init", "-q", other])
    const result = refusal(["--local-export", path.join(other, "work")])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("outside every git repository")
    expect(fs.existsSync(path.join(other, "work"))).toBe(false)
  })

  it("refuses to export into a folder that is not empty", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "old.request.json"), "{}")
    const result = refusal(["--local-export", dir])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("is not empty")
  })

  it("refuses to import a folder with no export index", () => {
    const result = refusal([
      "--local-import",
      tempDir(),
      "--translator",
      TRANSLATOR,
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("export index")
  })
})
