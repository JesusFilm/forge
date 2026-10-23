"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The committed lists of the release check and the checks that keep them
// complete (KTD3, KTD8, KTD10, KTD11, KTD12). `check-lists` runs every check
// here; the jest guards run the same functions against the app's own source.

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { parse, print } = require("graphql")

const { EXIT, FAILURE_CLASSES } = require("./contract")
const inventoryLib = require("./devices/inventory")
const { journeyRuleProblems, parseFlow } = require("./journeys/flow")

const RELEASE_CHECK_DIR = path.resolve(__dirname, "..")
const MOBILE_DIR = path.resolve(RELEASE_CHECK_DIR, "..")
const REPO_ROOT = path.resolve(MOBILE_DIR, "../..")
const CONFIG_DIR = path.join(RELEASE_CHECK_DIR, "config")
const JOURNEYS_DIR = path.join(RELEASE_CHECK_DIR, "journeys")
const ADMIN_SCHEMA_PATH = "apps/admin/schema.graphql"

const LIST_FILES = Object.freeze({
  testSettings: "test-settings.json",
  operations: "operations.json",
  knownBugs: "known-bugs.json",
  notTested: "not-tested.json",
  screens: "screens.json",
  searchAnswers: "search-answers.json",
  devices: "devices.json",
})

const PLATFORMS = ["ios", "android"]
const JOURNEY_SCHEME = "forgemobile://"
// Read outside src/env.ts (vttCache, fetchChapter, localeStore), so the env
// scan cannot find them by itself.
const ENV_EXTRA_KEYS = [
  "EXPO_PUBLIC_UI_PSEUDO_LOCALE",
  "EXPO_PUBLIC_USE_RN_FETCH",
]
const SETTING_CLASSES = ["copiedFromProduction", "testValue", "mustBeUnset"]
const OPERATION_CLASSES = ["readOnly", "savedAnswer", "successReply", "blocked"]
const ROOT_TYPES = Object.freeze({
  query: "Query",
  mutation: "Mutation",
  subscription: "Subscription",
})
const ROOT_COORDINATE =
  /^(Query|Mutation|Subscription)\.[_A-Za-z][_0-9A-Za-z]*$/
const FIELD_COORDINATE = /^[_A-Za-z][_0-9A-Za-z]*\.[_A-Za-z][_0-9A-Za-z]*$/
const SHA256_HEX = /^[0-9a-f]{64}$/
const HAND_SCREEN_KINDS = ["alert", "actionSheet"]
const DEVICE_LANES = ["ios", "androidPhone", "androidTablet"]
const PORT_NAMES = [
  "device",
  "hostIos",
  "hostAndroidPhone",
  "hostAndroidTablet",
]
const ROUTE_EXTENSION = /\.(tsx|ts|jsx|js)$/
const PLATFORM_SUFFIX = /\.(ios|android|native|web)$/

function isNonEmptyString(input) {
  return typeof input === "string" && input.trim() !== ""
}

function isObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

// ── Test settings (KTD3) ────────────────────────────────────────────

function envKeysFromSource(source) {
  return [...new Set(source.match(/\bEXPO_PUBLIC_[A-Z0-9_]+\b/g) ?? [])]
}

function appEnvKeys(mobileDir = MOBILE_DIR) {
  const source = fs.readFileSync(path.join(mobileDir, "src/env.ts"), "utf8")
  return [...new Set([...envKeysFromSource(source), ...ENV_EXTRA_KEYS])].sort()
}

function settingClasses(settings) {
  return {
    copiedFromProduction: Object.keys(settings.copiedFromProduction ?? {}),
    testValue: Object.keys(settings.testValue ?? {}),
    mustBeUnset: Array.isArray(settings.mustBeUnset)
      ? settings.mustBeUnset
      : [],
  }
}

/** Every key needs exactly one class: a key in none has no decision. */
function classifyEnvKeys(keys, settings) {
  const classes = settingClasses(settings)
  const classesOf = (key) =>
    SETTING_CLASSES.filter((name) => classes[name].includes(key))
  const classified = new Set(SETTING_CLASSES.flatMap((name) => classes[name]))
  const unclassified = keys.filter((key) => classesOf(key).length === 0)
  const repeated = [...classified]
    .map((key) => ({ key, classes: classesOf(key) }))
    .filter((entry) => entry.classes.length > 1)
  return { unclassified, repeated }
}

