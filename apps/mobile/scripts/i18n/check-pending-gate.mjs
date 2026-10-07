#!/usr/bin/env node
// Release gate (KTD8, KD13): an EAS production build, or update:production with
// --update-production, needs an empty pending list unless I18N_ALLOW_PENDING=1.
// Only Node built-ins, because EAS runs the pre-install hook before install.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_POLICY = path.resolve(HERE, "../../i18n/translation-policy.json")
const LISTED_KEYS = 20

function parseArgs(argv) {
  const options = { updateProduction: false, policy: DEFAULT_POLICY }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--update-production") options.updateProduction = true
    else if (arg === "--policy" && argv[index + 1])
      options.policy = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function releaseTarget(options, env) {
  if (options.updateProduction) return "update:production"
  if (env.EAS_BUILD_PROFILE === "production") return "the EAS production build"
  return null
}

function readPendingKeys(file) {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"))
  const pending = policy?.pendingKeys ?? {}
  if (
    typeof pending !== "object" ||
    pending === null ||
    Array.isArray(pending)
  ) {
    throw new Error("pendingKeys must map each key to its date")
  }
  return Object.entries(pending).sort(
    ([leftKey, leftDate], [rightKey, rightDate]) =>
      leftDate === rightDate
        ? leftKey < rightKey
          ? -1
          : 1
        : leftDate < rightDate
          ? -1
          : 1,
  )
}

function listKeys(entries) {
  const shown = entries
    .slice(0, LISTED_KEYS)
    .map(([key, date]) => `${key} (since ${date})`)
  const more = entries.length - shown.length
  return more > 0 ? `${shown.join(", ")}, and ${more} more` : shown.join(", ")
}

function main() {
  const env = process.env
  const options = parseArgs(process.argv.slice(2))
  const target = releaseTarget(options, env)
  if (target === null) {
    console.log(
      `[i18n] Pending-translation gate skipped: EAS_BUILD_PROFILE=${env.EAS_BUILD_PROFILE ?? "(unset)"} is not a production release.`,
    )
    return 0
  }
  const override = env.I18N_ALLOW_PENDING === "1"

  let entries
  try {
    entries = readPendingKeys(options.policy)
  } catch (error) {
    const reason = `cannot read the pending list in ${options.policy}: ${error.message}`
    if (override) {
      console.log(
        `WARNING: I18N_ALLOW_PENDING=1 lets ${target} continue, but it ${reason}`,
      )
      return 0
    }
    console.error(`[i18n] ${target} stopped: it ${reason}`)
    return 1
  }

  if (entries.length === 0) {
    console.log(
      `[i18n] Pending-translation gate passed for ${target}: no key is pending.`,
    )
    return 0
  }
  const count = `${entries.length} pending key${entries.length === 1 ? "" : "s"}`
  if (override) {
    console.log(
      `WARNING: I18N_ALLOW_PENDING=1 lets ${target} ship ${count} in English in every other locale: ${listKeys(entries)}`,
    )
    return 0
  }
  console.error(
    [
      `[i18n] ${target} stopped: ${count} still show English in other locales: ${listKeys(entries)}.`,
      "Run `node scripts/i18n/translate-catalogs.mjs` in apps/mobile to translate them, and merge the result.",
      "Emergency only: set I18N_ALLOW_PENDING=1 (see the Localization section of apps/mobile/CLAUDE.md).",
    ].join("\n"),
  )
  return 1
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`[i18n] Pending-translation gate failed: ${error.message}`)
  process.exitCode = 1
}
