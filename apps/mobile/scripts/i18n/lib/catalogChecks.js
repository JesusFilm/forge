"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// Read-side checks for the mobile UI catalogs (KTD8). The jest suites in
// src/i18n/__tests__/, pending-report.mjs, and translate-catalogs.mjs share them.

const fs = require("fs")
const path = require("path")
const ops = require("./catalogOps")

const MOBILE_DIR = path.resolve(__dirname, "../../..")
const REAL_PATHS = {
  messagesDir: path.join(MOBILE_DIR, "messages"),
  policy: path.join(MOBILE_DIR, "i18n/translation-policy.json"),
  contexts: path.join(MOBILE_DIR, "i18n/translation-contexts.json"),
  manifest: path.join(MOBILE_DIR, "i18n/script-manifest.json"),
  provenance: path.join(MOBILE_DIR, "i18n/translation-provenance.json"),
  modelTable: path.join(MOBILE_DIR, "i18n/model-table.json"),
  record: path.join(MOBILE_DIR, "i18n/source-record.json"),
  nativeLocales: path.join(MOBILE_DIR, "i18n/native-locales.json"),
  webMessagesDir: path.resolve(MOBILE_DIR, "../web/messages"),
  webManifest: path.resolve(
    MOBILE_DIR,
    "../../docs/i18n/watch-ui-provisional-catalogs.json",
  ),
}

const API_MODEL_ID =
  /^(?:gpt-\d+(?:\.\d+)*(?:-[a-z0-9]+)*|o\d+(?:-[a-z0-9]+)*)$/
const CONTEXT_FIELDS = new Set(["product", "namespaces", "keys"])
const CONTEXT_OVERRIDE_FIELDS = new Set(["role", "visibility", "composition"])
const MODEL_TABLE_FIELDS = new Set(["defaultModel", "locales"])
const PROVENANCE_FIELDS = new Set(["reviewStatus", "machineTranslatedLocales"])
const MANIFEST_LISTS = [
  "authoredInventoryLocales",
  "provisionalLocales",
  "existingNonInventoryLocales",
  "missingCatalogs",
]

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((v) => right.has(v))
}

function messageVariables(message) {
  const found = new Set()
  for (const match of message.matchAll(
    /\{([A-Za-z][A-Za-z0-9_]*)\s*(?:,|\})/g,
  )) {
    found.add(match[1])
  }
  return found
}

function richTextTags(message) {
  return new Set(
    [...message.matchAll(/<\/?([A-Za-z][A-Za-z0-9_]*)>/g)].map((m) => m[1]),
  )
}