// The build check hashes every window of `length` bytes in the bundle (KTD5).
function isMuxKeyDigest(entry) {
  return (
    isObject(entry) &&
    SHA256_HEX.test(entry.sha256 ?? "") &&
    Number.isInteger(entry.length) &&
    entry.length > 0
  )
}

function checkTestSettings(settings, envKeys) {
  const problems = []
  if (settings.schemaVersion !== 1) problems.push("schemaVersion must be 1")
  if (
    settings.productionCheckedAt !== null &&
    !isNonEmptyString(settings.productionCheckedAt)
  ) {
    problems.push("productionCheckedAt must be null or a date")
  }
  for (const name of PORT_NAMES) {
    if (!Number.isInteger(settings.ports?.[name])) {
      problems.push(`ports.${name} must be a port number`)
    }
  }
  if (!isObject(settings.copiedFromProduction)) {
    problems.push("copiedFromProduction must map each key to a value or null")
  } else {
    for (const [key, value] of Object.entries(settings.copiedFromProduction)) {
      if (value !== null && typeof value !== "string") {
        problems.push(`copiedFromProduction.${key} must be a string or null`)
      }
    }
  }
  if (!isObject(settings.testValue)) {
    problems.push("testValue must map each key to its test value")
  } else {
    for (const [key, value] of Object.entries(settings.testValue)) {
      if (typeof value !== "string") {
        problems.push(`testValue.${key} must be a string`)
      }
    }
  }
  if (!Array.isArray(settings.mustBeUnset)) {
    problems.push("mustBeUnset must list keys")
  }
  if (
    !Array.isArray(settings.muxDataEnvKeyDigests) ||
    !settings.muxDataEnvKeyDigests.every(isMuxKeyDigest)
  ) {
    problems.push(
      "muxDataEnvKeyDigests must list { sha256, length } entries: a SHA-256 hex digest and the key's length",
    )
  }
  const { unclassified, repeated } = classifyEnvKeys(envKeys, settings)
  for (const key of unclassified) {
    problems.push(`${key} is in no class; put it in exactly one`)
  }
  for (const { key, classes } of repeated) {
    problems.push(`${key} is in ${classes.join(" and ")}; keep one class`)
  }
  return problems
}

// ── Operations (KTD8) ───────────────────────────────────────────────

function collectRootFields(selectionSet, fragments, rootType, out, seen) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === "Field") {
      out.add(`${rootType}.${selection.name.value}`)
    } else if (selection.kind === "InlineFragment") {
      collectRootFields(selection.selectionSet, fragments, rootType, out, seen)
    } else if (selection.kind === "FragmentSpread") {
      const name = selection.name.value
      if (seen.has(name)) continue
      seen.add(name)
      const fragment = fragments.get(name)
      if (!fragment) throw new Error(`fragment ${name} is not in the document`)
      collectRootFields(fragment.selectionSet, fragments, rootType, out, seen)
    }
  }
}

/** The `Type.field` of every root field, including one inside a fragment. */
function rootFieldCoordinates(document) {
  const fragments = new Map(
    document.definitions
      .filter((definition) => definition.kind === "FragmentDefinition")
      .map((definition) => [definition.name.value, definition]),
  )
  const out = new Set()
  for (const definition of document.definitions) {
    if (definition.kind !== "OperationDefinition") continue
    const rootType = ROOT_TYPES[definition.operation]
    collectRootFields(
      definition.selectionSet,
      fragments,
      rootType,
      out,
      new Set(),
    )
  }
  return [...out].sort()
}

function operationClassesOf(operations, coordinate) {
  return OPERATION_CLASSES.filter((name) =>
    (operations[name] ?? []).includes(coordinate),
  )
}

/** The one class of a root field, or null when it has none or several. */
function classifyCoordinate(operations, coordinate) {
  const found = operationClassesOf(operations, coordinate)
  return found.length === 1 ? found[0] : null
}

