#!/usr/bin/env node
// Brings every mobile UI catalog up to date with messages/en.json (KTD6), with
// web's script and mobile's own policy, contexts, and models (R19, R20). Not a
// package.json script: a new script entry moves the Expo fingerprint.

import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import readline from "node:readline/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const ops = require("./lib/catalogOps.js")
const checks = require("./lib/catalogChecks.js")
const { formatWithPrettier, list, plural } = require("./lib/scriptFormat.js")

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, "../..")
const REPO = path.resolve(MOBILE, "../..")
const DEFAULT_ATTEMPTS = 4
const DEFAULT_CONCURRENCY = 4
const OPENAI_BASE_URL = "https://api.openai.com/v1"
// Every flag the command passes. The script ignores an unknown flag, so a
// missing option would silently fall back to web's own files (R19, R20).
const WEB_FLAGS = [
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

const USAGE = `Usage: node scripts/i18n/translate-catalogs.mjs [mode] [options]

Every mode first removes the keys that en.json no longer has, and copies
English into the English-only catalogs.

Modes (choose one; the default is a full run):
  (none)                 Seed, prune, clear changed keys, then translate with
                         web's script. Prints the request estimate and asks
                         before it sends any request. Costs money.
  --dry-run [--json]     Print the plan and the estimate. Writes nothing.
  --prune-only           Remove deleted keys only. No network.
  --restamp              Record the English hash of each key that no locale
                         holds an old translation of. No network.
  --mark-pending <keys>  Put comma-separated keys on the pending list; a
                         changed key takes its new English in every locale.
                         No network.

Options:
  --locales <tags>       Seed and translate only these catalogs.
  --yes                  Skip the confirmation prompt (non-interactive use,
                         only after the owner approves the budget).
  --max-attempts <n>     Attempts per locale (default ${DEFAULT_ATTEMPTS}).
  --concurrency <n>      Locales in flight (default ${DEFAULT_CONCURRENCY}).
  --mobile-dir, --web-dir, --inventory, --progress-dir <path>
                         Path overrides for tests.`

const FLAG_OPTIONS = {
  "--dry-run": "dryRun",
  "--prune-only": "pruneOnly",
  "--restamp": "restamp",
  "--yes": "yes",
  "--json": "json",
  "--help": "help",
}
const VALUE_OPTIONS = {
  "--mark-pending": "markPending",
  "--locales": "locales",
  "--max-attempts": "maxAttempts",
  "--concurrency": "concurrency",
  "--mobile-dir": "mobileDir",
  "--web-dir": "webDir",
  "--inventory": "inventory",
  "--progress-dir": "progressDir",
}

class CommandError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message)
    this.name = "CommandError"
    this.code = code
    this.exitCode = exitCode
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
        throw new CommandError(
          "MISSING_ARGUMENT_VALUE",
          `${name} needs a value`,
        )
      }
      options[VALUE_OPTIONS[name]] = value
    } else {
      throw new CommandError(
        "UNKNOWN_ARGUMENT",
        `Unknown argument: ${argv[index]}\n\n${USAGE}`,
      )
    }
  }
  const modes = ["dryRun", "pruneOnly", "restamp", "markPending"].filter(
    (mode) => options[mode] !== undefined,
  )
  if (modes.length > 1) {
    throw new CommandError(
      "TOO_MANY_MODES",
      "Choose one mode: --dry-run, --prune-only, --restamp, or --mark-pending",
    )
  }
  if (options.json && !options.dryRun) {
    throw new CommandError(
      "JSON_NEEDS_DRY_RUN",
      "--json works only with --dry-run",
    )
  }
  for (const [option, fallback] of [
    ["maxAttempts", DEFAULT_ATTEMPTS],
    ["concurrency", DEFAULT_CONCURRENCY],
  ]) {
    const value =
      options[option] === undefined ? fallback : Number(options[option])
    if (!Number.isInteger(value) || value < 1) {
      throw new CommandError(
        "INVALID_POSITIVE_INTEGER",
        `--${option === "maxAttempts" ? "max-attempts" : "concurrency"} must be a positive integer`,
      )
    }
    options[option] = value
  }
  return options
}

