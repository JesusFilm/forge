#!/usr/bin/env node
// Writes i18n/native/<tag>.json and the expo.locales map in app.json, which
// prebuild turns into <tag>.lproj/InfoPlist.strings (feat-627). Run
// `node scripts/i18n/generate-native-strings.mjs [--check]` in apps/mobile.

import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import { formatWithPrettier } from "./lib/scriptFormat.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, "../..")
const REPO = path.resolve(MOBILE, "../..")

const DEFAULT_TAG = "en"

// Catalog key to the Info.plist key that iOS reads before any JS runs.
const NATIVE_STRINGS = {
  "NativePermissions.localNetworkUsageDescription":
    "NSLocalNetworkUsageDescription",
}

// Expo writes `key = "value";` with no escaping (@expo/config-plugins
// ios/Locales.js), so a quote, a backslash, or a line break breaks the file.
const UNSAFE_STRINGS_CHAR = /["\\\p{Cc}]/u

class NativeStringsError extends Error {}

function parseArgs(argv) {
  const options = {
    check: false,
    messagesDir: path.join(MOBILE, "messages"),
    appJson: path.join(MOBILE, "app.json"),
    outDir: path.join(MOBILE, "i18n", "native"),
  }
  const paths = {
    "--messages-dir=": "messagesDir",
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

// Each catalog's translated Info.plist values. A value that equals English (a
// pending key, or an English-only catalog) falls back to Info.plist.
function localeValues({ messagesDir }) {
  const english = readJson(path.join(messagesDir, `${DEFAULT_TAG}.json`))
  const tags = fs
    .readdirSync(messagesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((tag) => tag !== DEFAULT_TAG)
    .sort()
  const byTag = {}
  for (const tag of tags) {
    const catalog = readJson(path.join(messagesDir, `${tag}.json`))
    const ios = {}
    for (const [catalogKey, plistKey] of Object.entries(NATIVE_STRINGS)) {
      const value = lookup(catalog, catalogKey)
      if (typeof value !== "string" || value === lookup(english, catalogKey)) {
        continue
      }
      const unsafe = value.match(UNSAFE_STRINGS_CHAR)
      if (unsafe) {
        throw new NativeStringsError(
          `Cannot write InfoPlist.strings for ${tag}: ${catalogKey} holds ` +
            `${JSON.stringify(unsafe[0])}, which Expo writes unescaped. ` +
            "Fix the catalog text.",
        )
      }
      ios[plistKey] = value
    }
    if (Object.keys(ios).length > 0) byTag[tag] = { ios }
  }
  return byTag
}

async function formatJson(value, configFile) {
  return formatWithPrettier(`${JSON.stringify(value, null, 2)}\n`, {
    repoDir: REPO,
    configFile,
    options: { parser: "json" },
  })
}

/** Every file this script owns, mapped to its expected content. */
async function expectedOutputs(options) {
  const byTag = localeValues(options)
  const outputs = new Map()
  const locales = {}
  const fromAppJson = path
    .relative(path.dirname(options.appJson), options.outDir)
    .split(path.sep)
    .join("/")
  for (const [tag, content] of Object.entries(byTag)) {
    const file = path.join(options.outDir, `${tag}.json`)
    outputs.set(file, await formatJson(content, file))
    locales[tag] = `./${fromAppJson}/${tag}.json`
  }
  const config = readJson(options.appJson)
  if (Object.keys(locales).length > 0) config.expo.locales = locales
  else delete config.expo.locales
  outputs.set(options.appJson, await formatJson(config, options.appJson))
  return outputs
}

function staleFiles(outDir, outputs) {
  if (!fs.existsSync(outDir)) return []
  return fs
    .readdirSync(outDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(outDir, name))
    .filter((file) => !outputs.has(file))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outputs = await expectedOutputs(options)
  const stale = staleFiles(options.outDir, outputs)

  if (options.check) {
    const drifted = [...outputs]
      .filter(
        ([file, expected]) =>
          !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected,
      )
      .map(([file]) => path.basename(file))
    const problems = [
      ...drifted,
      ...stale.map((file) => `${path.basename(file)} (stale)`),
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
  for (const [file, content] of outputs) fs.writeFileSync(file, content)
}

main().catch((error) => {
  console.error(
    error instanceof NativeStringsError ? error.message : error.stack,
  )
  process.exit(1)
})