function checkOperations(operations, repoRoot = REPO_ROOT) {
  const problems = []
  if (operations.schemaVersion !== 1) problems.push("schemaVersion must be 1")
  const seen = new Map()
  for (const name of OPERATION_CLASSES) {
    const entries = operations[name]
    if (!Array.isArray(entries)) {
      problems.push(`${name} must list root fields`)
      continue
    }
    for (const coordinate of entries) {
      if (!ROOT_COORDINATE.test(coordinate)) {
        problems.push(
          `${name} entry ${JSON.stringify(coordinate)} is not Query.field or Mutation.field`,
        )
      }
      if (seen.has(coordinate)) {
        problems.push(
          `${coordinate} is in ${seen.get(coordinate)} and ${name}; keep one class`,
        )
      } else {
        seen.set(coordinate, name)
      }
    }
  }
  if (!Array.isArray(operations.writesOnRead)) {
    problems.push("writesOnRead must list field coordinates")
    return problems
  }
  operations.writesOnRead.forEach((entry, index) => {
    const label = `writesOnRead[${index}]`
    if (!FIELD_COORDINATE.test(entry?.coordinate ?? "")) {
      problems.push(`${label} needs a Type.field coordinate`)
    }
    if (!isNonEmptyString(entry?.why)) problems.push(`${label} needs a why`)
    if (!isNonEmptyString(entry?.source)) {
      problems.push(`${label} needs the admin source file`)
    } else if (!fs.existsSync(path.join(repoRoot, entry.source))) {
      problems.push(`${label} names ${entry.source}, which does not exist`)
    }
  })
  return problems
}

// ── Saved search answers (KTD10) ────────────────────────────────────

