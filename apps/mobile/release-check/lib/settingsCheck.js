"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The owner-only `check-settings` mode (KTD3, R33). It compares the
// "copied from production" class with production's EAS environment and
// writes no file: the owner changes the list through a commit (KTD16).

const path = require("node:path")

const { EXIT } = require("./contract")
const { CONFIG_DIR, MOBILE_DIR, classifyEnvKeys, readJson } = require("./lists")

const SETTINGS_FILE = "apps/mobile/release-check/config/test-settings.json"
const EAS_COMMAND = "npx"
const EAS_ARGS = Object.freeze([
  "--yes",
  "eas-cli@16",
  "env:list",
  "--environment",
  "production",
  "--format",
  "long",
  "--non-interactive",
])
// The first call downloads eas-cli into the npx cache (about 30 s).
const DEFAULT_TIMEOUT_MS = 180_000
const LOGIN_COMMAND = "npx eas-cli login"

// The text that eas-cli 16 prints in `env:list --format long`.
const LIST_HEADERS = [
  "Variables for this project:",
  "Account-wide variables for this account:",
]
const NO_VARIABLES = "No variables found for this environment."
const SEPARATOR = "———"
const MASKED_VALUE = /^\*{5}(?: \(.*\))?$/
const NOT_LOGGED_IN =
  /An Expo user account is required to proceed|Either log in with eas login/
const NAME_LINE = /^Name( +)([A-Za-z_][A-Za-z0-9_]*)$/
const PUBLIC_KEY = /^EXPO_PUBLIC_/

class SettingsCheckRefusal extends Error {}

class EnvListFormatError extends Error {}

function isPlainObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

/** The child env: the parent's PATH and HOME, and EXPO_TOKEN when it is set. */
function easEnv(parentEnv) {
  const env = {
    PATH: parentEnv.PATH ?? "/usr/bin:/bin",
    HOME: parentEnv.HOME ?? "",
  }
  if (parentEnv.EXPO_TOKEN) env.EXPO_TOKEN = parentEnv.EXPO_TOKEN
  return env
}

function fieldOf(lines, label, column) {
  const line = lines.find((entry) => entry.startsWith(`${label} `))
  return line === undefined ? null : line.slice(column).trim()
}

function parseBlock(lines) {
  const nameMatch = lines.map((line) => line.match(NAME_LINE)).find(Boolean)
  const valueAt = lines.findIndex((line) => line.startsWith("Value "))
  const scopeAt = lines.findIndex((line) => line.startsWith("Scope "))
  if (!nameMatch || valueAt < 0 || scopeAt <= valueAt) {
    throw new EnvListFormatError("a variable has no Name, Value, or Scope line")
  }
  // Each label is padded to one column, so the value keeps its own spaces.
  const column = "Name".length + nameMatch[1].length
  const value = [
    lines[valueAt].slice(column),
    ...lines.slice(valueAt + 1, scopeAt),
  ].join("\n")
  const masked = MASKED_VALUE.test(value)
  return {
    name: nameMatch[2],
    value: masked ? null : value,
    masked,
    visibility: fieldOf(lines, "Visibility", column),
    scope: fieldOf(lines, "Scope", column),
  }
}

// An unknown shape throws, because a misread would report a false match.
function parseEnvList(stdout) {
  const lines = stdout.split(/\r?\n/)
  if (!lines.some((line) => line.trim() === "Environment: production")) {
    throw new EnvListFormatError("it names no production environment")
  }
  if (lines.some((line) => line.trim() === NO_VARIABLES)) return []
  const start = lines.findIndex((line) => LIST_HEADERS.includes(line.trim()))
  if (start < 0) throw new EnvListFormatError("it has no variable list")
  const blocks = [[]]
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === SEPARATOR) blocks.push([])
    else blocks[blocks.length - 1].push(line)
  }
  return blocks.map(parseBlock)
}

function lastLines(text, count) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
}

