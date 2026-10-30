"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// Pure catalog operations for scripts/i18n/translate-catalogs.mjs (KTD6).
// Catalogs are flat `{ "Namespace.key": message }` objects. Every operation
// changes the state object it receives and returns a report of the change.

const crypto = require("crypto")

const SOURCE_LOCALE = "en"
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ENGLISH_HASH = /^[0-9a-f]{16}$/
const POLICY_LISTS = [
  "humanReviewedLocales",
  "intentionallyLocaleNeutral",
  "englishOnlyLocales",
]
const POLICY_FIELDS = new Set([...POLICY_LISTS, "pendingKeys"])

class CatalogOpsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "CatalogOpsError"
    this.code = code
  }
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

/** The per-key source record hash: 16 hex characters of SHA-256. */
function englishHash(text) {
  return sha256(text).slice(0, 16)
}

/** The digest web's script records for a flat catalog. */
function contentDigest(value) {
  return sha256(renderJson(value))
}

function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidDate(text) {
  if (!DATE.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

function flattenCatalog(tree) {
  const flat = {}
  const visit = (value, parts) => {
    if (typeof value === "string") {
      flat[parts.join(".")] = value
      return
    }
    if (!isPlainObject(value)) {
      throw new CatalogOpsError(
        "INVALID_MESSAGE_VALUE",
        `Invalid message value at ${parts.join(".") || "(root)"}`,
      )
    }
    for (const [key, child] of Object.entries(value))
      visit(child, [...parts, key])
  }
  visit(tree, [])
  return flat
}

function unflattenCatalog(flat) {
  const tree = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".")
    let cursor = tree
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {}
      cursor = cursor[part]
    }
    cursor[parts.at(-1)] = value
  }
  return tree
}

/** Source keys first, in source order; keys the source lacks keep their order after them. */
function orderLikeSource(flat, sourceFlat) {
  const ordered = {}
  for (const key of Object.keys(sourceFlat)) {
    if (Object.hasOwn(flat, key)) ordered[key] = flat[key]
  }
  for (const [key, value] of Object.entries(flat)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = value
  }
  return ordered
}

function normalizePolicy(raw, label = "translation policy") {
  const invalid = (detail) =>
    new CatalogOpsError("INVALID_TRANSLATION_POLICY", `${label}: ${detail}`)
  if (!isPlainObject(raw)) throw invalid("must be a JSON object")
  for (const field of Object.keys(raw)) {
    if (!POLICY_FIELDS.has(field)) throw invalid(`unknown field ${field}`)
  }
  const policy = {}
  for (const field of POLICY_LISTS) {
    const value = raw[field] ?? []
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw invalid(`${field} must be an array of strings`)
    }
    policy[field] = [...new Set(value)].sort(codePointCompare)
  }
  const pending = raw.pendingKeys ?? {}
  if (!isPlainObject(pending)) {
    throw invalid("pendingKeys must map each key to its YYYY-MM-DD date")
  }
  for (const [key, date] of Object.entries(pending)) {
    if (typeof date !== "string" || !isValidDate(date)) {
      throw invalid(`pendingKeys.${key} must be a YYYY-MM-DD date`)
    }
  }
  policy.pendingKeys = sortObject(pending)
  return {
    humanReviewedLocales: policy.humanReviewedLocales,
    intentionallyLocaleNeutral: policy.intentionallyLocaleNeutral,
    englishOnlyLocales: policy.englishOnlyLocales,
    pendingKeys: policy.pendingKeys,
  }
}

function normalizeRecord(raw, label = "source record") {
  const invalid = (detail) =>
    new CatalogOpsError("INVALID_SOURCE_RECORD", `${label}: ${detail}`)
  if (!isPlainObject(raw) || !isPlainObject(raw.englishHashes)) {
    throw invalid("must be { englishHashes: { <key>: <hash> } }")
  }
  for (const [key, hash] of Object.entries(raw.englishHashes)) {
    if (typeof hash !== "string" || !ENGLISH_HASH.test(hash)) {
      throw invalid(`englishHashes.${key} must be 16 hexadecimal characters`)
    }
  }
  return { englishHashes: sortObject(raw.englishHashes) }
}

function sortObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) =>
      codePointCompare(left, right),
    ),
  )
}

function englishOnlySet(state) {
  return new Set(state.policy.englishOnlyLocales)
}