/** The WatchSearch text as `src/lib/queries.ts` writes it, without TypeScript. */
function watchSearchDocumentText(queriesSource) {
  const match = queriesSource.match(
    /export const WATCH_SEARCH = adminGraphql\(\s*`([^`]*)`/,
  )
  if (!match) throw new Error("cannot find WATCH_SEARCH in src/lib/queries.ts")
  return match[1]
}

function documentDigest(document) {
  return sha256(print(document))
}

function currentWatchSearchDigest(mobileDir = MOBILE_DIR) {
  const source = fs.readFileSync(
    path.join(mobileDir, "src/lib/queries.ts"),
    "utf8",
  )
  return documentDigest(parse(watchSearchDocumentText(source)))
}

function checkSearchAnswers(answers, readDigest) {
  const problems = []
  if (answers.schemaVersion !== 1) problems.push("schemaVersion must be 1")
  if (!SHA256_HEX.test(answers.documentDigest ?? "")) {
    problems.push("documentDigest must be a SHA-256 hex digest")
  }
  if (!Array.isArray(answers.answers)) {
    problems.push("answers must be a list")
    return problems
  }
  if (answers.answers.length > 0 && answers.documentDigest !== readDigest()) {
    problems.push(
      "the WatchSearch document changed after these answers were recorded; run `record-search` again",
    )
  }
  return problems
}

// ── Screens (KTD11) ─────────────────────────────────────────────────

function sourceFiles(dir, matches) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full, matches)
    return matches(entry.name) ? [full] : []
  })
}

/** The screen id of one route file under `app/`, or null for a non-screen. */
function routeScreenId(relativeFile) {
  const segments = relativeFile.split(/[\\/]/)
  const base = segments[segments.length - 1]
  if (!ROUTE_EXTENSION.test(base) || /\.test\./.test(base)) return null
  if (base.startsWith("_layout") || base.startsWith("+native-intent")) {
    return null
  }
  segments[segments.length - 1] = base
    .replace(ROUTE_EXTENSION, "")
    .replace(PLATFORM_SUFFIX, "")
  const inTabs = segments[0] === "(tabs)"
  const parts = segments.filter(
    (segment) => !/^\(.*\)$/.test(segment) && !/^\[.*\]$/.test(segment),
  )
  if (parts[parts.length - 1] === "index") parts.pop()
  if (inTabs) return `tab-${parts.length > 0 ? parts.join("-") : "home"}`
  return parts.length > 0 ? parts.join("-") : "index"
}

function routeScreens(mobileDir = MOBILE_DIR) {
  const appDir = path.join(mobileDir, "app")
  const byId = new Map()
  for (const file of sourceFiles(appDir, (name) =>
    ROUTE_EXTENSION.test(name),
  )) {
    const relative = path.relative(appDir, file)
    const id = routeScreenId(relative)
    if (id === null) continue
    byId.set(id, [...(byId.get(id) ?? []), `app/${relative}`])
  }
  return [...byId.entries()]
    .map(([id, files]) => ({ id, files: files.sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

function quotedStrings(text) {
  return [...stripComments(text).matchAll(/"([^"\n]*)"/g)].map((m) => m[1])
}

function sourceSection(source, startPattern, endPattern, label) {
  const start = source.search(startPattern)
  if (start < 0) throw new Error(`cannot find ${label}`)
  const rest = source.slice(start)
  const end = rest.search(endPattern)
  return end < 0 ? rest : rest.slice(0, end)
}

function sheetRoutePatterns(suppressionSource) {
  return quotedStrings(
    sourceSection(
      suppressionSource,
      /export const IN_APP_SHEET_ROUTE_PATTERNS\s*=\s*\[/,
      /\]/,
      "IN_APP_SHEET_ROUTE_PATTERNS",
    ),
  )
}

function nonRouteSheetIds(suppressionSource) {
  return quotedStrings(
    sourceSection(
      suppressionSource,
      /export type NonRouteSheetId\s*=/,
      /\n\s*\n/,
      "NonRouteSheetId",
    ),
  )
}

function kebabCase(id) {
  return id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function sheetPatternId(pattern) {
  return pattern
    .split("/")
    .filter((segment) => !/^\[.*\]$/.test(segment))
    .join("-")
}

// Every screen a journey can cover, with root testID `screen-<id>`: the route
// files, the component-state sheets, and the hand list in config/screens.json.
function screenInventory(screensConfig, mobileDir = MOBILE_DIR) {
  const problems = []
  const routes = routeScreens(mobileDir)
  const routeIds = new Set(routes.map((route) => route.id))
  const suppression = fs.readFileSync(
    path.join(mobileDir, "src/lib/miniPlayer/suppression.ts"),
    "utf8",
  )
  const patterns = sheetRoutePatterns(suppression)
  if (patterns.length === 0) {
    problems.push("IN_APP_SHEET_ROUTE_PATTERNS is empty")
  }
  for (const pattern of patterns) {
    if (!routeIds.has(sheetPatternId(pattern))) {
      problems.push(`sheet route ${pattern} maps to no route file under app/`)
    }
  }
  const sheets = nonRouteSheetIds(suppression).map(kebabCase).sort()
  if (sheets.length === 0) problems.push("NonRouteSheetId names no sheet")
  const hand = Array.isArray(screensConfig?.hand)
    ? screensConfig.hand.map((entry) => entry?.id).filter(isNonEmptyString)
    : []
  const ids = new Set([...routeIds, ...sheets, ...hand])
  return { routes, sheets, hand, ids, problems }
}

function checkPlatforms(platforms, label, problems) {
  if (
    !Array.isArray(platforms) ||
    platforms.length === 0 ||
    !platforms.every((platform) => PLATFORMS.includes(platform))
  ) {
    problems.push(`${label} needs platforms from ${PLATFORMS.join(", ")}`)
  }
}

function checkScreens(
  screensConfig,
  inventory,
  settings,
  repoRoot = REPO_ROOT,
) {
  const problems = [...inventory.problems]
  if (screensConfig.schemaVersion !== 1) {
    problems.push("schemaVersion must be 1")
  }
  if (!Array.isArray(screensConfig.hand)) problems.push("hand must be a list")
  if (!Array.isArray(screensConfig.reach)) problems.push("reach must be a list")
  const generated = new Set([
    ...inventory.routes.map((route) => route.id),
    ...inventory.sheets,
  ])
  const sheets = new Set(inventory.sheets)
  const handIds = new Set()
  for (const [index, entry] of (screensConfig.hand ?? []).entries()) {
    const label = `hand[${index}]`
    // A sheet with no view, such as a native action sheet, has no testID, so
    // `generated: true` gives that sheet a text match instead.
    const textForSheet = entry?.generated === true
    if (!isNonEmptyString(entry?.id)) {
      problems.push(`${label} needs an id`)
    } else if (textForSheet && !sheets.has(entry.id)) {
      problems.push(
        `${label} sets generated: true, but ${entry.id} is not a sheet in NonRouteSheetId`,
      )
    } else if (
      handIds.has(entry.id) ||
      (!textForSheet && generated.has(entry.id))
    ) {
      problems.push(`${label} id ${entry.id} is already a screen id`)
    } else {
      handIds.add(entry.id)
    }
    if (!HAND_SCREEN_KINDS.includes(entry?.kind)) {
      problems.push(`${label} kind must be ${HAND_SCREEN_KINDS.join(" or ")}`)
    }
    if (!isNonEmptyString(entry?.match)) {
      problems.push(`${label} needs the visible text a journey asserts`)
    }
    checkPlatforms(entry?.platforms, label, problems)
    if (!isNonEmptyString(entry?.source)) {
      problems.push(`${label} needs a source`)
    } else if (!fs.existsSync(path.join(repoRoot, entry.source))) {
      problems.push(`${label} names ${entry.source}, which does not exist`)
    }
  }
  const settingKeys = new Set(
    Object.values(settingClasses(settings ?? {})).flat(),
  )
  for (const [index, entry] of (screensConfig.reach ?? []).entries()) {
    const label = `reach[${index}]`
    if (!inventory.ids.has(entry?.screen)) {
      problems.push(
        `${label} names screen ${entry?.screen}, which does not exist`,
      )
    }
    if (!PLATFORMS.includes(entry?.platform)) {
      problems.push(`${label} platform must be ${PLATFORMS.join(" or ")}`)
    }
    const rule = entry?.hiddenUnless
    if (entry?.hidden === true) {
      if (rule !== undefined) {
        problems.push(`${label} has hidden and hiddenUnless`)
      }
      if (!isNonEmptyString(entry.reason)) {
        problems.push(`${label} needs a reason`)
      }
    } else if (!isObject(rule)) {
      problems.push(`${label} needs hiddenUnless or hidden: true`)
    } else {
      // A misspelled key would hide the screen on every run.
      if (!settingKeys.has(rule.key)) {
        problems.push(`${label} key ${rule.key} is not in test-settings.json`)
      }
      if (!Array.isArray(rule.values) || !rule.values.every(isNonEmptyString)) {
        problems.push(`${label} hiddenUnless.values must list strings`)
      }
    }
  }
  return problems
}

function checkNotTested(notTested, screenIds) {
  const problems = []
  if (notTested.schemaVersion !== 1) problems.push("schemaVersion must be 1")
  if (!Array.isArray(notTested.entries)) {
    return [...problems, "entries must be a list"]
  }
  notTested.entries.forEach((entry, index) => {
    const label = `entries[${index}]`
    if (entry?.kind !== "screen" && entry?.kind !== "step") {
      problems.push(`${label} kind must be screen or step`)
    }
    if (!isNonEmptyString(entry?.target)) {
      problems.push(`${label} needs a target`)
    } else if (entry.kind === "screen" && !screenIds.has(entry.target)) {
      problems.push(
        `${label} names screen ${entry.target}, which does not exist`,
      )
    }
    checkPlatforms(entry?.platforms, label, problems)
    if (!isNonEmptyString(entry?.reason)) {
      problems.push(`${label} needs a reason`)
    }
  })
  return problems
}

// ── Known bugs (R28) ────────────────────────────────────────────────

function checkKnownBugs(knownBugs, deviceIds) {
  const problems = []
  if (knownBugs.schemaVersion !== 1) problems.push("schemaVersion must be 1")
  if (!Array.isArray(knownBugs.entries)) {
    return [...problems, "entries must be a list"]
  }
  knownBugs.entries.forEach((entry, index) => {
    const label = `entries[${index}]`
    if (!isNonEmptyString(entry?.journey)) {
      problems.push(`${label} needs a journey`)
    }
    if (!isNonEmptyString(entry?.ticket)) {
      problems.push(`${label} needs a ticket`)
    }
    // R28: an entry matches a step label, never a step index.
    if (!isNonEmptyString(entry?.step)) {
      problems.push(`${label} needs the failing step's label`)
    }
    if (!FAILURE_CLASSES.includes(entry?.check)) {
      problems.push(
        `${label} check must be one of ${FAILURE_CLASSES.join(", ")}`,
      )
    }
    if (!Array.isArray(entry?.devices) || entry.devices.length === 0) {
      problems.push(`${label} needs the devices it fails on`)
    } else {
      for (const device of entry.devices) {
        if (!deviceIds.has(device)) {
          problems.push(
            `${label} names device ${device}, which is not in devices.json`,
          )
        }
      }
    }
  })
  return problems
}

