// Plain JS (like the other guards here): the RN tsconfig has no Node types, and
// this guard reads files off disk and runs Node to load metro.config.js.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")

const { BIBLE_BOOKS } = require("../bible/text/books")

// Guard (feat-553 KTD1): BSB ships as 66 Metro assets that bundled.ts reaches
// through literal requires. A .json require would put all 8 MB into the JS
// bundle and every update; a missing require ships a book that cannot open.

const APP_ROOT = path.resolve(__dirname, "../../..")
const BSB_DIR = path.join(APP_ROOT, "assets/bible/bsb")
const CATALOG_ASSET = path.join(APP_ROOT, "assets/bible/catalog.bible")
const LOADER = path.join(APP_ROOT, "src/lib/bible/data/bundled.ts")
const SOURCE_ROOTS = ["src", "app"].map((dir) => path.join(APP_ROOT, dir))
const SOURCE_FILE = /\.(?:[cm]?js|jsx|ts|tsx)$/
const BOOK_IDS = BIBLE_BOOKS.map((book) => book.usfm)
const BOOK_ID_SET = new Set(BOOK_IDS)

/** Strip comments so a mention in prose cannot satisfy an assertion. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** Each `KEY: require("../../../../assets/bible/bsb/NAME.bible")` as [KEY, NAME]. */
function bookRequires(source) {
  const pattern =
    /["']?([0-9A-Z]{3})["']?\s*:\s*require\(\s*["']\.\.\/\.\.\/\.\.\/\.\.\/assets\/bible\/bsb\/([^"'/]+)\.bible["']\s*\)/g
  return [...stripComments(source).matchAll(pattern)].map((match) => [
    match[1],
    match[2],
  ])
}

/** Everything wrong with the loader's book map; empty when it is right. */
function loaderProblems(source) {
  const pairs = bookRequires(source)
  const problems = []
  if (pairs.length !== BOOK_IDS.length) {
    problems.push(
      `expected ${BOOK_IDS.length} book requires, found ${pairs.length}`,
    )
  }
  const seen = new Set()
  for (const [key, name] of pairs) {
    if (key !== name) problems.push(`${key} requires ${name}.bible`)
    if (!BOOK_ID_SET.has(key)) problems.push(`${key} is not a book id`)
    if (seen.has(key)) problems.push(`${key} appears twice`)
    seen.add(key)
  }
  for (const id of BOOK_IDS) {
    if (!seen.has(id)) problems.push(`${id} has no require`)
  }
  return problems
}

/** A .json specifier that names Bible text: a bible path or a book file. */
function isBibleJson(specifier) {
  const base = path.basename(specifier, ".json")
  return (
    /(^|[/\\])bible([/\\]|$)/i.test(path.dirname(specifier)) ||
    BOOK_ID_SET.has(base.toUpperCase()) ||
    /^(bsb|complete)([.-]|$)/i.test(base)
  )
}

/** The .json Bible specifiers that one source file requires or imports. */
function bibleJsonImports(source) {
  const pattern = /(?:require\(\s*|import\(\s*|from\s+)["']([^"']+\.json)["']/g
  return [...stripComments(source).matchAll(pattern)]
    .map((match) => match[1])
    .filter(isBibleJson)
}

function productionSources(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") {
        files.push(...productionSources(full))
      }
    } else if (SOURCE_FILE.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

/** The asset and source extensions that Metro really gets from the config. */
function metroExtensions() {
  const script =
    "const c = require('./metro.config.js');" +
    "process.stdout.write(JSON.stringify({ asset: c.resolver.assetExts, source: c.resolver.sourceExts }))"
  const output = childProcess.execFileSync(process.execPath, ["-e", script], {
    cwd: APP_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  })
  return JSON.parse(output)
}

describe("bundled Bible assets", () => {
  it("has one .bible file per book id in books.ts, and nothing else", () => {
    const names = fs.readdirSync(BSB_DIR).sort()
    expect(names).toEqual(BOOK_IDS.map((id) => `${id}.bible`).sort())
    expect(names).toHaveLength(66)
    expect(fs.existsSync(CATALOG_ASSET)).toBe(true)
  })

  it("metro.config.js registers .bible as an asset, not as source", () => {
    const { asset, source } = metroExtensions()
    expect(asset).toContain("bible")
    expect(source).not.toContain("bible")
  })

  it("bundled.ts has one literal require per book, each naming its own file", () => {
    const source = fs.readFileSync(LOADER, "utf8")
    expect(loaderProblems(source)).toEqual([])
    for (const [, name] of bookRequires(source)) {
      expect(fs.existsSync(path.join(BSB_DIR, `${name}.bible`))).toBe(true)
    }
    expect(stripComments(source)).toMatch(
      /require\(\s*["']\.\.\/\.\.\/\.\.\/\.\.\/assets\/bible\/catalog\.bible["']\s*\)/,
    )
  })

  it("no production source file requires or imports a .json Bible book", () => {
    const files = SOURCE_ROOTS.flatMap(productionSources)
    // Anti-vacuous: the scan must reach the loader itself.
    expect(files).toContain(LOADER)
    const offenders = files.flatMap((file) =>
      bibleJsonImports(fs.readFileSync(file, "utf8")).map(
        (specifier) => `${path.relative(APP_ROOT, file)}: ${specifier}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  it("positive control: the loader reader catches a dropped or crossed book", () => {
    const source = fs.readFileSync(LOADER, "utf8")
    const dropped = source.replace(/^\s*JHN: require\([^)]*\),?\n/m, "")
    expect(loaderProblems(dropped)).toEqual([
      "expected 66 book requires, found 65",
      "JHN has no require",
    ])

    const crossed = source.replace("bsb/JHN.bible", "bsb/LUK.bible")
    expect(loaderProblems(crossed)).toEqual(["JHN requires LUK.bible"])

    const commented = source.replace(/^(\s*)(JHN: require)/m, "$1// $2")
    expect(loaderProblems(commented)).toContain("JHN has no require")
  })

  it("positive control: the .json reader flags Bible text and nothing else", () => {
    expect(
      bibleJsonImports(
        [
          'const jhn = require("../../assets/bible/bsb/JHN.json")',
          'import psalms from "./PSA.json"',
          'import bsb from "../data/bsb-complete.json"',
          'const lazy = import("./bible/catalog.json")',
          'import app from "../../app.json"',
          '// require("../assets/bible/bsb/GEN.json")',
        ].join("\n"),
      ),
    ).toEqual([
      "../../assets/bible/bsb/JHN.json",
      "./PSA.json",
      "../data/bsb-complete.json",
      "./bible/catalog.json",
    ])
  })
})