function resolvePaths(options) {
  const mobileDir = path.resolve(options.mobileDir ?? MOBILE)
  const webDir = path.resolve(options.webDir ?? path.join(REPO, "apps/web"))
  const i18n = (name) => path.join(mobileDir, "i18n", name)
  return {
    messagesDir: path.join(mobileDir, "messages"),
    policy: i18n("translation-policy.json"),
    contexts: i18n("translation-contexts.json"),
    manifest: i18n("script-manifest.json"),
    provenance: i18n("translation-provenance.json"),
    modelTable: i18n("model-table.json"),
    record: i18n("source-record.json"),
    webScript: path.join(webDir, "scripts/translate-ui-catalogs.mjs"),
    webTranslator: path.join(webDir, "scripts/openai-catalog-translator.mjs"),
    webMessagesDir: path.join(webDir, "messages"),
    inventory: path.resolve(
      options.inventory ??
        path.join(REPO, "docs/i18n/watch-ui-official-language-inventory.json"),
    ),
    progressDir: path.resolve(options.progressDir ?? os.tmpdir()),
  }
}

function readJsonFile(file, label) {
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch (error) {
    throw new CommandError(
      "MISSING_FILE",
      `Cannot read ${label} at ${file}: ${error.message}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new CommandError(
      "INVALID_JSON",
      `${label} at ${file} is not valid JSON: ${error.message}`,
    )
  }
}

function withCode(error, code) {
  if (error instanceof ops.CatalogOpsError)
    return new CommandError(error.code, `${error.code}: ${error.message}`)
  if (error instanceof CommandError) return error
  return new CommandError(code, error.message)
}

function loadState(paths) {
  try {
    const { source, catalogs } = checks.readCatalogDir(paths.messagesDir)
    return {
      source,
      catalogs,
      policy: ops.normalizePolicy(
        readJsonFile(paths.policy, "the translation policy"),
        paths.policy,
      ),
      record: ops.normalizeRecord(
        readJsonFile(paths.record, "the source record"),
        paths.record,
      ),
    }
  } catch (error) {
    throw withCode(error, "INVALID_STATE")
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// The repo's `format` job runs prettier on every tracked JSON file.
async function formatJson(file, value) {
  return formatWithPrettier(ops.renderJson(value), {
    repoDir: REPO,
    configFile: file,
    options: { filepath: file },
    optional: true,
  })
}

function writeIfChanged(file, text) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
  if (current === text) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, text)
  fs.renameSync(temporary, file)
  return true
}

function catalogText(state, flat) {
  return ops.renderJson(
    ops.unflattenCatalog(ops.orderLikeSource(flat, state.source)),
  )
}

async function writeState(paths, state, contexts) {
  const written = []
  for (const [locale, flat] of Object.entries(state.catalogs)) {
    const file = path.join(paths.messagesDir, `${locale}.json`)
    if (writeIfChanged(file, catalogText(state, flat)))
      written.push(path.relative(REPO, file))
  }
  const files = [
    [paths.policy, state.policy],
    [paths.record, state.record],
    ...(contexts ? [[paths.contexts, contexts]] : []),
  ]
  for (const [file, value] of files) {
    if (writeIfChanged(file, await formatJson(file, value)))
      written.push(path.relative(REPO, file))
  }
  return written
}

function loadContexts(paths) {
  return readJsonFile(paths.contexts, "the translation contexts")
}

// A context override for a deleted key makes web's script stop (UNKNOWN_CONTEXT_KEY).
function pruneContextOverrides(contexts, source) {
  const keys = contexts?.keys
  if (!keys || typeof keys !== "object") return []
  const gone = Object.keys(keys).filter((key) => !Object.hasOwn(source, key))
  for (const key of gone) delete keys[key]
  return gone
}

function localSteps(state, contexts) {
  const pruned = ops.pruneDeletedKeys(state)
  pruned.contextOverrides = pruneContextOverrides(contexts, state.source)
  const englishOnlySynced = ops.syncEnglishOnly(state)
  return { pruned, englishOnlySynced }
}

function printLocalChanges(changes) {
  const lines = []
  if (changes.seeded?.length)
    lines.push(`New empty catalogs: ${list(changes.seeded)}`)
  const prunedLocales = Object.keys(changes.pruned.catalogs)
  const prunedKeys = [
    ...new Set([
      ...Object.values(changes.pruned.catalogs).flat(),
      ...changes.pruned.record,
      ...changes.pruned.pending,
      ...changes.pruned.contextOverrides,
    ]),
  ]
  if (prunedKeys.length) {
    lines.push(
      `Removed deleted keys: ${list(prunedKeys)} (from ${plural(prunedLocales.length, "catalog")})`,
    )
  }
  if (changes.englishOnlySynced.length) {
    lines.push(`English copied into: ${list(changes.englishOnlySynced)}`)
  }
  if (changes.invalidated?.changed.length) {
    lines.push(
      `Cleared changed keys: ${list(changes.invalidated.changed)} (in ${plural(Object.keys(changes.invalidated.deleted).length, "catalog")})`,
    )
  }
  if (changes.invalidated?.unrecorded.length) {
    lines.push(`Recorded new keys: ${list(changes.invalidated.unrecorded)}`)
  }
  if (lines.length)
    console.log(
      ["Local changes:", ...lines.map((line) => `  ${line}`)].join("\n"),
    )
}

function readWebTags(paths) {
  try {
    return checks.catalogTagsIn(paths.webMessagesDir)
  } catch (error) {
    throw new CommandError(
      "MISSING_WEB_CATALOGS",
      `Cannot list web's catalogs in ${paths.webMessagesDir}: ${error.message}`,
    )
  }
}

