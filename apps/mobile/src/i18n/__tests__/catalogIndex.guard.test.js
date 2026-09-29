// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs, path, and child_process to run the generator.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

// Guard: the catalog index (KTD5) must match messages/, and the app bundle may
// require CLDR plural data only through the generated index (R8).
const MOBILE_DIR = path.join(__dirname, "..", "..", "..")
const SCRIPT = path.join(
  MOBILE_DIR,
  "scripts",
  "i18n",
  "generate-catalog-index.mjs",
)
const I18N_DIR = path.join(MOBILE_DIR, "src", "i18n")
const MESSAGES_DIR = path.join(MOBILE_DIR, "messages")

const tempDirs = []

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-index-"))
  tempDirs.push(dir)
  return dir
}

function runGenerator(args) {
  return childProcess.spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  })
}

/** A messages dir with one `{}` catalog per tag, and an empty out dir. */
function fixture(tags) {
  const root = tempDir()
  const messagesDir = path.join(root, "messages")
  const outDir = path.join(root, "out")
  fs.mkdirSync(messagesDir)
  fs.mkdirSync(outDir)
  for (const tag of tags) {
    fs.writeFileSync(path.join(messagesDir, `${tag}.json`), "{}\n")
  }
  const dirArgs = [`--messages-dir=${messagesDir}`, `--out-dir=${outDir}`]
  return { messagesDir, outDir, dirArgs }
}

/** Reads `tag: "data"` pairs from the generated PLURAL_DATA_TAG object. */
function pluralDataTags(source) {
  const block = source.match(/PLURAL_DATA_TAG[^=]*=\s*\{([^}]*)\}/)
  expect(block).not.toBeNull()
  const pairs = {}
  for (const [, tag, dataTag] of block[1].matchAll(
    /"?([A-Za-z-]+)"?:\s*"([A-Za-z-]+)"/g,
  )) {
    pairs[tag] = dataTag
  }
  return pairs
}

const PLURAL_DATA_REQUIRE = /intl-pluralrules\/locale-data/

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|js)$/.test(entry.name) ? [full] : []
  })
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("UI catalog index", () => {
  it("--check passes on the committed index", () => {
    const result = runGenerator(["--check"])
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })

  it("--check fails when a catalog is added without regeneration (negative control)", () => {
    const { messagesDir, dirArgs } = fixture(["en"])
    expect(runGenerator(dirArgs).status).toBe(0)
    expect(runGenerator([...dirArgs, "--check"]).status).toBe(0)

    fs.writeFileSync(path.join(messagesDir, "fr.json"), "{}\n")
    const result = runGenerator([...dirArgs, "--check"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("catalogs.generated.ts")
  })

  it("--check fails when a generated file is edited by hand", () => {
    const { outDir, dirArgs } = fixture(["en"])
    expect(runGenerator(dirArgs).status).toBe(0)
    const file = path.join(outDir, "pluralData.generated.ts")
    fs.appendFileSync(file, "// hand edit\n")
    const result = runGenerator([...dirArgs, "--check"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("pluralData.generated.ts")
  })

  it("maps each catalog tag to the exact CLDR plural data tag it loads (KTD1)", () => {
    const { outDir, dirArgs } = fixture([
      "en",
      "ar",
      "ru",
      "zh-Hans",
      "zh-Hant",
      "sr-Latn",
      "qu",
      "tl",
      "fil",
      "pt",
    ])
    expect(runGenerator(dirArgs).status).toBe(0)
    const source = fs.readFileSync(
      path.join(outDir, "pluralData.generated.ts"),
      "utf8",
    )
    expect(pluralDataTags(source)).toEqual({
      en: "en",
      ar: "ar",
      ru: "ru",
      "zh-Hans": "zh",
      "zh-Hant": "zh",
      "sr-Latn": "sr",
      qu: "en",
      tl: "tl",
      fil: "fil",
      pt: "pt",
    })
    // One loader per data tag, and none for the tag with no CLDR data.
    const loaded = [
      ...source.matchAll(/intl-pluralrules\/locale-data\/([A-Za-z-]+)\.js/g),
    ].map((match) => match[1])
    expect(loaded.sort()).toEqual(
      ["ar", "en", "fil", "pt", "ru", "sr", "tl", "zh"].sort(),
    )
  })

  it("refuses a file name that is not a catalog tag", () => {
    const { messagesDir, dirArgs } = fixture(["en"])
    fs.writeFileSync(path.join(messagesDir, "en_US.json"), "{}\n")
    const result = runGenerator(dirArgs)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("en_US.json")
  })

  it("refuses a messages dir without en.json", () => {
    const { dirArgs } = fixture(["fr"])
    const result = runGenerator(dirArgs)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("en.json")
  })

  it("loads plural data only for the catalogs that exist (R8)", () => {
    const catalogs = fs
      .readdirSync(MESSAGES_DIR)
      .filter((name) => name.endsWith(".json"))
    const committed = fs.readFileSync(
      path.join(I18N_DIR, "pluralData.generated.ts"),
      "utf8",
    )
    expect(Object.keys(pluralDataTags(committed)).length).toBe(catalogs.length)
  })

  it("finds no plural data require outside the generated index", () => {
    const files = [
      ...sourceFiles(path.join(MOBILE_DIR, "src")),
      ...sourceFiles(path.join(MOBILE_DIR, "app")),
    ]
    // A floor, so a broken walk cannot pass by scanning nothing.
    expect(files.length).toBeGreaterThan(100)
    const offenders = files
      .filter((file) => !file.endsWith("pluralData.generated.ts"))
      .filter((file) => PLURAL_DATA_REQUIRE.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(MOBILE_DIR, file))
    expect(offenders).toEqual([])
  })

  it("flags a stray plural data require (positive control)", () => {
    const stray = `require("@formatjs/intl-pluralrules/locale-data/ar.js")`
    expect(PLURAL_DATA_REQUIRE.test(stray)).toBe(true)
  })

  it("allows the polyfill itself (negative control)", () => {
    const polyfill = `import "@formatjs/intl-pluralrules/polyfill-force.js"`
    expect(PLURAL_DATA_REQUIRE.test(polyfill)).toBe(false)
  })
})
