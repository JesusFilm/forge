// Test stand-in for web's translate-ui-catalogs.mjs. It sends no request: it
// logs its argv and writes `[<locale>] <English>` for each key it must fill.
// No test reads a progress file, so it writes none.

import fs from "node:fs"
import path from "node:path"
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

log({ argv: args })

const messagesDir = value("--messages-dir")
const policy = JSON.parse(fs.readFileSync(value("--policy"), "utf8"))
const neutral = new Set(policy.intentionallyLocaleNeutral ?? [])
const source = flatten(
  JSON.parse(fs.readFileSync(path.join(messagesDir, "en.json"), "utf8")),
)

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
  fs.writeFileSync(file, `${JSON.stringify(unflatten(catalog), null, 2)}\n`)
  log({ locale, translated: keys })
  console.log(
    JSON.stringify({
      event: "locale_complete",
      locale,
      translatedMessages: keys.length,
    }),
  )
}
process.exitCode = failed ? 1 : 0
