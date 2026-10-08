#!/usr/bin/env node
// Report-only checks of the UI translations (feat-604, layer 1). Run it on a
// local export's answers before the import, or on the catalogs. Not a
// package.json script: a new script entry moves the Expo fingerprint (KTD4).

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const ops = require("./lib/catalogOps.js")
const checks = require("./lib/catalogChecks.js")
const local = require("./lib/localTranslation.js")
const evaluation = require("./lib/translationEvaluation.js")

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LANGUAGE_ID_SCRIPT = path.join(HERE, "language-id.py")
const REPORT_FILE = "evaluation-report.json"
const TERMINAL_FINDINGS_PER_LOCALE = 10
// The first run downloads the 1.7 GB model.
const LANGUAGE_ID_TIMEOUT_MS = 30 * 60 * 1000

const USAGE = `Usage:
  node scripts/i18n/evaluate-translations.mjs --answers <dir> [options]
  node scripts/i18n/evaluate-translations.mjs --catalogs [options]

Checks translations for likely errors and writes a report. It never changes a
catalog and never stops an import.

Modes:
  --answers <dir>        The answer files of a --local-export folder. Writes
                         <dir>/${REPORT_FILE}.
  --catalogs             The catalogs in messages/, except English and the
                         English-only locales. Use --out for the full report.

Options:
  --locales <tags>       Check only these locales (comma-separated).
  --no-language-id       Skip language ID. Without this flag, language ID runs
                         GlotLID through uv; the first run downloads 1.7 GB.
  --messages-dir <dir>   With --catalogs: another catalog folder, such as
                         apps/web/messages.
  --out <file>           With --catalogs: write the full report to <file>.
  --mobile-dir, --web-dir <path>
                         Path overrides for tests.`

const FLAG_OPTIONS = {
  "--catalogs": "catalogs",
  "--no-language-id": "noLanguageId",
  "--help": "help",
}
const VALUE_OPTIONS = {
  "--answers": "answers",
  "--locales": "locales",
  "--messages-dir": "messagesDir",
  "--out": "out",
  "--mobile-dir": "mobileDir",
  "--web-dir": "webDir",
}

class CommandError extends Error {
  constructor(message) {
    super(message)
    this.name = "CommandError"
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const [name, inline] = argv[index].split(/=(.*)/s)
    if (FLAG_OPTIONS[name] && inline === undefined) {
      options[FLAG_OPTIONS[name]] = true
    } else if (VALUE_OPTIONS[name]) {
      const value = inline ?? argv[++index]
      if (!value || value.startsWith("--")) {
        throw new CommandError(`${name} needs a value`)
      }
      options[VALUE_OPTIONS[name]] = value
    } else {
      throw new CommandError(`Unknown argument: ${argv[index]}\n\n${USAGE}`)
    }
  }
  if (options.help) return options
  if (Boolean(options.answers) === Boolean(options.catalogs)) {
    throw new CommandError(`Choose one mode: --answers <dir> or --catalogs.`)
  }
  if (options.answers && (options.out || options.messagesDir)) {
    throw new CommandError(
      `--out and --messages-dir work only with --catalogs; --answers writes <dir>/${REPORT_FILE}.`,
    )
  }
  return options
}

function resolvePaths(options) {
  const mobileDir = path.resolve(options.mobileDir ?? path.join(HERE, "../.."))
  const webDir = path.resolve(options.webDir ?? path.join(mobileDir, "../web"))
  return {
    policy: path.join(mobileDir, "i18n/translation-policy.json"),
    messagesDir: path.resolve(
      options.messagesDir ?? path.join(mobileDir, "messages"),
    ),
    webMessagesDir: path.join(webDir, "messages"),
  }
}

function localeList(options) {
  return options.locales
    ? options.locales
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : null
}

function readAnswerInputs(dir, only) {
  let index
  try {
    index = local.readIndex(dir)
  } catch (error) {
    throw new CommandError(error.message)
  }
  const inputs = {}
  const skipped = {}
  for (const locale of Object.keys(index.locales).sort(ops.codePointCompare)) {
    if (only && !only.includes(locale)) continue
    if (!fs.existsSync(local.answerFile(dir, locale))) {
      skipped[locale] = "no answer file"
      continue
    }
    try {
      const { english } = local.readExportedRequest(dir, locale)
      inputs[locale] = { english, translations: local.readAnswer(dir, locale) }
    } catch (error) {
      skipped[locale] = error.message
    }
  }
  return { inputs, skipped }
}