// Values print only after a list header, so a failure with one shows no tail.
function failureDetail(result) {
  if (LIST_HEADERS.some((header) => result.stdout.includes(header))) return ""
  const lines = [
    ...(result.error ? [result.error] : []),
    ...lastLines(result.stdout, 5),
    ...lastLines(result.stderr, 1),
  ]
  return lines.length > 0 ? `:\n  ${lines.join("\n  ")}` : ""
}

async function readScope({ run, mobileDir, env, timeoutMs }, scope) {
  const args =
    scope === "project" ? [...EAS_ARGS] : [...EAS_ARGS, "--scope", scope]
  const label = `${EAS_COMMAND} ${args.join(" ")}`
  const result = await run(EAS_COMMAND, args, {
    cwd: mobileDir,
    env,
    timeoutMs,
  })
  if (result.timedOut) {
    throw new SettingsCheckRefusal(
      `\`${label}\` did not finish in ${timeoutMs / 1000} s`,
    )
  }
  if (NOT_LOGGED_IN.test(`${result.stdout}\n${result.stderr}`)) {
    throw new SettingsCheckRefusal(
      `no Expo account is logged in. Run \`${LOGIN_COMMAND}\`, then run check-settings again`,
    )
  }
  if (result.code !== 0) {
    throw new SettingsCheckRefusal(
      `\`${label}\` failed with exit code ${result.code}${failureDetail(result)}`,
    )
  }
  try {
    return parseEnvList(result.stdout)
  } catch (error) {
    if (!(error instanceof EnvListFormatError)) throw error
    throw new SettingsCheckRefusal(
      `cannot read the output of \`${label}\`, because ${error.message}`,
    )
  }
}

// EAS builds also get account-wide variables; a project variable of the same
// name wins.
async function readProductionEnv(options) {
  const env = easEnv(options.parentEnv)
  const project = await readScope({ ...options, env }, "project")
  const account = await readScope({ ...options, env }, "account")
  const production = new Map()
  for (const variable of [...account, ...project]) {
    production.set(variable.name, {
      value: variable.value,
      masked: variable.masked,
    })
  }
  return production
}

function listProblem(settings) {
  const copied = settings?.copiedFromProduction
  if (!isPlainObject(copied)) {
    return "copiedFromProduction must map each key to a value or null"
  }
  const wrong = Object.keys(copied).find(
    (key) => copied[key] !== null && typeof copied[key] !== "string",
  )
  if (wrong) return `copiedFromProduction.${wrong} must be a string or null`
  if (!Array.isArray(settings.mustBeUnset)) return "mustBeUnset must list keys"
  const [repeated] = classifyEnvKeys([], settings).repeated
  if (repeated) {
    return `${repeated.key} is in ${repeated.classes.join(" and ")}; keep one class`
  }
  return null
}

function finding(code, message, setting) {
  return { code, message, setting, file: SETTINGS_FILE, deviceId: null }
}

function show(value) {
  return value === null ? "unset" : JSON.stringify(value)
}

// Only copiedFromProduction values enter the result: other keys can be secret
// or analytics keys, so each one is a name and a flag.
function compareWithProduction(settings, production) {
  const findings = []
  const copied = Object.entries(settings.copiedFromProduction).map(
    ([key, listValue]) => {
      const found = production.get(key) ?? null
      const row = {
        key,
        listValue,
        set: found !== null,
        masked: found?.masked === true,
        productionValue: found && !found.masked ? found.value : null,
      }
      if (row.masked) {
        findings.push(
          finding(
            "PRODUCTION_VALUE_UNKNOWN",
            `Production sets ${key}, but eas-cli masks its value, so the check cannot compare it with the list.`,
            key,
          ),
        )
      } else if (row.productionValue !== listValue) {
        findings.push(
          finding(
            "PRODUCTION_VALUE_DIFFERS",
            `${key} is ${show(row.productionValue)} in production and ${show(listValue)} in the list.`,
            key,
          ),
        )
      }
      return row
    },
  )
  const publicKeys = [...production.keys()]
    .filter((key) => PUBLIC_KEY.test(key))
    .sort()
  for (const key of classifyEnvKeys(publicKeys, settings).unclassified) {
    findings.push(
      finding(
        "PRODUCTION_KEY_UNCLASSIFIED",
        `Production sets ${key}, and test-settings.json does not classify it; put it in one class.`,
        key,
      ),
    )
  }
  const mustBeUnset = settings.mustBeUnset.map((key) => ({
    key,
    productionSets: production.has(key),
  }))
  // A masked value keeps the list's value: the check cannot know a better one.
  const paste = Object.fromEntries(
    copied.map((row) => [
      row.key,
      row.masked ? row.listValue : row.productionValue,
    ]),
  )
  return { findings, copied, mustBeUnset, paste }
}