function loadModelTable(paths, webTags, policy) {
  const table = readJsonFile(paths.modelTable, "the model table")
  const problems = checks.modelTableProblems(
    table,
    webTags,
    policy.englishOnlyLocales,
  )
  if (problems.length) {
    throw new CommandError(
      "INVALID_MODEL_TABLE",
      `${paths.modelTable}:\n  ${problems.join("\n  ")}`,
    )
  }
  return (locale) => table.locales[locale] ?? table.defaultModel
}

function selectedLocales(options, targets) {
  if (!options.locales) return targets
  const requested = [
    ...new Set(
      options.locales
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ]
  const known = new Set(targets)
  const unknown = requested.filter((tag) => !known.has(tag))
  if (requested.length === 0 || unknown.length) {
    throw new CommandError(
      "UNKNOWN_LOCALE",
      `--locales must name translated web catalogs; not one: ${list(unknown.length ? unknown : ["(none)"])}. English and the English-only locales never go to the script.`,
    )
  }
  return requested
}

function missingWebFlags(paths) {
  let text
  try {
    text = fs.readFileSync(paths.webScript, "utf8")
  } catch (error) {
    throw new CommandError(
      "MISSING_WEB_SCRIPT",
      `Cannot read web's script at ${paths.webScript}: ${error.message}`,
    )
  }
  return WEB_FLAGS.filter(
    (flag) => !new RegExp(`(["'\`])${flag}\\1`).test(text),
  )
}

function hasApiKey(env) {
  if (env.OPENAI_API_KEY || env.API_OPENAI) return true
  const baseUrl = env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "")
  return Boolean(
    baseUrl &&
    baseUrl !== OPENAI_BASE_URL &&
    (env.API_OPENROUTER || env.OPENROUTER_API_KEY),
  )
}