function readCatalogInputs(paths, only) {
  const policy = checks.readPolicy(paths.policy)
  const neutral = new Set(policy.intentionallyLocaleNeutral)
  const englishOnly = new Set(policy.englishOnlyLocales)
  const { source, catalogs } = checks.readCatalogDir(paths.messagesDir)
  const english = Object.fromEntries(
    Object.entries(source).filter(([key]) => !neutral.has(key)),
  )
  const inputs = {}
  const skipped = {}
  for (const [locale, catalog] of Object.entries(catalogs)) {
    if (only && !only.includes(locale)) continue
    if (englishOnly.has(locale)) {
      skipped[locale] = "English-only locale"
      continue
    }
    // A value equal to English is a pending key's fallback, not a translation.
    const translations = Object.fromEntries(
      Object.entries(catalog).filter(([key, value]) => value !== source[key]),
    )
    inputs[locale] = { english, translations }
  }
  return { inputs, skipped }
}

function readWeb(paths) {
  // Web compared with itself proves nothing.
  if (path.resolve(paths.messagesDir) === path.resolve(paths.webMessagesDir)) {
    return null
  }
  try {
    return {
      dir: paths.webMessagesDir,
      english: ops.flattenCatalog(
        checks.readJson(path.join(paths.webMessagesDir, "en.json")),
      ),
    }
  } catch {
    return null
  }
}

function webFor(web, locale) {
  const file = web && path.join(web.dir, `${locale}.json`)
  if (!file || !fs.existsSync(file)) return null
  return {
    english: web.english,
    catalog: ops.flattenCatalog(checks.readJson(file)),
  }
}

function shippedTags(paths) {
  for (const dir of [paths.webMessagesDir, paths.messagesDir]) {
    if (fs.existsSync(dir)) return checks.catalogTagsIn(dir)
  }
  return []
}

function runLanguageId(request) {
  const version = spawnSync("uv", ["--version"], { encoding: "utf8" })
  if (version.error) {
    return {
      status: "skipped",
      reason:
        "uv is not installed. Install it from https://docs.astral.sh/uv/, or pass --no-language-id.",
    }
  }
  console.log(
    "Language ID: running GlotLID through uv. The first run downloads the 1.7 GB model into the Hugging Face cache.",
  )
  // A file, not stdin: a first run once waited forever on a 6 MB stdin.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-ui-eval-"))
  let run
  try {
    const requestFile = path.join(scratch, "request.json")
    fs.writeFileSync(requestFile, JSON.stringify(request))
    run = spawnSync("uv", ["run", "--quiet", LANGUAGE_ID_SCRIPT, requestFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      timeout: LANGUAGE_ID_TIMEOUT_MS,
    })
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  if (run.error || run.status !== 0) {
    const stderr = (run.stderr ?? "")
      .split("\n")
      .filter((line) => line.trim() && !line.includes("unauthenticated"))
      .slice(-3)
      .join(" ")
    return {
      status: "failed",
      reason: (run.error?.message ?? stderr) || `exit ${run.status}`,
    }
  }
  try {
    const answer = JSON.parse(run.stdout)
    return { status: "ran", model: answer.model, locales: answer.locales }
  } catch (error) {
    return {
      status: "failed",
      reason: `language-id.py wrote no JSON: ${error.message}`,
    }
  }
}

function describeLanguage(answer) {
  if (!answer) return "-"
  const top = answer.top?.[0]
  const label = top ? ` ${top.label} ${top.probability}` : ""
  return `${answer.verdict}${label}`
}

function describeAgreement(agreement) {
  if (!agreement || agreement.compared === 0) return "-"
  return `${Math.round(agreement.rate * 100)}% of ${agreement.compared}`
}

function printSummary(report, reportFile) {
  const { summary, languageId, locales, skipped } = report
  const lines = [
    `Checked ${summary.locales} locale(s): ${summary.error} error(s), ${summary.warning} warning(s), ${summary.info} info.`,
  ]
  if (languageId.status === "ran") {
    lines.push(`Language ID: ran with ${languageId.model}.`)
  } else if (languageId.status === "off") {
    lines.push("Language ID: off (--no-language-id).")
  } else {
    lines.push(`Language ID: ${languageId.status}. ${languageId.reason}`)
  }
  const rows = Object.entries(locales).map(([locale, result]) => {
    const count = (severity) =>
      result.findings.filter((item) => item.severity === severity).length
    return [
      locale,
      String(count("error")),
      String(count("warning")),
      String(count("info")),
      describeLanguage(result.languageId),
      describeAgreement(result.webAgreement),
    ]
  })
  const header = ["Locale", "Errors", "Warnings", "Info", "Language", "Web"]
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  )
  for (const row of [header, ...rows]) {
    lines.push(
      row.map((cell, column) => cell.padEnd(widths[column])).join("  "),
    )
  }
  const problems = []
  for (const [locale, result] of Object.entries(locales)) {
    const serious = result.findings.filter((item) => item.severity !== "info")
    for (const item of serious.slice(0, TERMINAL_FINDINGS_PER_LOCALE)) {
      const where = item.key ? `${item.key}: ` : ""
      problems.push(
        `  ${locale}  ${item.severity}  ${item.rule}  ${where}${item.detail}`,
      )
    }
    if (serious.length > TERMINAL_FINDINGS_PER_LOCALE) {
      problems.push(
        `  ${locale}  and ${serious.length - TERMINAL_FINDINGS_PER_LOCALE} more in the report`,
      )
    }
  }
  if (problems.length) {
    lines.push(
      `Errors and warnings (at most ${TERMINAL_FINDINGS_PER_LOCALE} for each locale):`,
      ...problems,
    )
  }
  const skippedLines = Object.entries(skipped).map(
    ([locale, reason]) => `  ${locale}: ${reason}`,
  )
  if (skippedLines.length) lines.push("Not checked:", ...skippedLines)
  lines.push(
    reportFile
      ? `Full report: ${reportFile}`
      : "Pass --out <file> for the full report.",
  )
  console.log(lines.join("\n"))
}

