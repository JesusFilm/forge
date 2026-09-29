/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// scripts/i18n/translate-catalogs.mjs against a fake web script (KTD6, R20).
// webScriptChain.test.js drives web's real script against a fake API server.
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const ops = require("../lib/catalogOps")
const {
  DEFAULT_MODEL,
  hashesOf,
  makeWorkspace,
  removeTempDirs,
  runCommand,
} = require("./fixtures/workspace.cjs")

afterAll(removeTempDirs)

const EN = {
  Common: {
    back: "Go back",
    count: "{count, plural, one {# video} other {# videos}}",
  },
  Player: { play: "Play", brand: "BibleProject" },
}

const ES = {
  Common: {
    back: "Volver",
    count: "{count, plural, one {# vídeo} other {# vídeos}}",
  },
  Player: { play: "Reproducir", brand: "BibleProject" },
}

const NEUTRAL = { intentionallyLocaleNeutral: ["Player.brand"] }

function today() {
  return new Date().toISOString().slice(0, 10)
}

function sha256(text, length) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, length)
}

function flagValue(argv, flag) {
  return argv[argv.indexOf(flag) + 1]
}

function webRuns(workspace) {
  return workspace.readLog().filter((entry) => entry.argv)
}

function translatedBy(workspace) {
  return Object.fromEntries(
    workspace
      .readLog()
      .filter((entry) => entry.locale)
      .map((entry) => [entry.locale, entry.translated]),
  )
}

/** Common.back changed from "Go back" after its translations were recorded. */
function changedBackWorkspace(catalogs) {
  return makeWorkspace({
    en: { ...EN, Common: { ...EN.Common, back: "Go back now" } },
    catalogs,
    policy: NEUTRAL,
    record: hashesOf(EN),
  })
}

/** Runs a command that must stop early: no file changes, no web script run. */
function refusal(options, args, env) {
  const ws = makeWorkspace({ en: EN, catalogs: { es: {} }, ...options })
  const before = ws.snapshot()
  const result = runCommand(ws, args, env)
  expect(ws.snapshot()).toEqual(before)
  expect(ws.readLog()).toEqual([])
  return result
}

