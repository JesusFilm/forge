/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// Web's REAL translate-ui-catalogs.mjs against a fake OpenAI-compatible server
// on 127.0.0.1 (the script honors OPENAI_BASE_URL). No request leaves the host.
const fs = require("fs")
const http = require("http")
const path = require("path")
const ops = require("../lib/catalogOps")
const {
  DEFAULT_MODEL,
  REAL_INVENTORY,
  REAL_WEB_DIR,
  commandEnv,
  makeWorkspace,
  removeTempDirs,
  runCommand,
  runCommandAsync,
  spawnNode,
} = require("./fixtures/workspace.cjs")

afterAll(removeTempDirs)

// Only for a local check of the chain against an unmerged web script (plan U1).
const CHAIN_WEB_DIR = process.env.I18N_REAL_CHAIN_WEB_DIR ?? REAL_WEB_DIR
const CALLER_OPTIONS = ["--policy", "--contexts", "--stop-on-quota"]
const webSupportsCallerOptions = (() => {
  const text = fs.readFileSync(
    path.join(CHAIN_WEB_DIR, "scripts/translate-ui-catalogs.mjs"),
    "utf8",
  )
  return CALLER_OPTIONS.every((flag) => text.includes(`"${flag}"`))
})()

/** Serves `run(url)`, then closes; a locale in quotaLocales gets HTTP 429. */
async function withFakeOpenAi({ quotaLocales = [] }, run) {
  const requests = []
  const server = http.createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      const payload = JSON.parse(body)
      const system = payload.messages.find((m) => m.role === "system").content
      const user = payload.messages.find((m) => m.role === "user").content
      const prompt = JSON.parse(
        user.split("\n\nThe previous response failed validation")[0],
      )
      const locale = prompt.targetLocale
      requests.push({
        locale,
        keys: Object.keys(prompt.messagesToTranslate),
        system,
        contexts: prompt.messageContexts,
      })
      response.setHeader("content-type", "application/json")
      if (quotaLocales.includes(locale)) {
        response.statusCode = 429
        response.end(
          JSON.stringify({
            error: {
              message: "You exceeded your current quota.",
              type: "insufficient_quota",
              code: "insufficient_quota",
            },
          }),
        )
        return
      }
      const translations = Object.entries(prompt.messagesToTranslate).map(
        ([key, value]) => ({ key, value: `⟦${locale}⟧ ${value}` }),
      )
      response.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ translations }) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const result = await run(`http://127.0.0.1:${server.address().port}/v1`)
    return { result, requests }
  } finally {
    await new Promise((done) => server.close(done))
  }
}

function keysByLocale(requests) {
  return Object.fromEntries(requests.map(({ locale, keys }) => [locale, keys]))
}

function runWebDirectly(workspace, serverUrl, locales) {
  return spawnNode(
    [
      path.join(REAL_WEB_DIR, "scripts/translate-ui-catalogs.mjs"),
      "--messages-dir",
      workspace.messagesDir,
      "--inventory",
      REAL_INVENTORY,
      "--manifest",
      workspace.files.manifest,
      "--progress",
      path.join(workspace.progressDir, "direct.json"),
      "--locales",
      locales,
      "--model",
      DEFAULT_MODEL,
      "--concurrency",
      "1",
      "--max-attempts",
      "1",
    ],
    commandEnv(workspace, { OPENAI_BASE_URL: serverUrl }),
  )
}

function runChain(workspace, locales, quotaLocales) {
  return withFakeOpenAi({ quotaLocales }, (url) =>
    runCommandAsync(
      workspace,
      ["--yes", "--locales", locales, "--concurrency", "1"],
      { OPENAI_BASE_URL: url },
    ),
  )
}

const PROBE_EN = {
  Probe: {
    fine: "Hello",
    missing: "Missing text",
    copy: "Copy me",
    count: "{count, plural, one {# video} other {# videos}}",
    tagged: "Read <b>more</b>",
  },
}

describe("the key-set prediction (KTD6 step 4)", () => {
  it("equals the keys that web's real script sends, including a contract failure", async () => {
    const ws = makeWorkspace({
      en: PROBE_EN,
      catalogs: {
        es: {
          Probe: {
            fine: "Hola",
            copy: "Copy me",
            count: "{count} vídeos",
            tagged: "Leer <b>más</b>",
          },
        },
        fr: {},
      },
      webDir: REAL_WEB_DIR,
      inventory: REAL_INVENTORY,
    })
    const dryRun = runCommand(ws, ["--dry-run", "--json", "--locales", "es,fr"])
    expect(dryRun.status).toBe(0)
    const predicted = JSON.parse(dryRun.stdout).groups[0].locales
    expect(predicted.es).toEqual(["Probe.missing", "Probe.copy", "Probe.count"])

    const { result, requests } = await withFakeOpenAi({}, (url) =>
      runWebDirectly(ws, url, "es,fr"),
    )
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(keysByLocale(requests)).toEqual(predicted)
  })
})