// ── Devices ─────────────────────────────────────────────────────────

function checkDevices(devices) {
  const problems = []
  if (devices.schemaVersion !== 1) problems.push("schemaVersion must be 1")
  const prefix = devices.namePrefix
  if (!isNonEmptyString(prefix)) return [...problems, "namePrefix is required"]
  const avdPrefix = inventoryLib.avdPrefix(devices)
  if (!Array.isArray(devices.devices) || devices.devices.length === 0) {
    return [...problems, "devices must list the test devices"]
  }
  const ids = new Set()
  devices.devices.forEach((device, index) => {
    const label = `devices[${index}]`
    if (!isNonEmptyString(device?.id)) {
      problems.push(`${label} needs an id`)
    } else if (ids.has(device.id)) {
      problems.push(`${label} id ${device.id} repeats`)
    } else {
      ids.add(device.id)
    }
    if (!DEVICE_LANES.includes(device?.lane)) {
      problems.push(`${label} lane must be one of ${DEVICE_LANES.join(", ")}`)
    }
    const nullableStrings =
      device?.platform === "ios" ? ["deviceType", "runtime"] : ["image"]
    for (const field of nullableStrings) {
      if (device?.[field] !== null && !isNonEmptyString(device?.[field])) {
        problems.push(`${label} ${field} must be a string or null`)
      }
    }
    if (device?.platform === "ios") {
      if (
        !isNonEmptyString(device.name) ||
        !device.name.startsWith(`${prefix} `)
      ) {
        problems.push(`${label} name must start with "${prefix} "`)
      }
    } else if (device?.platform === "android") {
      if (!isNonEmptyString(device.avd) || !device.avd.startsWith(avdPrefix)) {
        problems.push(`${label} avd must start with "${avdPrefix}"`)
      }
      if (!isNonEmptyString(device.profile)) {
        problems.push(`${label} needs a profile`)
      }
    } else {
      problems.push(`${label} platform must be ios or android`)
    }
  })
  const pins = devices.pins
  if (!isNonEmptyString(pins?.locale)) problems.push("pins.locale is required")
  if (pins?.timezone !== null && !isNonEmptyString(pins?.timezone)) {
    problems.push("pins.timezone must be a string or null")
  }
  if (!Number.isInteger(pins?.memoryMb)) {
    problems.push("pins.memoryMb must be a number")
  }
  return problems
}