describe("a full run", () => {
  it("passes every flag to the web script, and nothing else (R20)", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: { es: { Common: { back: "Volver" } } },
      policy: NEUTRAL,
      webTags: ["en", "crk", "es", "fr"],
    })
    const json = (value) => `${JSON.stringify(value, null, 2)}\n`
    const progress = [
      "forge-mobile-ui",
      sha256(ws.messagesDir, 8),
      `en${sha256(json(ops.flattenCatalog(EN)), 12)}`,
      `policy${sha256(json(ops.normalizePolicy(ws.readJson("policy"))), 12)}`,
      `${DEFAULT_MODEL}.json`,
    ].join("-")
    const result = runCommand(ws, ["--yes"])
    expect(result.status).toBe(0)
    const runs = webRuns(ws)
    expect(runs).toHaveLength(1)
    expect(runs[0].argv).toEqual([
      "--messages-dir",
      ws.messagesDir,
      "--inventory",
      ws.inventory,
      "--manifest",
      ws.files.manifest,
      "--progress",
      path.join(ws.progressDir, progress),
      "--policy",
      ws.files.policy,
      "--contexts",
      ws.files.contexts,
      "--stop-on-quota",
      "--locales",
      "es,fr",
      "--model",
      DEFAULT_MODEL,
      "--concurrency",
      "4",
      "--max-attempts",
      "4",
    ])
  })

  it("accepts API_OPENAI as the key, as web's script does", () => {
    const ws = makeWorkspace({ en: EN, catalogs: { es: {} }, policy: NEUTRAL })
    const env = { OPENAI_API_KEY: "", API_OPENAI: "test-only-not-a-key" }
    expect(runCommand(ws, ["--yes"], env).status).toBe(0)
    expect(webRuns(ws)).toHaveLength(1)
  })

  it("passes --max-attempts and --concurrency through", () => {
    const ws = makeWorkspace({ en: EN, catalogs: { es: {} }, policy: NEUTRAL })
    expect(
      runCommand(ws, ["--yes", "--max-attempts", "1", "--concurrency", "2"])
        .status,
    ).toBe(0)
    const [run] = webRuns(ws)
    expect(flagValue(run.argv, "--max-attempts")).toBe("1")
    expect(flagValue(run.argv, "--concurrency")).toBe("2")
  })

  it("seeds a missing catalog, fills it, and copies English into an English-only catalog", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: { es: ES },
      policy: NEUTRAL,
      webTags: ["en", "crk", "es", "fr"],
    })
    const result = runCommand(ws, ["--yes"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("generate-catalog-index.mjs")
    expect(ws.readCatalog("fr")).toEqual({
      "Common.back": "[fr] Go back",
      "Common.count": "[fr] {count, plural, one {# video} other {# videos}}",
      "Player.play": "[fr] Play",
      "Player.brand": "BibleProject",
    })
    expect(ws.readCatalog("crk")).toEqual(ops.flattenCatalog(EN))
    // es was complete, so it never reached the web script.
    expect(Object.keys(translatedBy(ws))).toEqual(["fr"])
  })

  it("clears a changed key in every locale, and the fake translator fills it again", () => {
    const ws = changedBackWorkspace({
      es: ES,
      fr: { ...ES, Common: { ...ES.Common, back: "Retour" } },
    })
    expect(runCommand(ws, ["--yes"]).status).toBe(0)
    expect(translatedBy(ws)).toEqual({
      es: ["Common.back"],
      fr: ["Common.back"],
    })
    expect(ws.readCatalog("es")["Common.back"]).toBe("[es] Go back now")
    expect(ws.readCatalog("fr")["Common.back"]).toBe("[fr] Go back now")
    expect(ws.readCatalog("es")["Player.play"]).toBe("Reproducir")
    expect(ws.readJson("record").englishHashes["Common.back"]).toBe(
      ops.englishHash("Go back now"),
    )
  })

  it("records provenance only for a translated, machine-translated locale, and leaves the stub manifest byte-identical", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: { de: {}, es: {}, fr: ES },
      policy: { ...NEUTRAL, humanReviewedLocales: ["de", "en"] },
    })
    const manifest = fs.readFileSync(ws.files.manifest)
    expect(runCommand(ws, ["--yes"]).status).toBe(0)
    expect(fs.readFileSync(ws.files.manifest).equals(manifest)).toBe(true)
    // de is human-reviewed, and fr needed no translation.
    expect(ws.readJson("provenance").machineTranslatedLocales).toEqual({
      es: { model: DEFAULT_MODEL, generatedOn: today() },
    })
  })

  it("runs one web script call per model group, each with its own progress path, after a failed locale too", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: { ar: {}, es: {} },
      policy: NEUTRAL,
      modelTable: { defaultModel: DEFAULT_MODEL, locales: { ar: "gpt-5.6" } },
    })
    expect(runCommand(ws, ["--yes"], { FAKE_FAIL_LOCALES: "es" }).status).toBe(
      1,
    )
    const runs = webRuns(ws)
    expect(runs.map((run) => flagValue(run.argv, "--model"))).toEqual([
      DEFAULT_MODEL,
      "gpt-5.6",
    ])
    expect(runs.map((run) => flagValue(run.argv, "--locales"))).toEqual([
      "es",
      "ar",
    ])
    const [first, second] = runs.map((run) => flagValue(run.argv, "--progress"))
    expect(first).not.toBe(second)
    expect(path.basename(second)).toMatch(/-gpt-5\.6\.json$/)
    expect(ws.readJson("provenance").machineTranslatedLocales.ar.model).toBe(
      "gpt-5.6",
    )
  })

  it("keeps each catalog in the English key order", () => {
    const en = { Common: { a: "Alpha", b: "Beta", c: "Gamma" } }
    const ws = makeWorkspace({
      en,
      catalogs: { es: { Common: { a: "Alfa", c: "Gama" } } },
    })
    expect(runCommand(ws, ["--yes"]).status).toBe(0)
    expect(Object.keys(ws.readCatalog("es"))).toEqual([
      "Common.a",
      "Common.b",
      "Common.c",
    ])
  })

  it("removes a pending key only after every translated locale has it", () => {
    const pendingEs = { ...ES, Common: { ...ES.Common, back: "Go back" } }
    const workspace = () =>
      makeWorkspace({
        en: EN,
        catalogs: { es: pendingEs, fr: pendingEs },
        policy: { ...NEUTRAL, pendingKeys: { "Common.back": "2026-09-01" } },
      })
    const partial = workspace()
    expect(
      runCommand(partial, ["--yes"], { FAKE_FAIL_LOCALES: "fr" }).status,
    ).toBe(1)
    expect(partial.readJson("policy").pendingKeys).toEqual({
      "Common.back": "2026-09-01",
    })
    const full = workspace()
    expect(runCommand(full, ["--yes"]).status).toBe(0)
    expect(full.readJson("policy").pendingKeys).toEqual({})
  })

  it("needs no confirmation and no web script when nothing needs a translation, and settles the pending list", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: { es: ES },
      policy: { ...NEUTRAL, pendingKeys: { "Common.back": "2026-09-01" } },
    })
    const result = runCommand(ws, [])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("No locale needs a translation")
    expect(webRuns(ws)).toEqual([])
    expect(ws.readJson("policy").pendingKeys).toEqual({})
  })
})