/** Every catalog except English and the English-only locales. */
function translatedLocales(state) {
  const englishOnly = englishOnlySet(state)
  return Object.keys(state.catalogs)
    .filter((locale) => locale !== SOURCE_LOCALE && !englishOnly.has(locale))
    .sort(codePointCompare)
}

// Step 1: web's script fails on a missing catalog file.
function seedCatalogs(state, locales) {
  const seeded = []
  for (const locale of locales) {
    if (Object.hasOwn(state.catalogs, locale)) continue
    state.catalogs[locale] = {}
    seeded.push(locale)
  }
  return seeded
}

// Step 2.
function pruneDeletedKeys(state) {
  const exists = (key) => Object.hasOwn(state.source, key)
  const catalogs = {}
  for (const locale of Object.keys(state.catalogs).sort(codePointCompare)) {
    const gone = Object.keys(state.catalogs[locale]).filter((k) => !exists(k))
    if (gone.length === 0) continue
    for (const key of gone) delete state.catalogs[locale][key]
    catalogs[locale] = gone
  }
  const record = Object.keys(state.record.englishHashes).filter(
    (key) => !exists(key),
  )
  for (const key of record) delete state.record.englishHashes[key]
  const pending = Object.keys(state.policy.pendingKeys).filter(
    (key) => !exists(key),
  )
  for (const key of pending) delete state.policy.pendingKeys[key]
  const neutral = state.policy.intentionallyLocaleNeutral.filter(
    (key) => !exists(key),
  )
  state.policy.intentionallyLocaleNeutral =
    state.policy.intentionallyLocaleNeutral.filter(exists)
  return { catalogs, record, pending, neutral }
}

function syncEnglishOnly(state) {
  const changed = []
  for (const locale of [...englishOnlySet(state)].sort(codePointCompare)) {
    const catalog = state.catalogs[locale]
    if (catalog === undefined) continue
    if (renderJson(catalog) === renderJson(state.source)) continue
    state.catalogs[locale] = { ...state.source }
    changed.push(locale)
  }
  return changed
}

// Step 3. The record takes the new hash at once: once the stale values are
// gone, every value left or written later comes from the current English.
function invalidateChangedKeys(state) {
  const changed = []
  const unrecorded = []
  const deleted = {}
  const locales = translatedLocales(state)
  for (const [key, text] of Object.entries(state.source)) {
    const expected = englishHash(text)
    const recorded = state.record.englishHashes[key]
    if (recorded === expected) continue
    ;(recorded === undefined ? unrecorded : changed).push(key)
    for (const locale of locales) {
      if (!Object.hasOwn(state.catalogs[locale], key)) continue
      delete state.catalogs[locale][key]
      ;(deleted[locale] ??= []).push(key)
    }
    state.record.englishHashes[key] = expected
  }
  state.record.englishHashes = sortObject(state.record.englishHashes)
  return { changed, unrecorded, deleted: sortObject(deleted) }
}

// Step 4: the key predicate of web's translate-ui-catalogs.mjs, unscoped, with
// the stub manifest (no provisional or machine-translated locale). The script
// fills a missing key with English before it applies the predicate.
function predictKeys({
  sourceFlat,
  catalogFlat,
  neutral,
  messageContractError,
}) {
  return Object.keys(sourceFlat).filter((key) => {
    if (neutral.has(key)) return false
    const value = Object.hasOwn(catalogFlat, key)
      ? catalogFlat[key]
      : sourceFlat[key]
    return (
      value === sourceFlat[key] ||
      messageContractError(key, sourceFlat[key], value) !== null
    )
  })
}

function planRun(state, { locales, modelFor, messageContractError }) {
  const neutral = new Set(state.policy.intentionallyLocaleNeutral)
  const byModel = new Map()
  const upToDate = []
  for (const locale of [...locales].sort(codePointCompare)) {
    const keys = predictKeys({
      sourceFlat: state.source,
      catalogFlat: state.catalogs[locale] ?? {},
      neutral,
      messageContractError,
    })
    if (keys.length === 0) {
      upToDate.push(locale)
      continue
    }
    const model = modelFor(locale)
    if (!byModel.has(model)) byModel.set(model, {})
    byModel.get(model)[locale] = keys
  }
  const groups = [...byModel.entries()]
    .sort(([left], [right]) => codePointCompare(left, right))
    .map(([model, keysByLocale]) => ({ model, keysByLocale }))
  return { groups, upToDate }
}

