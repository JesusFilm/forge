"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// Reads one attempt's Maestro output (README section 2). Step labels, status,
// times, and errors are only in `<debug-output>/<flow name>/commands.json`;
// the JUnit file has the failure text and no labels.

const fs = require("node:fs")
const path = require("node:path")

const { DEBUG_DIR, JUNIT_FILE } = require("./maestro")

const SCREEN_ID = /^screen-(.+)$/
const SETUP_COMMANDS = new Set([
  "defineVariablesCommand",
  "applyConfigurationCommand",
])
const XML_ENTITIES = Object.freeze({
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
})

/** The `commands.json` of the one flow in an attempt's debug folder, or null. */
function commandsFile(outputDir) {
  const debugDir = path.join(outputDir, DEBUG_DIR)
  if (!fs.existsSync(debugDir)) return null
  for (const entry of fs.readdirSync(debugDir, { withFileTypes: true })) {
    const file = path.join(debugDir, entry.name, "commands.json")
    if (entry.isDirectory() && fs.existsSync(file)) return file
  }
  return null
}

function visibleTarget(command) {
  const visible = command?.condition?.visible
  if (!visible) return null
  const screen =
    typeof visible.idRegex === "string"
      ? (visible.idRegex.match(SCREEN_ID)?.[1] ?? null)
      : null
  const text = typeof visible.textRegex === "string" ? visible.textRegex : null
  return screen || text ? { screen, text } : null
}

/** One entry of `commands.json` in the runner's shape. */
function readCommand(entry) {
  const type = Object.keys(entry?.command ?? {})[0] ?? "unknown"
  const body = entry?.command?.[type] ?? {}
  const meta = entry?.metadata ?? {}
  const label =
    typeof body.label === "string" && body.label.trim() !== ""
      ? body.label
      : null
  return {
    type,
    label,
    status: meta.status ?? null,
    ms: Number.isFinite(meta.duration) ? meta.duration : 0,
    depth: meta.depth ?? 0,
    timestamp: meta.timestamp ?? null,
    error: meta.error?.message ?? null,
    visible: type === "assertConditionCommand" ? visibleTarget(body) : null,
    screenshot:
      (meta.artifacts ?? []).find((artifact) => artifact.type === "SCREENSHOT")
        ?.path ?? null,
  }
}

function decodeXml(text) {
  return text.replace(
    /&(lt|gt|quot|apos|amp);/g,
    (entity) => XML_ENTITIES[entity],
  )
}

/** The first `<failure>` text of the JUnit file, or null. */
function junitFailure(outputDir) {
  const file = path.join(outputDir, JUNIT_FILE)
  if (!fs.existsSync(file)) return null
  const match = fs
    .readFileSync(file, "utf8")
    .match(/<failure[^>]*>([\s\S]*?)<\/failure>/)
  return match ? decodeXml(match[1]).trim() || null : null
}

// The attempt's steps as Maestro ran them: the failed command, the step
// times, the failure screenshot (absolute), and the visible targets reached.
function readAttemptOutput(outputDir) {
  const file = commandsFile(outputDir)
  let commands = []
  let unreadable = null
  if (file) {
    try {
      commands = JSON.parse(fs.readFileSync(file, "utf8")).map(readCommand)
    } catch (error) {
      unreadable = `commands.json cannot be read: ${error.message}`
    }
  }
  const failed = commands.find((command) => command.status === "FAILED") ?? null
  const flowDir = file ? path.dirname(file) : null
  return {
    commands,
    failed,
    unreadable,
    stepTimes: commands
      .filter(
        (command) =>
          command.label !== null &&
          (command.status === "COMPLETED" || command.status === "FAILED"),
      )
      .map((command) => ({ label: command.label, ms: command.ms })),
    screenshot:
      failed?.screenshot && flowDir
        ? path.join(flowDir, failed.screenshot)
        : null,
    reached: commands
      .filter((command) => command.status === "COMPLETED" && command.visible)
      .map((command) => command.visible),
    junitFailure: junitFailure(outputDir),
  }
}

/** The screen ids that completed assertions reached, hand-list texts included. */
function screensReachedFrom(reached, handEntries) {
  const screens = new Set()
  for (const target of reached) {
    if (target.screen) screens.add(target.screen)
    const hand = (handEntries ?? []).find(
      (entry) => entry.match === target.text,
    )
    if (hand) screens.add(hand.id)
  }
  return [...screens].sort()
}

// The labels of the top-level steps that did not run, in flow order (R37).
// Maestro writes one depth-0 entry for each top-level step that started, after
// its own two set-up entries, so the count of those entries finds the step.
function notRunLabels(flow, commands) {
  const failedAt = commands.findIndex((command) => command.status === "FAILED")
  const upTo = failedAt < 0 ? commands : commands.slice(0, failedAt + 1)
  const started = upTo.filter(
    (command) => command.depth === 0 && !SETUP_COMMANDS.has(command.type),
  ).length
  return flow.topLevel
    .slice(started)
    .map((step) => step.label)
    .filter(Boolean)
}

// The simulator and logcat copies are 7 to 72 MB for each attempt (measured
// 2026-10-22), and the runner reads crashes from their own sources.
function pruneDeviceLogs(outputDir) {
  const debugDir = path.join(outputDir, DEBUG_DIR)
  if (!fs.existsSync(debugDir)) return
  for (const entry of fs.readdirSync(debugDir, { withFileTypes: true })) {
    const logs = path.join(debugDir, entry.name, "logs")
    if (!entry.isDirectory() || !fs.existsSync(logs)) continue
    for (const name of fs.readdirSync(logs)) {
      if (name.startsWith("device-")) fs.rmSync(path.join(logs, name))
    }
  }
}

module.exports = {
  commandsFile,
  junitFailure,
  notRunLabels,
  pruneDeviceLogs,
  readAttemptOutput,
  readCommand,
  screensReachedFrom,
}