async function buildPlan(options, paths) {
  const webTags = readWebTags(paths)
  const state = loadState(paths)
  const contexts = loadContexts(paths)
  const modelFor = loadModelTable(paths, webTags, state.policy)
  const englishOnly = new Set(state.policy.englishOnlyLocales)
  const targets = webTags.filter(
    (tag) => tag !== ops.SOURCE_LOCALE && !englishOnly.has(tag),
  )
  const locales = selectedLocales(options, targets)

  const seeded = ops.seedCatalogs(state, locales)
  if (!options.locales) {
    seeded.push(
      ...ops.seedCatalogs(
        state,
        webTags.filter((tag) => englishOnly.has(tag)),
      ),
    )
  }
  const { pruned, englishOnlySynced } = localSteps(state, contexts)
  const contextProblems = checks.contextProblems(contexts, state.source)
  if (contextProblems.length) {
    throw new CommandError(
      "INVALID_CATALOG_CONTEXTS",
      `${paths.contexts}:\n  ${contextProblems.join("\n  ")}`,
    )
  }
  const wordless = checks.wordlessKeysNotNeutral(
    state.source,
    state.policy.intentionallyLocaleNeutral,
  )
  if (wordless.length) {
    throw new CommandError(
      "WORDLESS_KEY_NOT_NEUTRAL",
      `These messages have no words, so web's copy check fails each translation. ` +
        `Add them to intentionallyLocaleNeutral in ${paths.policy}:\n  ${wordless.join("\n  ")}`,
    )
  }
  const invalidated = ops.invalidateChangedKeys(state)
  const { messageContractError } = await import(
    pathToFileURL(paths.webTranslator).href
  )
  const { groups, upToDate } = ops.planRun(state, {
    locales,
    modelFor,
    messageContractError,
  })
  for (const group of groups) {
    group.progress = path.join(
      paths.progressDir,
      ops.progressFileName({
        messagesDir: paths.messagesDir,
        sourceFlat: state.source,
        policy: state.policy,
        model: group.model,
      }),
    )
  }
  return {
    state,
    contexts,
    seeded,
    pruned,
    englishOnlySynced,
    invalidated,
    groups,
    upToDate,
    messageContractError,
  }
}

function estimate(plan, options) {
  const requests = plan.groups.reduce(
    (sum, g) => sum + Object.keys(g.keysByLocale).length,
    0,
  )
  const characters = plan.groups.reduce(
    (sum, g) =>
      sum +
      Object.values(g.keysByLocale)
        .flat()
        .reduce((total, key) => total + plan.state.source[key].length, 0),
    0,
  )
  return { requests, characters, maxRequests: requests * options.maxAttempts }
}

function printPlan(plan, options) {
  printLocalChanges(plan)
  const { requests, characters, maxRequests } = estimate(plan, options)
  const lines = ["Translation plan (no request is sent yet):"]
  for (const group of plan.groups) {
    const locales = Object.keys(group.keysByLocale)
    const keys = Object.values(group.keysByLocale).flat().length
    lines.push(
      `  ${group.model}: ${plural(locales.length, "locale")}, ${plural(keys, "key")}, ${plural(locales.length, "request")}`,
    )
    lines.push(`    locales: ${list(locales, 20)}`)
    lines.push(`    progress: ${group.progress}`)
  }
  lines.push(
    `  Total: ${plural(requests, "request")} with about ${characters.toLocaleString("en")} English characters; at most ${maxRequests} requests if every attempt fails (--max-attempts ${options.maxAttempts}).`,
  )
  console.log(lines.join("\n"))
}

async function confirm(options, requests) {
  if (options.yes) return true
  if (!process.stdin.isTTY) {
    throw new CommandError(
      "CONFIRMATION_REQUIRED",
      "No request was sent and no file changed: stdin is not a terminal, so the command cannot ask. Run it in a terminal, or pass --yes after the owner approves the budget.",
      1,
    )
  }
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const answer = await prompt.question(
    `Send ${plural(requests, "request")} to the translation API? Type "yes" to continue: `,
  )
  prompt.close()
  return /^y(es)?$/i.test(answer.trim())
}

function runWebScript(paths, group, options) {
  const args = [
    "--messages-dir",
    paths.messagesDir,
    "--inventory",
    paths.inventory,
    "--manifest",
    paths.manifest,
    "--progress",
    group.progress,
    "--policy",
    paths.policy,
    "--contexts",
    paths.contexts,
    "--stop-on-quota",
    "--locales",
    Object.keys(group.keysByLocale).join(","),
    "--model",
    group.model,
    "--concurrency",
    String(options.concurrency),
    "--max-attempts",
    String(options.maxAttempts),
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [paths.webScript, ...args], {
      cwd: REPO,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const failures = new Map()
    const forward = (stream, sink) => {
      let buffer = ""
      stream.setEncoding("utf8")
      stream.on("data", (chunk) => {
        buffer += chunk
        const lines = buffer.split("\n")
        buffer = lines.pop()
        for (const line of lines) handle(line, sink)
      })
      stream.on("end", () => buffer && handle(buffer, sink))
    }
    const handle = (line, sink) => {
      sink.write(`[web] ${line}\n`)
      try {
        const event = JSON.parse(line)
        if (event?.event === "locale_failed")
          failures.set(event.locale, String(event.message))
      } catch {
        // Only JSON event lines carry a status.
      }
    }
    forward(child.stdout, process.stdout)
    forward(child.stderr, process.stderr)
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, failures }))
  })
}