describe("a quota stop", () => {
  it("stops at the first quota error, records only finished locales, and names the rest", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: { ar: {}, es: {}, fr: {}, pt: {} },
      policy: NEUTRAL,
      modelTable: { defaultModel: DEFAULT_MODEL, locales: { ar: "gpt-5.6" } },
    })
    const result = runCommand(ws, ["--yes"], { FAKE_QUOTA_LOCALES: "fr" })
    expect(result.status).toBe(1)
    // The second model group never runs after the stop.
    expect(webRuns(ws)).toHaveLength(1)
    expect(result.stdout).toMatch(/Finished 1 locale: es/)
    expect(result.stdout).toMatch(
      /Failed 1 locale:\n\s+fr: .*insufficient_quota/,
    )
    expect(result.stdout).toMatch(/Not started 2 locales: ar, pt/)
    expect(result.stdout).toMatch(/quota is used up/)
    expect(
      Object.keys(ws.readJson("provenance").machineTranslatedLocales),
    ).toEqual(["es"])
    for (const locale of ["ar", "fr", "pt"])
      expect(ws.readCatalog(locale)).toEqual({})
    expect(ws.readCatalog("es")["Common.back"]).toBe("[es] Go back")
  })
})

describe("the no-network modes", () => {
  it("--prune-only removes a deleted key from every catalog, the record, the policy, and the contexts", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: {
        es: { ...ES, Common: { ...ES.Common, gone: "Ido" } },
        fr: { Common: { gone: "Parti" } },
      },
      policy: { ...NEUTRAL, pendingKeys: { "Common.gone": "2026-09-01" } },
      record: { ...hashesOf(EN), "Common.gone": ops.englishHash("Gone") },
      contexts: {
        product: "a test app",
        namespaces: { Common: "Shared labels.", Player: "The player." },
        keys: { "Common.gone": { role: "status message" } },
      },
    })
    const result = runCommand(ws, ["--prune-only"])
    expect(result.status).toBe(0)
    expect(ws.readCatalog("es")).toEqual(ops.flattenCatalog(ES))
    expect(ws.readCatalog("fr")).toEqual({})
    expect(ws.readJson("record").englishHashes["Common.gone"]).toBeUndefined()
    expect(ws.readJson("policy").pendingKeys).toEqual({})
    expect(ws.readJson("contexts").keys).toEqual({})
    expect(webRuns(ws)).toEqual([])
  })

  it("--mark-pending writes the new English into every locale and records the date", () => {
    const ws = changedBackWorkspace({
      es: ES,
      fr: {
        Common: { count: "{count, plural, one {# vidéo} other {# vidéos}}" },
      },
    })
    const before = today()
    const result = runCommand(ws, ["--mark-pending", "Common.back"])
    expect(result.status).toBe(0)
    expect(ws.readCatalog("es")["Common.back"]).toBe("Go back now")
    expect(ws.readCatalog("fr")["Common.back"]).toBe("Go back now")
    expect([before, today()]).toContain(
      ws.readJson("policy").pendingKeys["Common.back"],
    )
    expect(ws.readJson("record").englishHashes["Common.back"]).toBe(
      ops.englishHash("Go back now"),
    )
    expect(webRuns(ws)).toEqual([])
  })

  it("--mark-pending refuses a key that is not in en.json", () => {
    const result = refusal({ catalogs: { es: ES }, policy: NEUTRAL }, [
      "--mark-pending",
      "Common.nope",
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Common.nope")
  })

  it("--restamp records every key while no locale holds a translation", () => {
    const ws = makeWorkspace({ en: EN, record: {} })
    expect(runCommand(ws, ["--restamp"]).status).toBe(0)
    expect(ws.readJson("record").englishHashes).toEqual(hashesOf(EN))
  })

  it("--restamp refuses a changed key while a locale holds a translation of the old English", () => {
    const ws = changedBackWorkspace({ es: ES })
    const result = runCommand(ws, ["--restamp"])
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/Common\.back.*es/)
    expect(ws.readJson("record").englishHashes["Common.back"]).toBe(
      ops.englishHash("Go back"),
    )
  })

  it("--dry-run prints the plan and the request ceiling, including a key that fails the contract check, and writes nothing", () => {
    const ws = makeWorkspace({
      en: EN,
      catalogs: {
        es: { ...ES, Common: { ...ES.Common, count: "{count} vídeos" } },
      },
      policy: NEUTRAL,
      webTags: ["en", "es", "fr"],
    })
    const before = ws.snapshot()
    const result = runCommand(ws, [
      "--dry-run",
      "--json",
      "--max-attempts",
      "3",
    ])
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.seeded).toEqual(["fr"])
    expect(plan.requests).toBe(2)
    expect(plan.maxRequests).toBe(6)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].model).toBe(DEFAULT_MODEL)
    expect(plan.groups[0].locales).toEqual({
      es: ["Common.count"],
      fr: ["Common.back", "Common.count", "Player.play"],
    })
    expect(ws.snapshot()).toEqual(before)
    expect(webRuns(ws)).toEqual([])
  })
})