function hasBalancedBraces(message) {
  let depth = 0
  for (const character of message) {
    if (character === "{") depth += 1
    if (character === "}") depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}

// Mirror of messageContractError in apps/web/scripts/openai-catalog-translator.mjs,
// without its one web-only key rule. contractMirror.test.js compares the two.
function contractError(key, source, value) {
  if (typeof value !== "string") return `Missing translation: ${key}`
  if (source.length === 0 && value.length === 0) return null
  if (value.trim().length === 0) return `Empty translation: ${key}`
  if (value.includes("```")) return `Markdown fence in translation: ${key}`
  if (!hasBalancedBraces(value)) return `Unbalanced ICU braces: ${key}`
  if (!sameSet(messageVariables(source), messageVariables(value))) {
    return `ICU variable mismatch: ${key}`
  }
  if (!sameSet(richTextTags(source), richTextTags(value))) {
    return `Rich-text tag mismatch: ${key}`
  }
  if (
    source.includes("#") &&
    source.includes("plural") &&
    !value.includes("#")
  ) {
    return `Plural substitution marker missing: ${key}`
  }
  return null
}

function pluralOperations(message) {
  return new Set(
    [
      ...message.matchAll(
        /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*(plural|selectordinal|select)\b/g,
      ),
    ].map((m) => `${m[2]}:${m[1]}`),
  )
}

// Web's parity suite checks this too; the script's contract check does not.
function pluralOperationError(key, source, value) {
  if (typeof value !== "string") return null
  const expected = pluralOperations(source)
  const actual = pluralOperations(value)
  if (sameSet(expected, actual)) return null
  return `Plural or select mismatch: ${key}; expected ${[...expected].sort().join(",") || "none"}; found ${[...actual].sort().join(",") || "none"}`
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function readPolicy(file) {
  return ops.normalizePolicy(readJson(file), file)
}

function readRecord(file) {
  return ops.normalizeRecord(readJson(file), file)
}

function catalogTagsIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort(ops.codePointCompare)
}

/** `{ source, catalogs }` as flat catalogs; `catalogs` excludes English. */
function readCatalogDir(messagesDir) {
  const source = ops.flattenCatalog(
    readJson(path.join(messagesDir, `${ops.SOURCE_LOCALE}.json`)),
  )
  const catalogs = {}
  for (const tag of catalogTagsIn(messagesDir)) {
    if (tag === ops.SOURCE_LOCALE) continue
    catalogs[tag] = ops.flattenCatalog(
      readJson(path.join(messagesDir, `${tag}.json`)),
    )
  }
  return { source, catalogs }
}

function translatedCatalogs(catalogs, policy) {
  const englishOnly = new Set(policy.englishOnlyLocales)
  return Object.keys(catalogs)
    .filter((locale) => !englishOnly.has(locale))
    .sort(ops.codePointCompare)
}

function parityProblems(source, catalogs) {
  const problems = []
  for (const locale of Object.keys(catalogs).sort(ops.codePointCompare)) {
    const catalog = catalogs[locale]
    for (const key of Object.keys(source)) {
      if (!Object.hasOwn(catalog, key))
        problems.push({ locale, key, kind: "missing" })
    }
    for (const key of Object.keys(catalog)) {
      if (!Object.hasOwn(source, key))
        problems.push({ locale, key, kind: "unexpected" })
    }
  }
  return problems
}

/** A translated locale that shows English for a key that is not pending. */
function untranslatedProblems(source, catalogs, policy) {
  const neutral = new Set(policy.intentionallyLocaleNeutral)
  const pending = policy.pendingKeys
  const problems = []
  for (const locale of translatedCatalogs(catalogs, policy)) {
    for (const [key, text] of Object.entries(source)) {
      if (neutral.has(key) || Object.hasOwn(pending, key)) continue
      if (catalogs[locale][key] === text) {
        problems.push({ locale, key, kind: "untranslated" })
      }
    }
  }
  return problems
}

function contractProblems(source, catalogs) {
  const problems = []
  for (const locale of Object.keys(catalogs).sort(ops.codePointCompare)) {
    for (const [key, text] of Object.entries(source)) {
      const value = catalogs[locale][key]
      if (value === undefined) continue
      const message =
        contractError(key, text, value) ??
        pluralOperationError(key, text, value)
      if (message) problems.push({ locale, key, kind: "contract", message })
    }
  }
  return problems
}

function recordProblems(source, record, policy) {
  const problems = []
  for (const [key, text] of Object.entries(source)) {
    if (Object.hasOwn(policy.pendingKeys, key)) continue
    const recorded = record.englishHashes[key]
    if (recorded === undefined) problems.push({ key, kind: "unrecorded" })
    else if (recorded !== ops.englishHash(text))
      problems.push({ key, kind: "stale" })
  }
  for (const key of Object.keys(record.englishHashes)) {
    if (!Object.hasOwn(source, key)) problems.push({ key, kind: "deleted" })
  }
  return problems
}

// A pending key whose English changed after it was recorded: only the current
// English is safe in a translated locale, because no value can be proven fresh.
function stalePlaceholderProblems(source, catalogs, record, policy) {
  const problems = []
  for (const key of Object.keys(policy.pendingKeys)) {
    if (!Object.hasOwn(source, key)) continue
    if (record.englishHashes[key] === ops.englishHash(source[key])) continue
    for (const locale of translatedCatalogs(catalogs, policy)) {
      const value = catalogs[locale][key]
      if (value !== undefined && value !== source[key]) {
        problems.push({ locale, key, kind: "stale-placeholder" })
      }
    }
  }
  return problems
}

const RUN_HINT =
  "Run `node scripts/i18n/translate-catalogs.mjs` in apps/mobile (see the Localization section of apps/mobile/CLAUDE.md)."

function describeProblem(problem) {
  const where = problem.locale ? `${problem.locale}: ` : ""
  switch (problem.kind) {
    case "missing":
      return `${where}${problem.key} is missing. ${RUN_HINT}`
    case "unexpected":
      return `${where}${problem.key} is not in en.json. Run the command with --prune-only.`
    case "untranslated":
      return `${where}${problem.key} shows the English text, and the key is not pending. ${RUN_HINT}`
    case "contract":
      return `${where}${problem.message}`
    case "unrecorded":
      return `${problem.key} has no English hash in i18n/source-record.json. ${RUN_HINT}`
    case "stale":
      return `${problem.key} changed in en.json after its translations were recorded. ${RUN_HINT} Or put it on the pending list with --mark-pending ${problem.key}.`
    case "deleted":
      return `${problem.key} is in i18n/source-record.json but not in en.json. Run the command with --prune-only.`
    case "stale-placeholder":
      return `${where}${problem.key} is pending, and its English changed; the locale must show the new English. Run the command with --mark-pending ${problem.key}.`
    default:
      return `${where}${problem.key}: ${problem.kind}`
  }
}

function policyProblems(raw, source, webTags) {
  let policy
  try {
    policy = ops.normalizePolicy(raw)
  } catch (error) {
    return [error.message]
  }
  const problems = []
  const tags = new Set(webTags)
  if (!policy.humanReviewedLocales.includes(ops.SOURCE_LOCALE)) {
    problems.push("humanReviewedLocales must include en")
  }
  for (const locale of policy.englishOnlyLocales) {
    if (!tags.has(locale))
      problems.push(`englishOnlyLocales: ${locale} has no web catalog`)
  }
  for (const key of policy.intentionallyLocaleNeutral) {
    if (!Object.hasOwn(source, key)) {
      problems.push(`intentionallyLocaleNeutral: ${key} is not in en.json`)
    }
  }
  for (const key of Object.keys(policy.pendingKeys)) {
    if (!Object.hasOwn(source, key))
      problems.push(`pendingKeys: ${key} is not in en.json`)
    if (policy.intentionallyLocaleNeutral.includes(key)) {
      problems.push(
        `pendingKeys: ${key} is locale-neutral, so it cannot be pending`,
      )
    }
  }
  return problems
}

function namespacesOf(source) {
  return [...new Set(Object.keys(source).map((key) => key.split(".", 1)[0]))]
}

// The same rules as loadCatalogContexts and validateCatalogContextCoverage in
// web's translate-ui-catalogs.mjs, so a bad file fails before any request.
function contextProblems(raw, source) {
  if (!isPlainObject(raw))
    return ["translation-contexts.json must be a JSON object"]
  const problems = []
  for (const field of Object.keys(raw)) {
    if (!CONTEXT_FIELDS.has(field)) problems.push(`unknown field ${field}`)
  }
  if (!isNonEmptyString(raw.product))
    problems.push("product must be a non-empty string")
  const namespaces = isPlainObject(raw.namespaces) ? raw.namespaces : null
  if (!namespaces) {
    problems.push("namespaces must map each namespace to a sentence")
  } else {
    for (const [namespace, sentence] of Object.entries(namespaces)) {
      if (!isNonEmptyString(sentence)) {
        problems.push(`namespaces.${namespace} must be a non-empty sentence`)
      }
    }
    for (const namespace of namespacesOf(source)) {
      if (!Object.hasOwn(namespaces, namespace)) {
        problems.push(
          `no sentence for namespace ${namespace} (add namespaces.${namespace})`,
        )
      }
    }
  }
  const keys = raw.keys ?? {}
  if (!isPlainObject(keys)) {
    problems.push("keys must map each message key to an override object")
    return problems
  }
  for (const [key, override] of Object.entries(keys)) {
    if (!Object.hasOwn(source, key))
      problems.push(`keys.${key} is not in en.json`)
    if (!isPlainObject(override)) {
      problems.push(`keys.${key} must be an object`)
      continue
    }
    for (const [field, value] of Object.entries(override)) {
      if (!CONTEXT_OVERRIDE_FIELDS.has(field) || !isNonEmptyString(value)) {
        problems.push(
          `keys.${key}.${field} must be a non-empty role, visibility, or composition`,
        )
      }
    }
  }
  return problems
}

function modelTableProblems(raw, webTags, englishOnlyLocales) {
  if (!isPlainObject(raw)) return ["model-table.json must be a JSON object"]
  const problems = []
  for (const field of Object.keys(raw)) {
    if (!MODEL_TABLE_FIELDS.has(field)) problems.push(`unknown field ${field}`)
  }
  const checkModel = (label, model) => {
    if (typeof model !== "string" || !API_MODEL_ID.test(model)) {
      problems.push(
        `${label} ${JSON.stringify(model)} is not an OpenAI API model ID`,
      )
    }
  }
  checkModel("defaultModel", raw.defaultModel)
  if (!isPlainObject(raw.locales)) {
    problems.push("locales must map a catalog tag to a model ID")
    return problems
  }
  const tags = new Set(webTags)
  const englishOnly = new Set(englishOnlyLocales)
  for (const [locale, model] of Object.entries(raw.locales)) {
    checkModel(`locales.${locale}`, model)
    if (
      !tags.has(locale) ||
      locale === ops.SOURCE_LOCALE ||
      englishOnly.has(locale)
    ) {
      problems.push(`locales.${locale} is not a translated web catalog`)
    }
  }
  return problems
}

function manifestProblems(raw) {
  if (!isPlainObject(raw)) return ["script-manifest.json must be a JSON object"]
  const problems = []
  for (const field of MANIFEST_LISTS) {
    if (!Array.isArray(raw[field]) || raw[field].length > 0) {
      problems.push(`${field} must be an empty array`)
    }
  }
  if (Object.hasOwn(raw, "machineTranslatedLocales")) {
    problems.push(
      "machineTranslatedLocales must be absent; provenance lives in translation-provenance.json",
    )
  }
  if (raw.metadata?.translation !== undefined) {
    problems.push("metadata.translation must be absent")
  }
  return problems
}

function provenanceProblems(raw, policy) {
  if (!isPlainObject(raw))
    return ["translation-provenance.json must be a JSON object"]
  const problems = []
  for (const field of Object.keys(raw)) {
    if (!PROVENANCE_FIELDS.has(field)) problems.push(`unknown field ${field}`)
  }
  if (!isNonEmptyString(raw.reviewStatus))
    problems.push("reviewStatus must be a sentence")
  if (!isPlainObject(raw.machineTranslatedLocales)) {
    problems.push(
      "machineTranslatedLocales must map a locale to { model, generatedOn }",
    )
    return problems
  }
  const excluded = new Set([
    ...policy.humanReviewedLocales,
    ...policy.englishOnlyLocales,
  ])
  for (const [locale, entry] of Object.entries(raw.machineTranslatedLocales)) {
    if (excluded.has(locale))
      problems.push(`${locale} is human-reviewed or English-only`)
    if (
      !isPlainObject(entry) ||
      typeof entry.model !== "string" ||
      !API_MODEL_ID.test(entry.model)
    ) {
      problems.push(`${locale}.model must be an OpenAI API model ID`)
    }
    if (
      !isPlainObject(entry) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.generatedOn ?? "")
    ) {
      problems.push(`${locale}.generatedOn must be a YYYY-MM-DD date`)
    }
  }
  return problems
}