function isKeyComplete({
  key,
  sourceFlat,
  catalogFlat,
  neutral,
  messageContractError,
}) {
  if (!Object.hasOwn(catalogFlat, key)) return false
  const value = catalogFlat[key]
  if (messageContractError(key, sourceFlat[key], value) !== null) return false
  return neutral.has(key) || value !== sourceFlat[key]
}

// Step 6: a pending key leaves the list only when no translated locale still
// shows its English.
function settlePendingKeys(state, messageContractError) {
  const neutral = new Set(state.policy.intentionallyLocaleNeutral)
  const locales = translatedLocales(state)
  const removed = []
  for (const key of Object.keys(state.policy.pendingKeys)) {
    if (!Object.hasOwn(state.source, key)) continue
    const complete = locales.every((locale) =>
      isKeyComplete({
        key,
        sourceFlat: state.source,
        catalogFlat: state.catalogs[locale],
        neutral,
        messageContractError,
      }),
    )
    if (!complete) continue
    delete state.policy.pendingKeys[key]
    removed.push(key)
  }
  return removed
}

// A changed key takes the new English in every translated locale, so a stale
// placeholder never ships (KTD6). A current translation stays.
function markPending(state, keys, today) {
  const neutral = new Set(state.policy.intentionallyLocaleNeutral)
  for (const key of keys) {
    if (!Object.hasOwn(state.source, key)) {
      throw new CatalogOpsError(
        "UNKNOWN_MESSAGE_KEY",
        `${key} is not in messages/en.json`,
      )
    }
    if (neutral.has(key)) {
      throw new CatalogOpsError(
        "LOCALE_NEUTRAL_KEY",
        `${key} is locale-neutral; it needs no translation, so it cannot be pending`,
      )
    }
  }
  const result = {}
  for (const key of keys) {
    const text = state.source[key]
    const current = state.record.englishHashes[key] === englishHash(text)
    const replaced = []
    const filled = []
    for (const locale of translatedLocales(state)) {
      const catalog = state.catalogs[locale]
      if (!Object.hasOwn(catalog, key)) {
        catalog[key] = text
        filled.push(locale)
      } else if (!current && catalog[key] !== text) {
        catalog[key] = text
        replaced.push(locale)
      }
    }
    state.record.englishHashes[key] = englishHash(text)
    state.policy.pendingKeys[key] ??= today
    result[key] = { replaced, filled }
  }
  state.record.englishHashes = sortObject(state.record.englishHashes)
  state.policy.pendingKeys = sortObject(state.policy.pendingKeys)
  return result
}

// Records a key only when no translated locale holds a value other than the
// current English, so a restamp can never hide a stale translation.
function restamp(state) {
  const removed = Object.keys(state.record.englishHashes).filter(
    (key) => !Object.hasOwn(state.source, key),
  )
  for (const key of removed) delete state.record.englishHashes[key]
  const stamped = []
  const refused = []
  const locales = translatedLocales(state)
  for (const [key, text] of Object.entries(state.source)) {
    const expected = englishHash(text)
    if (state.record.englishHashes[key] === expected) continue
    const holders = locales.filter(
      (locale) =>
        Object.hasOwn(state.catalogs[locale], key) &&
        state.catalogs[locale][key] !== text,
    )
    if (holders.length > 0) {
      refused.push({ key, locales: holders })
      continue
    }
    state.record.englishHashes[key] = expected
    stamped.push(key)
  }
  state.record.englishHashes = sortObject(state.record.englishHashes)
  return { stamped, refused, removed }
}

/** The web script's progress file for one model group (KTD6, R20). */
function progressFileName({ messagesDir, sourceFlat, policy, model }) {
  const dir = sha256(messagesDir).slice(0, 8)
  const english = contentDigest(sourceFlat).slice(0, 12)
  const policyDigest = contentDigest(policy).slice(0, 12)
  const modelSlug = model.replace(/[^A-Za-z0-9._-]/g, "_")
  return `forge-mobile-ui-${dir}-en${english}-policy${policyDigest}-${modelSlug}.json`
}

module.exports = {
  CatalogOpsError,
  SOURCE_LOCALE,
  codePointCompare,
  contentDigest,
  englishHash,
  flattenCatalog,
  invalidateChangedKeys,
  isKeyComplete,
  markPending,
  normalizePolicy,
  normalizeRecord,
  orderLikeSource,
  planRun,
  predictKeys,
  progressFileName,
  pruneDeletedKeys,
  renderJson,
  restamp,
  seedCatalogs,
  settlePendingKeys,
  sortObject,
  syncEnglishOnly,
  translatedLocales,
  unflattenCatalog,
}