// A locale counts as finished only when its catalog on disk is complete.
function localeStatus(paths, plan, locale, failures) {
  const flat = ops.flattenCatalog(
    readJsonFile(
      path.join(paths.messagesDir, `${locale}.json`),
      `${locale}.json`,
    ),
  )
  plan.state.catalogs[locale] = flat
  const neutral = new Set(plan.state.policy.intentionallyLocaleNeutral)
  const complete = Object.keys(plan.state.source).every((key) =>
    ops.isKeyComplete({
      key,
      sourceFlat: plan.state.source,
      catalogFlat: flat,
      neutral,
      messageContractError: plan.messageContractError,
    }),
  )
  if (complete) return { status: "finished" }
  if (failures.has(locale))
    return { status: "failed", message: failures.get(locale) }
  return { status: "notStarted" }
}

function printSummary(results, pendingLeft) {
  const byStatus = (status) => results.filter((r) => r.status === status)
  const finished = byStatus("finished")
  const failed = byStatus("failed")
  const notStarted = byStatus("notStarted")
  const lines = [
    `Finished ${plural(finished.length, "locale")}: ${
      list(
        finished.map((r) => r.locale),
        40,
      ) || "none"
    }`,
  ]
  if (failed.length) {
    lines.push(`Failed ${plural(failed.length, "locale")}:`)
    for (const r of failed)
      lines.push(`  ${r.locale}: ${r.message.slice(0, 300)}`)
  }
  if (notStarted.length) {
    lines.push(
      `Not started ${plural(notStarted.length, "locale")}: ${list(
        notStarted.map((r) => r.locale),
        40,
      )}`,
    )
  }
  if (failed.some((r) => r.message.includes("insufficient_quota"))) {
    lines.push(
      "The OpenAI quota is used up, so the run stopped at the first quota error.",
    )
  }
  if (failed.length || notStarted.length) {
    lines.push(
      "Those locales keep their old catalogs and provenance, so CI names them. Run the command again to finish them.",
    )
  }
  lines.push(`Pending keys left: ${pendingLeft}`)
  console.log(lines.join("\n"))
}

async function updateProvenance(paths, plan, results) {
  const provenance = readJsonFile(
    paths.provenance,
    "the translation provenance",
  )
  const reviewed = new Set(plan.state.policy.humanReviewedLocales)
  const date = today()
  const entries = { ...(provenance.machineTranslatedLocales ?? {}) }
  for (const result of results) {
    if (result.status !== "finished" || reviewed.has(result.locale)) continue
    entries[result.locale] = { model: result.model, generatedOn: date }
  }
  const next = {
    ...provenance,
    machineTranslatedLocales: ops.sortObject(entries),
  }
  writeIfChanged(paths.provenance, await formatJson(paths.provenance, next))
}