/** Pending count, the oldest key, and the catalogs that still show English. */
function pendingSummary(source, catalogs, policy) {
  const entries = Object.entries(policy.pendingKeys).sort(
    ([leftKey, leftDate], [rightKey, rightDate]) =>
      ops.codePointCompare(leftDate, rightDate) ||
      ops.codePointCompare(leftKey, rightKey),
  )
  const locales = translatedCatalogs(catalogs, policy)
  return {
    count: entries.length,
    oldest:
      entries.length > 0 ? { key: entries[0][0], since: entries[0][1] } : null,
    keys: entries.map(([key, since]) => ({
      key,
      since,
      englishIn: locales.filter(
        (locale) =>
          !Object.hasOwn(catalogs[locale], key) ||
          catalogs[locale][key] === source[key],
      ),
    })),
  }
}

module.exports = {
  API_MODEL_ID,
  REAL_PATHS,
  catalogTagsIn,
  contextProblems,
  contractError,
  contractProblems,
  describeProblem,
  manifestProblems,
  modelTableProblems,
  parityProblems,
  pendingSummary,
  pluralOperationError,
  policyProblems,
  provenanceProblems,
  readCatalogDir,
  readJson,
  readPolicy,
  readRecord,
  recordProblems,
  stalePlaceholderProblems,
  untranslatedProblems,
}
