#!/usr/bin/env node
// Writes the mobile catalog status to $GITHUB_STEP_SUMMARY, or to stdout when
// it is unset (KTD8, R17). It never fails a job: the jest suites and the
// release gates enforce, and this report only shows.

import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, "../..")
const LISTED = 30

function parseArgs(argv) {
  const options = { mobileDir: MOBILE, webDir: path.resolve(MOBILE, "../web") }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--mobile-dir")
      options.mobileDir = path.resolve(argv[++index])
    else if (argv[index] === "--web-dir")
      options.webDir = path.resolve(argv[++index])
  }
  return options
}

function list(items, limit = LISTED) {
  if (items.length === 0) return "none"
  const shown = items.slice(0, limit).join(", ")
  return items.length > limit
    ? `${shown}, and ${items.length - limit} more`
    : shown
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function daysSince(date) {
  const days = Math.floor(
    (Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000,
  )
  return Number.isFinite(days) && days >= 0 ? ` (${plural(days, "day")})` : ""
}

function attempt(lines, label, action) {
  try {
    action()
  } catch (error) {
    lines.push(`- The report could not read ${label}: ${error.message}`)
  }
}

function report(options) {
  const checks = require("./lib/catalogChecks.js")
  const messagesDir = path.join(options.mobileDir, "messages")
  const i18nDir = path.join(options.mobileDir, "i18n")
  const lines = ["### Mobile UI translations", ""]

  attempt(lines, "the pending list", () => {
    const { source, catalogs } = checks.readCatalogDir(messagesDir)
    const policy = checks.readPolicy(
      path.join(i18nDir, "translation-policy.json"),
    )
    const summary = checks.pendingSummary(source, catalogs, policy)
    lines.push(`- Pending keys: ${summary.count}`)
    if (summary.oldest) {
      lines.push(
        `- Oldest pending key: \`${summary.oldest.key}\`, pending since ${summary.oldest.since}${daysSince(summary.oldest.since)}`,
      )
    }
    for (const { key, englishIn } of summary.keys) {
      if (englishIn.length === 0) continue
      lines.push(
        `- \`${key}\` still shows English in ${plural(englishIn.length, "catalog")}: ${list(englishIn)}`,
      )
    }
  })

  attempt(lines, "the catalog lists", () => {
    const webTags = checks.catalogTagsIn(path.join(options.webDir, "messages"))
    const mobileTags = new Set(checks.catalogTagsIn(messagesDir))
    const lacking = webTags.filter((tag) => !mobileTags.has(tag))
    lines.push(
      `- Web catalogs that mobile lacks (${lacking.length}): ${list(lacking, Infinity)}`,
    )
    const declared = new Set(
      checks.readJson(path.join(i18nDir, "native-locales.json")),
    )
    const undeclared = webTags.filter((tag) => !declared.has(tag))
    lines.push(
      `- Web catalogs that native-locales.json does not declare (${undeclared.length}): ${list(undeclared, Infinity)}`,
    )
  })
  return `${lines.join("\n")}\n`
}

let text
try {
  text = report(parseArgs(process.argv.slice(2)))
} catch (error) {
  text = `### Mobile UI translations\n\n- The report failed: ${error.message}\n`
}
const summaryFile = process.env.GITHUB_STEP_SUMMARY
try {
  if (summaryFile) fs.appendFileSync(summaryFile, `${text}\n`)
} catch (error) {
  console.log(`The report could not write the job summary: ${error.message}`)
}
process.stdout.write(text)
process.exitCode = 0