const CHAIN_EN = {
  Probe: {
    back: "Go back now",
    count: "{count, plural, one {# video} other {# videos}}",
    brand: "BibleProject",
  },
}
const CHAIN_CONTEXTS = {
  product: "a Christian video app for phones, under test",
  namespaces: { Probe: "The probe screen of the test app." },
  keys: {
    "Probe.back": {
      role: "back-navigation accessibility label",
      visibility: "assistive technology only",
    },
  },
}

function chainWorkspace(catalogs) {
  return makeWorkspace({
    en: CHAIN_EN,
    catalogs,
    // Probe.back changed from "Go back" after its translations were recorded.
    record: {
      "Probe.back": ops.englishHash("Go back"),
      "Probe.count": ops.englishHash(CHAIN_EN.Probe.count),
      "Probe.brand": ops.englishHash("BibleProject"),
    },
    policy: { intentionallyLocaleNeutral: ["Probe.brand"] },
    contexts: CHAIN_CONTEXTS,
    webDir: CHAIN_WEB_DIR,
    inventory: REAL_INVENTORY,
  })
}

const describeChain = webSupportsCallerOptions ? describe : describe.skip
const describeRefusal = webSupportsCallerOptions ? describe.skip : describe

describeChain(
  "the command through web's real script (U4 dry run with a fake translator)",
  () => {
    it("updates two locales, the source record, and the provenance, and leaves the stub manifest unchanged", async () => {
      const ws = chainWorkspace({
        es: {
          Probe: {
            back: "Volver",
            count: "{count, plural, one {# vídeo} other {# vídeos}}",
            brand: "BibleProject",
          },
        },
      })
      const predicted = JSON.parse(
        runCommand(ws, ["--dry-run", "--json", "--locales", "es,fr"]).stdout,
      ).groups[0].locales
      const manifest = fs.readFileSync(ws.files.manifest)
      const { result, requests } = await runChain(ws, "es,fr")
      expect(result.stderr).toBe("")
      expect(result.status).toBe(0)
      expect(keysByLocale(requests)).toEqual(predicted)
      expect(predicted.es).toEqual(["Probe.back"])
      // --contexts reached the prompt: the product, the surface, the override.
      const [first] = requests
      expect(first.system).toContain(CHAIN_CONTEXTS.product)
      expect(first.contexts["Probe.back"]).toMatchObject({
        surface: CHAIN_CONTEXTS.namespaces.Probe,
        visibility: "assistive technology only",
      })
      expect(ws.readCatalog("es")).toEqual({
        "Probe.back": "⟦es⟧ Go back now",
        "Probe.count": "{count, plural, one {# vídeo} other {# vídeos}}",
        "Probe.brand": "BibleProject",
      })
      expect(ws.readCatalog("fr")).toEqual({
        "Probe.back": "⟦fr⟧ Go back now",
        "Probe.count": "⟦fr⟧ {count, plural, one {# video} other {# videos}}",
        "Probe.brand": "BibleProject",
      })
      expect(ws.readJson("record").englishHashes["Probe.back"]).toBe(
        ops.englishHash("Go back now"),
      )
      const date = new Date().toISOString().slice(0, 10)
      expect(ws.readJson("provenance").machineTranslatedLocales).toEqual({
        es: { model: DEFAULT_MODEL, generatedOn: date },
        fr: { model: DEFAULT_MODEL, generatedOn: date },
      })
      expect(fs.readFileSync(ws.files.manifest).equals(manifest)).toBe(true)
    })

    it("stops at the first quota error with no retry (AE8), and names the unfinished locales", async () => {
      const ws = chainWorkspace({ es: {}, fr: {}, pt: {} })
      const { result, requests } = await runChain(ws, "es,fr,pt", ["fr"])
      expect(result.status).toBe(1)
      expect(requests.map((r) => r.locale)).toEqual(["es", "fr"])
      expect(result.stdout).toMatch(/Finished 1 locale: es/)
      expect(result.stdout).toMatch(/fr: .*insufficient_quota/)
      expect(result.stdout).toMatch(/Not started 1 locale: pt/)
      expect(
        Object.keys(ws.readJson("provenance").machineTranslatedLocales),
      ).toEqual(["es"])
      expect(ws.readCatalog("fr")).toEqual({})
      expect(ws.readCatalog("pt")).toEqual({})
    })
  },
)

describeRefusal(
  "the command before web's script has the caller options",
  () => {
    it("refuses a real run, names the missing options, and changes nothing", () => {
      const ws = chainWorkspace({ es: {} })
      const before = ws.snapshot()
      const result = runCommand(ws, ["--yes", "--locales", "es"], {
        OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain(CALLER_OPTIONS.join(", "))
      expect(ws.snapshot()).toEqual(before)
    })
  },
)