describe("refusals before any request", () => {
  it("refuses a web script that lacks the caller options", () => {
    const result = refusal(
      { webScript: "fake-translate-ui-catalogs-without-caller-options.mjs" },
      ["--yes"],
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("--policy, --contexts, --stop-on-quota")
  })

  it("refuses to send requests without --yes when stdin is not a terminal", () => {
    const result = refusal({}, [])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("--yes")
  })

  it("refuses without an API key", () => {
    const result = refusal({}, ["--yes"], { OPENAI_API_KEY: "" })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("OPENAI_API_KEY")
  })

  it("refuses a malformed policy", () => {
    const result = refusal({ policy: { pendingKeys: ["Common.back"] } }, [
      "--dry-run",
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("pendingKeys")
  })

  it("refuses a namespace with no context sentence, and names it", () => {
    const result = refusal(
      {
        contexts: {
          product: "a test app",
          namespaces: { Common: "Shared labels." },
        },
      },
      ["--yes"],
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("namespace Player")
  })

  it("refuses a model table entry that is not an API model ID", () => {
    const result = refusal(
      {
        catalogs: { zh: {} },
        modelTable: {
          defaultModel: DEFAULT_MODEL,
          locales: { zh: "codex-local-agent" },
        },
      },
      ["--dry-run"],
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("codex-local-agent")
  })

  it.each([["xx"], ["crk"], ["en"]])("refuses --locales %s", (tag) => {
    const result = refusal({ webTags: ["en", "crk", "es"] }, [
      "--dry-run",
      "--locales",
      tag,
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(tag)
  })

  it("refuses two modes at once", () => {
    const result = refusal({}, ["--restamp", "--prune-only"])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("Choose one mode")
  })
})