// ── Journeys (KTD12) ────────────────────────────────────────────────

function journeyFiles(journeysDir = JOURNEYS_DIR) {
  return sourceFiles(journeysDir, (name) => /\.ya?ml$/.test(name)).sort()
}

// YAML starts a comment at a `#` that begins the line or follows a space,
// outside quotes. A `#` inside a link is part of the link.
function withoutYamlComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index)
    }
  }
  return line
}

function unquote(text) {
  const trimmed = text.trim()
  const first = trimmed[0]
  if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function indentOf(line) {
  return line.length - line.trimStart().length
}

/** Each `openLink` in a Maestro flow, in its short, map, or block form. */
function journeyLinks(source) {
  const lines = source.split(/\r?\n/).map(withoutYamlComment)
  const links = []
  lines.forEach((line, index) => {
    const match = line.match(/^(\s*)(?:-\s+)?openLink\s*:\s*(.*)$/)
    if (!match) return
    const rest = match[2].trim()
    let link = null
    if (rest.startsWith("{")) {
      link = rest.match(/\blink\s*:\s*([^,}]+)/)?.[1] ?? null
    } else if (rest !== "") {
      link = rest
    } else {
      for (const next of lines.slice(index + 1)) {
        if (next.trim() === "") continue
        if (indentOf(next) <= match[1].length) break
        const field = next.match(/^\s*(?:-\s+)?link\s*:\s*(.*)$/)
        if (field) {
          link = field[1]
          break
        }
      }
    }
    links.push({ line: index + 1, link: link === null ? null : unquote(link) })
  })
  return links
}

function checkJourneys(files, display) {
  const findings = []
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8")
    const finding = (message) =>
      findings.push({ list: "journeys", file: display(file), message })
    for (const { line, link } of journeyLinks(source)) {
      if (link !== null && link.startsWith(JOURNEY_SCHEME)) continue
      const opened = link === null ? "a link it does not name" : `\`${link}\``
      finding(
        `line ${line} opens ${opened}; a journey opens only ${JOURNEY_SCHEME} links`,
      )
    }
    let flow
    try {
      flow = parseFlow(source)
    } catch (error) {
      finding(`cannot read the journey: ${error.message}`)
      continue
    }
    for (const message of journeyRuleProblems(flow)) finding(message)
  }
  return findings
}

