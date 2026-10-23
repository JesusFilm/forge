"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// One `maestro test` process for each device and journey attempt (KTD7). The
// runner never passes `--analyze` or a cloud command, and every child gets a
// deadline, the run signal, and an environment it builds itself.

const fs = require("node:fs")
const path = require("node:path")

const { resolveOnPath, toolEnv } = require("../devices/inventory")
const { run } = require("../proc")

// The iOS lane runs one simulator at a time, so one runner port is enough.
// It is outside Maestro's default, so another session's driver cannot clash.
const IOS_DRIVER_HOST_PORT = 38220
const MAESTRO_ENV = Object.freeze({
  MAESTRO_CLI_NO_ANALYTICS: "1",
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
  MAESTRO_DISABLE_UPDATE_CHECK: "true",
})
const JUNIT_FILE = "junit.xml"
const DEBUG_DIR = "debug"
const LOG_FILE = "maestro.out.log"

class MaestroMissingError extends Error {
  constructor() {
    super(
      "Maestro is not on PATH and MAESTRO_BIN is not set; run `setup --check`",
    )
    this.name = "MaestroMissingError"
  }
}

/** MAESTRO_BIN when set, else `maestro` on the PATH of `env`. */
function maestroBinary(env) {
  if (env.MAESTRO_BIN) return env.MAESTRO_BIN
  const file = resolveOnPath("maestro", env.PATH)
  if (file) return file
  throw new MaestroMissingError()
}

// The arguments of one attempt. `deviceRef` is the simulator UDID or the
// emulator serial; `variables` become `-e KEY=VALUE`.
function maestroArgs({ platform, deviceRef, flowFile, outputDir, variables }) {
  const args = ["test", "--device", deviceRef]
  if (platform === "ios") {
    args.push("--driver-host-port", String(IOS_DRIVER_HOST_PORT))
  }
  args.push(
    "--format",
    "JUNIT",
    "--output",
    path.join(outputDir, JUNIT_FILE),
    "--debug-output",
    path.join(outputDir, DEBUG_DIR),
    "--flatten-debug-output",
    "--no-ansi",
  )
  for (const [key, value] of Object.entries(variables ?? {})) {
    args.push("-e", `${key}=${value}`)
  }
  args.push(flowFile)
  return args
}

/** The child environment: the device tool environment plus Maestro's switches. */
function maestroEnv(sourceEnv) {
  return toolEnv(sourceEnv, { ...MAESTRO_ENV })
}

/** Runs one attempt. Resolves the proc result; it never rejects for Maestro. */
async function runMaestro(options) {
  const runChild = options.runChild ?? run
  fs.mkdirSync(options.outputDir, { recursive: true })
  return runChild(maestroBinary(options.sourceEnv), maestroArgs(options), {
    env: maestroEnv(options.sourceEnv),
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    logFile: path.join(options.outputDir, LOG_FILE),
  })
}

module.exports = {
  DEBUG_DIR,
  IOS_DRIVER_HOST_PORT,
  JUNIT_FILE,
  maestroArgs,
  maestroEnv,
  runMaestro,
}