function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const paths = resolvePaths(options)
  const only = localeList(options)
  const { inputs, skipped } = options.answers
    ? readAnswerInputs(path.resolve(options.answers), only)
    : readCatalogInputs(paths, only)
  for (const locale of only ?? []) {
    if (!inputs[locale] && !skipped[locale]) skipped[locale] = "not found"
  }

  const web = readWeb(paths)
  const locales = {}
  const entriesByLocale = {}
  for (const [locale, input] of Object.entries(inputs)) {
    const { entries, result } = evaluation.evaluateLocale({
      locale,
      ...input,
      web: webFor(web, locale),
    })
    const missing = Object.keys(input.english).length - result.keys
    locales[locale] = missing ? { ...result, missing } : result
    entriesByLocale[locale] = entries
  }

  let languageId = { status: "off" }
  if (!options.noLanguageId && Object.keys(entriesByLocale).length) {
    languageId = runLanguageId(
      evaluation.languageIdRequest(entriesByLocale, shippedTags(paths)),
    )
  }
  if (languageId.status === "ran") {
    for (const [locale, answer] of Object.entries(languageId.locales)) {
      if (!locales[locale]) continue
      const values = Object.fromEntries(
        entriesByLocale[locale].map((entry) => [entry.key, entry.value]),
      )
      evaluation.addLanguageId(locales[locale], answer, values)
    }
  }

  const report = {
    evaluatedOn: new Date().toISOString().slice(0, 10),
    source: options.answers
      ? { answers: path.resolve(options.answers) }
      : { catalogs: paths.messagesDir },
    languageId: {
      status: languageId.status,
      ...(languageId.model ? { model: languageId.model } : {}),
      ...(languageId.reason ? { reason: languageId.reason } : {}),
    },
    summary: evaluation.summarize(locales),
    skipped,
    locales,
  }
  const reportFile = options.answers
    ? path.join(path.resolve(options.answers), REPORT_FILE)
    : options.out && path.resolve(options.out)
  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true })
    fs.writeFileSync(reportFile, ops.renderJson(report))
  }
  printSummary(report, reportFile)
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(
    error instanceof CommandError
      ? error.message
      : error instanceof Error
        ? error.stack
        : String(error),
  )
  process.exitCode = 2
}