function copiedLine(row) {
  if (row.masked) {
    return `- ${row.key}: production sets it, value unknown (masked); the list has ${show(row.listValue)}`
  }
  const state =
    row.productionValue === row.listValue
      ? `matches (${show(row.listValue)})`
      : `differs: production ${show(row.productionValue)}, list ${show(row.listValue)}`
  return `- ${row.key}: ${state}`
}

function reportLines(result, today) {
  const lines = [
    `check-settings compared ${SETTINGS_FILE} with production's EAS environment (project and account variables).`,
    "",
    "Copied from production:",
    ...result.copied.map(copiedLine),
    "",
    "Must be unset in the test build (values are not shown):",
    ...result.mustBeUnset.map(
      (row) =>
        `- ${row.key}: ${row.productionSets ? "production sets it" : "production does not set it"}`,
    ),
    "",
  ]
  if (result.findings.length === 0) {
    lines.push("check-settings passed: every copied value matches production.")
  } else {
    lines.push(
      `check-settings failed with ${result.findings.length} finding(s):`,
    )
    for (const item of result.findings) {
      lines.push(`- ${item.code}: ${item.message}`)
    }
  }
  lines.push(
    "",
    `Paste this object as "copiedFromProduction" in ${SETTINGS_FILE}:`,
    JSON.stringify(result.paste, null, 2),
  )
  for (const row of result.copied.filter((entry) => entry.masked)) {
    lines.push(
      `${row.key} keeps the list's value, because production masks it; read it in the EAS dashboard.`,
    )
  }
  lines.push(
    `When you commit the list, set "productionCheckedAt" to "${today}" (today, UTC). check-settings writes no file.`,
  )
  return lines
}

async function checkSettingsCommand(command, deps = {}) {
  const out = deps.out ?? console.log
  const err = deps.err ?? console.error
  const run = deps.run ?? require("./proc").run
  const now = deps.now ?? (() => new Date())
  let settings = deps.settings
  try {
    settings ??= readJson(path.join(CONFIG_DIR, "test-settings.json"))
  } catch (error) {
    err(
      `release-check refused: cannot read ${SETTINGS_FILE}: ${error.message}.`,
    )
    return EXIT.refused
  }
  const problem = listProblem(settings)
  if (problem) {
    err(
      `release-check refused: ${SETTINGS_FILE} is not valid (${problem}). Run check-lists.`,
    )
    return EXIT.refused
  }
  let production
  try {
    production = await readProductionEnv({
      run,
      mobileDir: deps.mobileDir ?? MOBILE_DIR,
      parentEnv: deps.env ?? process.env,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  } catch (error) {
    if (!(error instanceof SettingsCheckRefusal)) throw error
    err(`release-check refused: ${error.message}.`)
    return EXIT.refused
  }
  const result = compareWithProduction(settings, production)
  const today = now().toISOString().slice(0, 10)
  for (const line of reportLines(result, today)) out(line)
  return result.findings.length === 0 ? EXIT.passed : EXIT.failed
}

module.exports = {
  EAS_ARGS,
  EAS_COMMAND,
  EnvListFormatError,
  SettingsCheckRefusal,
  checkSettingsCommand,
  compareWithProduction,
  easEnv,
  parseEnvList,
  readProductionEnv,
}
