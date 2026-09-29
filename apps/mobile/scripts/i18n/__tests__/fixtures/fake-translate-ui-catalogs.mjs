// Test stand-in for web's translate-ui-catalogs.mjs. It sends no request: it
// logs its argv, writes `[<locale>] <English>` for each key it must fill, and
// writes a progress file as the real script does.

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { messageContractError } from "./openai-catalog-translator.mjs"

// The command reads this file's text for these names, as it reads web's.
const KNOWN_FLAGS = [
  "--messages-dir",
  "--inventory",
  "--manifest",
  "--progress",
  "--policy",
  "--contexts",
  "--stop-on-quota",
  "--locales",
  "--model",
  "--concurrency",
  "--max-attempts",
]
const args = process.argv.slice(2)
const unknown = args.filter(
  (a) => a.startsWith("--") && !KNOWN_FLAGS.includes(a),
)
if (unknown.length > 0) {
  console.error(`fake web script: unknown flags ${unknown.join(", ")}`)
  process.exit(2)
}
const value = (name) => args[args.indexOf(name) + 1]
const list = (name) => (process.env[name] ?? "").split(",").filter(Boolean)
const render = (json) => `${JSON.stringify(json, null, 2)}\n`
const log = (entry) =>
  fs.appendFileSync(process.env.FAKE_WEB_LOG, `${JSON.stringify(entry)}\n`)

function flatten(tree, prefix = [], out = {}) {
  for (const [key, child] of Object.entries(tree)) {
    if (typeof child === "string") out[[...prefix, key].join(".")] = child
    else flatten(child, [...prefix, key], out)
  }
  return out
}

function unflatten(flat) {
  const tree = {}
  for (const [key, text] of Object.entries(flat)) {
    const parts = key.split(".")
    let cursor = tree
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {}
    cursor[parts.at(-1)] = text
  }
  return tree
}

log({ script: path.basename(fileURLToPath(import.meta.url)), argv: args })

const messagesDir = value("--messages-dir")
const progressPath = value("--progress")
const policy = JSON.parse(fs.readFileSync(value("--policy"), "utf8"))
const neutral = new Set(policy.intentionallyLocaleNeutral ?? [])
const source = flatten(
  JSON.parse(fs.readFileSync(path.join(messagesDir, "en.json"), "utf8")),
)
const progress = fs.existsSync(progressPath)
  ? JSON.parse(fs.readFileSync(progressPath, "utf8"))
  : {
      model: value("--model"),
      completedLocales: [],
      generatedLocales: [],
      catalogDigests: {},
    }

let failed = false
for (const locale of value("--locales").split(",").sort()) {
  // FAKE_QUOTA_LOCALES stops the whole run; FAKE_FAIL_LOCALES fails one locale.
  if (list("FAKE_QUOTA_LOCALES").includes(locale)) {
    failed = true
    console.error(
      JSON.stringify({
        event: "locale_failed",
        locale,
        message: 'OpenAI HTTP 429: {"error":{"code":"insufficient_quota"}}',
      }),
    )
    break
  }
  if (list("FAKE_FAIL_LOCALES").includes(locale)) {
    failed = true
    console.error(
      JSON.stringify({
        event: "locale_failed",
        locale,
        message: "Translation failed validation",
      }),
    )
    continue
  }
  const file = path.join(messagesDir, `${locale}.json`)
  const catalog = flatten(JSON.parse(fs.readFileSync(file, "utf8")))
  for (const key of Object.keys(source)) catalog[key] ??= source[key]
  const keys = Object.keys(source).filter(
    (key) =>
      !neutral.has(key) &&
      (catalog[key] === source[key] ||
        messageContractError(key, source[key], catalog[key]) !== null),
  )
  for (const key of keys) catalog[key] = `[${locale}] ${source[key]}`
  fs.writeFileSync(file, render(unflatten(catalog)))
  log({ locale, translated: keys })
  progress.completedLocales = [
    ...new Set([...progress.completedLocales, locale]),
  ].sort()
  progress.generatedLocales = [
    ...new Set([...progress.generatedLocales, locale]),
  ].sort()
  progress.catalogDigests[locale] = createHash("sha256")
    .update(render(catalog))
    .digest("hex")
  fs.writeFileSync(progressPath, render(progress))
  console.log(
    JSON.stringify({
      event: "locale_complete",
      locale,
      translatedMessages: keys.length,
    }),
  )
}
process.exitCode = failed ? 1 : 0
