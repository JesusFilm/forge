"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The log check (R18): it reads `server-log.jsonl` with its own code and does
// not trust the server's decisions. It parses each forwarded body again from
// the logged bytes, so it imports neither the classifier nor lists.js.

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { Kind, parse } = require("graphql")

const CONFIG_DIR = path.resolve(__dirname, "../../config")
const EXIT = Object.freeze({ passed: 0, failed: 1, refused: 2 })
const ROOT_TYPES = Object.freeze({
  query: "Query",
  mutation: "Mutation",
  subscription: "Subscription",
})

class LogCheckRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = "LogCheckRefusal"
  }
}

function finding(code, message, deviceId = null) {
  return { code, message, setting: null, file: null, deviceId }
}

function isPlainObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function rootCoordinates(query) {
  let document
  try {
    document = parse(query)
  } catch {
    return null
  }
  const operations = document.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  )
  if (operations.length !== 1) return null
  const fragments = new Map()
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition)
    }
  }
  const [operation] = operations
  const rootType = ROOT_TYPES[operation.operation]
  const out = new Set()
  const seen = new Set()
  const pending = [operation.selectionSet]
  while (pending.length > 0) {
    for (const selection of pending.pop().selections) {
      if (selection.kind === Kind.FIELD) {
        if (selection.name.value !== "__typename") {
          out.add(`${rootType}.${selection.name.value}`)
        }
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        pending.push(selection.selectionSet)
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value
        if (seen.has(name)) continue
        seen.add(name)
        if (!fragments.has(name)) return null
        pending.push(fragments.get(name).selectionSet)
      } else {
        return null
      }
    }
  }
  return { opType: operation.operation, coordinates: [...out].sort() }
}

function operationSets(operations) {
  let sets = null
  return () =>
    (sets ??= {
      readOnly: new Set(operations.readOnly ?? []),
      searches: new Set(operations.savedAnswer ?? []),
    })
}

function checkForwarded(entry, where, setsOf) {
  const findings = []
  const deviceId = entry.deviceId ?? null
  const body = entry.forwardedBody
  if (typeof body !== "string") {
    return [
      finding(
        "FORWARDED_BODY_MISSING",
        `${where} is forwarded but has no forwarded bytes.`,
        deviceId,
      ),
    ]
  }
  const digest = crypto.createHash("sha256").update(body, "utf8").digest("hex")
  if (digest !== entry.forwardedSha256) {
    findings.push(
      finding(
        "DIGEST_MISMATCH",
        `${where} has forwarded bytes that do not match their digest.`,
        deviceId,
      ),
    )
  }
  let request
  try {
    request = JSON.parse(body)
  } catch {
    request = null
  }
  const read =
    isPlainObject(request) && typeof request.query === "string"
      ? rootCoordinates(request.query)
      : null
  if (read === null) {
    findings.push(
      finding(
        "FORWARDED_BODY_UNREADABLE",
        `${where} forwarded bytes that the log check cannot read as one GraphQL operation.`,
        deviceId,
      ),
    )
    return findings
  }
  if (read.opType !== "query") {
    findings.push(
      finding(
        "FORWARDED_MUTATION",
        `${where} forwarded a ${read.opType} to admin.`,
        deviceId,
      ),
    )
  }
  const { readOnly, searches } = setsOf()
  for (const coordinate of read.coordinates) {
    if (searches.has(coordinate)) {
      findings.push(
        finding(
          "FORWARDED_SEARCH",
          `${where} forwarded the search field ${coordinate} to admin.`,
          deviceId,
        ),
      )
    } else if (!readOnly.has(coordinate)) {
      findings.push(
        finding(
          "FORWARDED_NOT_READ_ONLY",
          `${where} forwarded ${coordinate}, which is not on the read-only list.`,
          deviceId,
        ),
      )
    }
  }
  return findings
}

function checkLogText(text, { operations, expectedDevices }) {
  const findings = []
  const perDevice = {}
  const routes = {}
  const rateLimitRefusals = []
  const setsOf = operationSets(operations)
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return
    const where = `log line ${index + 1}`
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      entry = null
    }
    if (!isPlainObject(entry)) {
      findings.push(
        finding("LOG_LINE_UNREADABLE", `${where} is not one JSON object.`),
      )
      return
    }
    const deviceId = typeof entry.deviceId === "string" ? entry.deviceId : null
    if (deviceId !== null) perDevice[deviceId] = (perDevice[deviceId] ?? 0) + 1
    const route = String(entry.route)
    routes[route] = (routes[route] ?? 0) + 1
    if (isPlainObject(entry.rateLimit)) {
      rateLimitRefusals.push({
        ts: entry.ts ?? null,
        field: entry.rateLimit.field ?? null,
        deviceId,
      })
    }
    // Any line with forwarded bytes went to admin, whatever its route says.
    if (route === "forwarded" || entry.forwardedBody !== undefined) {
      findings.push(...checkForwarded(entry, where, setsOf))
    }
  })
  for (const deviceId of expectedDevices) {
    if (!perDevice[deviceId]) {
      findings.push(
        finding(
          "DEVICE_NO_TRAFFIC",
          `${deviceId} sent no request through the read-only server.`,
          deviceId,
        ),
      )
    }
  }
  return {
    passed: findings.length === 0,
    findings,
    perDevice,
    routes,
    rateLimitRefusals,
  }
}

function checkLog(logPath, options) {
  return checkLogText(fs.readFileSync(logPath, "utf8"), options)
}

function readJsonFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    throw new LogCheckRefusal(`cannot read ${label}: ${error.message}`)
  }
}

function expectedDevicesFor(logPath, configDir) {
  const runFile = path.join(path.dirname(logPath), "run.json")
  if (fs.existsSync(runFile)) {
    const run = readJsonFile(runFile, runFile)
    if (
      !Array.isArray(run?.devices) ||
      !run.devices.every((id) => typeof id === "string" && id !== "")
    ) {
      throw new LogCheckRefusal(`${runFile} has no list of device ids`)
    }
    return run.devices
  }
  const devices = readJsonFile(
    path.join(configDir, "devices.json"),
    "devices.json",
  )
  return devices.devices.map((device) => device.id)
}

/** The `check-log <log>` mode: 0 passes, 1 has findings, 2 refuses. */
function checkLogCommand(command, options = {}) {
  const out = options.out ?? console.log
  const configDir = options.configDir ?? CONFIG_DIR
  const logPath = path.resolve(command.positionals[0])
  let result
  try {
    if (!fs.existsSync(logPath) || !fs.statSync(logPath).isFile()) {
      throw new LogCheckRefusal(`${logPath} is not a log file`)
    }
    result = checkLog(logPath, {
      operations: readJsonFile(
        path.join(configDir, "operations.json"),
        "operations.json",
      ),
      expectedDevices: expectedDevicesFor(logPath, configDir),
    })
  } catch (error) {
    if (!(error instanceof LogCheckRefusal)) throw error
    out(`release-check refused: ${error.message}.`)
    return EXIT.refused
  }
  const traffic = Object.entries(result.perDevice)
    .map(([deviceId, count]) => `${deviceId} ${count}`)
    .join(", ")
  if (result.passed) {
    out(`check-log passed (${traffic}).`)
    return EXIT.passed
  }
  out(`check-log failed with ${result.findings.length} finding(s):`)
  for (const item of result.findings) out(`- ${item.code}: ${item.message}`)
  return EXIT.failed
}

module.exports = { checkLog, checkLogCommand, checkLogText }