async function runFull(options, paths) {
  const plan = await buildPlan(options, paths)
  const { requests } = estimate(plan, options)
  const webFlagsMissing = missingWebFlags(paths)

  if (options.dryRun) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            seeded: plan.seeded,
            pruned: plan.pruned,
            englishOnlySynced: plan.englishOnlySynced,
            invalidated: plan.invalidated,
            groups: plan.groups.map((g) => ({
              model: g.model,
              progress: g.progress,
              locales: g.keysByLocale,
            })),
            upToDate: plan.upToDate,
            ...estimate(plan, options),
            webScriptMissingFlags: webFlagsMissing,
          },
          null,
          2,
        ),
      )
    } else {
      printPlan(plan, options)
      if (webFlagsMissing.length)
        console.log(
          `Web's script lacks ${webFlagsMissing.join(", ")}, so a real run would refuse.`,
        )
      console.log("Dry run: no file changed.")
    }
    return 0
  }

  if (requests === 0) {
    printLocalChanges(plan)
    ops.settlePendingKeys(plan.state, plan.messageContractError)
    await writeState(paths, plan.state, plan.contexts)
    console.log("No locale needs a translation.")
    remindCatalogIndex(plan)
    return 0
  }

  printPlan(plan, options)
  if (webFlagsMissing.length) {
    throw new CommandError(
      "WEB_SCRIPT_LACKS_CALLER_OPTIONS",
      `No file changed. ${path.relative(REPO, paths.webScript)} does not support ${webFlagsMissing.join(", ")}. It ignores an unknown option, so it would translate with web's own policy and contexts. Merge web's caller options first (plan U1, R19).`,
    )
  }
  if (!hasApiKey(process.env)) {
    throw new CommandError(
      "MISSING_OPENAI_API_KEY",
      "No file changed. Set OPENAI_API_KEY (or API_OPENAI) first. An agent asks the owner for a key and a budget before any paid run.",
    )
  }
  if (!(await confirm(options, requests))) {
    console.log("No request was sent and no file changed.")
    return 1
  }

  await writeState(paths, plan.state, plan.contexts)
  const results = []
  let stopped = false
  for (const group of plan.groups) {
    const locales = Object.keys(group.keysByLocale)
    if (stopped) {
      results.push(
        ...locales.map((locale) => ({
          locale,
          model: group.model,
          status: "notStarted",
        })),
      )
      continue
    }
    const { status, failures } = await runWebScript(paths, group, options)
    const groupResults = locales.map((locale) => ({
      locale,
      model: group.model,
      ...localeStatus(paths, plan, locale, failures),
    }))
    results.push(...groupResults)
    // The script stops its queue on a permanent error, such as a used-up quota.
    stopped =
      status !== 0 && groupResults.some((r) => r.status === "notStarted")
  }

  ops.settlePendingKeys(plan.state, plan.messageContractError)
  await writeState(paths, plan.state, plan.contexts)
  await updateProvenance(paths, plan, results)
  results.sort((a, b) => ops.codePointCompare(a.locale, b.locale))
  printSummary(results, Object.keys(plan.state.policy.pendingKeys).length)
  remindCatalogIndex(plan)
  return results.every((r) => r.status === "finished") ? 0 : 1
}

// The app bundles only the catalogs in the generated index (KTD5).
function remindCatalogIndex(plan) {
  if (plan.seeded.length === 0) return
  console.log(
    "New catalog files: run `node scripts/i18n/generate-catalog-index.mjs`, so the app bundles them.",
  )
}

async function runNoNetwork(options, paths) {
  const state = loadState(paths)
  const contexts = loadContexts(paths)
  const changes = localSteps(state, contexts)
  let exitCode = 0
  if (options.markPending) {
    const keys = options.markPending
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
    let marked
    try {
      marked = ops.markPending(state, keys, today())
    } catch (error) {
      throw withCode(error, "MARK_PENDING_FAILED")
    }
    for (const [key, { replaced, filled }] of Object.entries(marked)) {
      console.log(
        `${key} is pending since ${state.policy.pendingKeys[key]}. English written into ${plural(replaced.length + filled.length, "catalog")}.`,
      )
    }
  } else if (options.restamp) {
    const { stamped, refused } = ops.restamp(state)
    if (stamped.length)
      console.log(`Recorded ${plural(stamped.length, "key")}: ${list(stamped)}`)
    for (const { key, locales } of refused) {
      console.error(
        `${key} changed in en.json, but ${list(locales)} still hold a translation of the old English. Run the command without a mode to translate it, or use --mark-pending ${key}.`,
      )
    }
    if (refused.length) exitCode = 1
  }
  printLocalChanges(changes)
  const problems = checks.contextProblems(contexts, state.source)
  if (problems.length) {
    console.warn(
      `Warning: ${paths.contexts} needs work before a translation run:\n  ${problems.join("\n  ")}`,
    )
  }
  const written = await writeState(paths, state, contexts)
  console.log(
    written.length
      ? `Wrote ${plural(written.length, "file")}.`
      : "No file changed.",
  )
  return exitCode
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const paths = resolvePaths(options)
  if (options.pruneOnly || options.restamp || options.markPending)
    return runNoNetwork(options, paths)
  return runFull(options, paths)
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    if (error instanceof CommandError) {
      console.error(error.message)
      process.exitCode = error.exitCode
      return
    }
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 2
  })
