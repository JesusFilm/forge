#!/usr/bin/env node
// Writes i18n/native/<tag>.json and the expo.locales map in app.json, which
// prebuild turns into <tag>.lproj/InfoPlist.strings (feat-627). Run
// `node scripts/i18n/generate-native-strings.mjs [--check]` in apps/mobile.

import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import { renderJson, SOURCE_LOCALE } from "./lib/catalogOps.js"
import { formatWithPrettier } from "./lib/scriptFormat.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, "../..")
const REPO = path.resolve(MOBILE, "../..")

// Catalog key to the Info.plist key that iOS reads before any JS runs.
const NATIVE_STRINGS = {
  "NativePermissions.localNetworkUsageDescription":
    "NSLocalNetworkUsageDescription",
}

// Expo writes `key = "value";` unescaped (@expo/config-plugins ios/Locales.js),
// and the catalog holds ICU source, so these would not show as written: a
// quote, a backslash, a line break, or the ICU apostrophe escape ''.
const UNSAFE_STRINGS_TEXT = /["\\\p{Cc}]|''/u

// App Store Connect refuses these as .lproj names (ITMS-90176, build 16). No
// local locale data predicts Apple's list, so add a tag when an email names it.
// iOS then shows that language the Info.plist English.
const IOS_REJECTED_LPROJ_TAGS = new Set([
  "bjt",
  "caa",
  "hak-Hant",
  "iu-Latn",
  "ixl",
  "knf",
  "lbe",
  "mey-Latn",
  "mfv",
  "nan-Hant",
  "quv",
  "sav",
  "snf",
  "tnr",
  "tsg",
  "usp",
  "xin",
])

class NativeStringsError extends Error {}

function parseArgs(argv) {
  const options = {
    check: false,
    messagesDir: path.join(MOBILE, "messages"),
    nativeLocales: path.join(MOBILE, "i18n", "native-locales.json"),
    appJson: path.join(MOBILE, "app.json"),
    outDir: path.join(MOBILE, "i18n", "native"),
  }
  const paths = {
    "--messages-dir=": "messagesDir",
    "--native-locales=": "nativeLocales",
    "--app-json=": "appJson",
    "--out-dir=": "outDir",
  }
  for (const arg of argv) {
    const prefix = Object.keys(paths).find((flag) => arg.startsWith(flag))
    if (arg === "--check") options.check = true
    else if (prefix) {
      options[paths[prefix]] = path.resolve(arg.slice(prefix.length))
    } else {
      throw new NativeStringsError(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    throw new NativeStringsError(`${file}: ${error.message}`)
  }
}

function lookup(catalog, dottedKey) {
  return dottedKey
    .split(".")
    .reduce((node, part) => (node == null ? undefined : node[part]), catalog)
}

// One file per native locale, so expo.locales changes only with the native
// locale list. A later translation then edits only its file, which the
// fingerprint does not hash, and the catalog can still ship over the air.
function localeValues({ messagesDir, nativeLocales }) {
  const declared = readJson(nativeLocales)
  if (!Array.isArray(declared)) {
    throw new NativeStringsError(`${nativeLocales}: expected a list of tags.`)
  }
  const english = readJson(path.join(messagesDir, `${SOURCE_LOCALE}.json`))
  const byTag = {}
  const tags = declared.filter(
    (tag) => tag !== SOURCE_LOCALE && !IOS_REJECTED_LPROJ_TAGS.has(tag),
  )
  for (const tag of tags) {
    const catalogFile = path.join(messagesDir, `${tag}.json`)
    const catalog = fs.existsSync(catalogFile) ? readJson(catalogFile) : {}
    const ios = {}
    for (const [catalogKey, plistKey] of Object.entries(NATIVE_STRINGS)) {
      const translated = lookup(catalog, catalogKey)
      const value =
        typeof translated === "string"
          ? translated
          : lookup(english, catalogKey)
      if (typeof value !== "string") continue
      const unsafe = value.match(UNSAFE_STRINGS_TEXT)
      if (unsafe) {
        throw new NativeStringsError(
          `Cannot write InfoPlist.strings for ${tag}: ${catalogKey} holds ` +
            `${JSON.stringify(unsafe[0])}, which the iOS alert would not ` +
            "show as written. Fix the catalog text.",
        )
      }
      ios[plistKey] = value
    }
    if (Object.keys(ios).length > 0) byTag[tag] = { ios }
  }
  return byTag
}

async function formatJson(value, configFile) {
  return formatWithPrettier(renderJson(value), {
    repoDir: REPO,
    configFile,
    options: { parser: "json" },
  })
}

/** The locale files, mapped to their content, and the expo.locales map. */
async function expectedOutputs(options) {
  const files = new Map()
  const locales = {}
  const outDirFromAppJson = path
    .relative(path.dirname(options.appJson), options.outDir)
    .split(path.sep)
    .join("/")
  for (const [tag, content] of Object.entries(localeValues(options))) {
    const file = path.join(options.outDir, `${tag}.json`)
    files.set(file, await formatJson(content, file))
    locales[tag] = `./${outDirFromAppJson}/${tag}.json`
  }
  return { files, locales: Object.keys(locales).length > 0 ? locales : null }
}

function staleFiles(outDir, files) {
  if (!fs.existsSync(outDir)) return []
  return fs
    .readdirSync(outDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(outDir, name))
    .filter((file) => !files.has(file))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { files, locales } = await expectedOutputs(options)
  const stale = staleFiles(options.outDir, files)
  // Compared by value, so a Prettier-clean hand edit elsewhere is not drift.
  const config = readJson(options.appJson)
  const appJsonCurrent =
    JSON.stringify(config.expo.locales ?? null) === JSON.stringify(locales)

  if (options.check) {
    const drifted = [...files]
      .filter(
        ([file, expected]) =>
          !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected,
      )
      .map(([file]) => path.basename(file))
    const problems = [
      ...drifted,
      ...stale.map((file) => `${path.basename(file)} (stale)`),
      ...(appJsonCurrent ? [] : [path.basename(options.appJson)]),
    ]
    if (problems.length > 0) {
      console.error(
        `Native strings are out of date: ${problems.join(", ")}.\n` +
          "Run `node scripts/i18n/generate-native-strings.mjs` in apps/mobile.",
      )
      process.exit(1)
    }
    return
  }

  fs.mkdirSync(options.outDir, { recursive: true })
  for (const file of stale) fs.rmSync(file)
  for (const [file, content] of files) fs.writeFileSync(file, content)
  if (!appJsonCurrent) {
    if (locales) config.expo.locales = locales
    else delete config.expo.locales
    fs.writeFileSync(options.appJson, await formatJson(config, options.appJson))
  }
}

main().catch((error) => {
  console.error(
    error instanceof NativeStringsError ? error.message : error.stack,
  )
  process.exit(1)
})