// ── check-lists ─────────────────────────────────────────────────────

function runCheckLists(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT
  const mobileDir = options.mobileDir ?? MOBILE_DIR
  const configDir = options.configDir ?? CONFIG_DIR
  const journeysDir = options.journeysDir ?? JOURNEYS_DIR
  const display = (file) => {
    const relative = path.relative(repoRoot, file)
    return relative.startsWith("..") ? file : relative
  }
  const findings = []
  const lists = {}
  for (const [name, file] of Object.entries(LIST_FILES)) {
    const full = path.join(configDir, file)
    try {
      lists[name] = readJson(full)
    } catch (error) {
      findings.push({
        list: name,
        file: display(full),
        message: `cannot read: ${error.message}`,
      })
    }
  }
  const report = (name, run) => {
    if (!lists[name]) return
    const file = display(path.join(configDir, LIST_FILES[name]))
    try {
      for (const message of run(lists[name])) {
        findings.push({ list: name, file, message })
      }
    } catch (error) {
      findings.push({ list: name, file, message: error.message })
    }
  }

  report("testSettings", (settings) =>
    checkTestSettings(settings, appEnvKeys(mobileDir)),
  )
  report("operations", (operations) => checkOperations(operations, repoRoot))
  report("devices", checkDevices)
  const deviceIds = new Set(
    Array.isArray(lists.devices?.devices)
      ? lists.devices.devices.map((device) => device?.id)
      : [],
  )
  report("knownBugs", (knownBugs) => checkKnownBugs(knownBugs, deviceIds))
  report("searchAnswers", (answers) =>
    checkSearchAnswers(answers, () => currentWatchSearchDigest(mobileDir)),
  )
  let inventory = null
  report("screens", (screens) => {
    inventory = screenInventory(screens, mobileDir)
    return checkScreens(screens, inventory, lists.testSettings, repoRoot)
  })
  if (inventory) {
    report("notTested", (notTested) => checkNotTested(notTested, inventory.ids))
  } else if (lists.notTested) {
    findings.push({
      list: "notTested",
      file: display(path.join(configDir, LIST_FILES.notTested)),
      message: "not checked, because the screen list could not be built",
    })
  }
  const journeys = journeyFiles(journeysDir)
  findings.push(...checkJourneys(journeys, display))

  return {
    passed: findings.length === 0,
    findings,
    counts: {
      journeys: journeys.length,
      screens: inventory ? inventory.ids.size : 0,
      notTested: lists.notTested?.entries?.length ?? 0,
      knownBugs: lists.knownBugs?.entries?.length ?? 0,
      searchAnswers: lists.searchAnswers?.answers?.length ?? 0,
      writesOnRead: lists.operations?.writesOnRead?.length ?? 0,
    },
  }
}

function checkListsCommand(command, options = {}) {
  const out = options.out ?? console.log
  const result = runCheckLists(options)
  if (command.flags.json) {
    out(JSON.stringify({ mode: "check-lists", ...result }, null, 2))
  } else if (result.passed) {
    const counts = Object.entries(result.counts)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")
    out(`check-lists passed (${counts}).`)
  } else {
    out(`check-lists failed with ${result.findings.length} finding(s):`)
    for (const finding of result.findings)
      out(`- ${finding.file}: ${finding.message}`)
  }
  return result.passed ? EXIT.passed : EXIT.failed
}

module.exports = {
  ADMIN_SCHEMA_PATH,
  CONFIG_DIR,
  JOURNEYS_DIR,
  LIST_FILES,
  MOBILE_DIR,
  OPERATION_CLASSES,
  REPO_ROOT,
  appEnvKeys,
  checkListsCommand,
  classifyCoordinate,
  classifyEnvKeys,
  currentWatchSearchDigest,
  documentDigest,
  envKeysFromSource,
  isObject,
  readJson,
  rootFieldCoordinates,
  routeScreenId,
  runCheckLists,
  screenInventory,
  sheetRoutePatterns,
  sha256,
  watchSearchDocumentText,
}
