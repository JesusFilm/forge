"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// How a test build child runs (R6, R33): an allowlist from the parent shell
// plus the committed test settings, and one record per build step. No other
// EXPO_* value passes, so a developer's shell cannot put a key into a build.

const fs = require("node:fs")
const path = require("node:path")

const { run } = require("../proc")

const PASSTHROUGH_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "DEVELOPER_DIR",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "RBENV_ROOT",
  "RBENV_VERSION",
  "GEM_HOME",
  "GEM_PATH",
])

const STEP_TAIL_BYTES = 16 * 1024

class TestBuildError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "TestBuildError"
    this.code = code
  }
}

function settingValues(settings) {
  const values = {}
  for (const [key, value] of Object.entries(
    settings.copiedFromProduction ?? {},
  )) {
    if (value !== null) values[key] = value
  }
  Object.assign(values, settings.testValue ?? {})
  for (const key of settings.mustBeUnset ?? []) delete values[key]
  return values
}

function buildEnv({ parentEnv, settings, tmpDir, javaHome, androidHome }) {
  const env = {}
  for (const key of PASSTHROUGH_KEYS) {
    const value = parentEnv[key]
    if (typeof value === "string" && value !== "") env[key] = value
  }
  if (androidHome) env.ANDROID_HOME = androidHome
  if (javaHome) env.JAVA_HOME = javaHome
  return {
    ...env,
    // CocoaPods stops on a locale that is not UTF-8.
    LANG: "en_US.UTF-8",
    CI: "1",
    EXPO_NO_DOTENV: "1",
    TMPDIR: tmpDir,
    ...settingValues(settings),
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** `ios/.xcode.env.local`: Xcode's bundle phase reads the same EXPO_* values. */
function xcodeEnvLocal(env) {
  const lines = Object.keys(env)
    .filter((key) => key.startsWith("EXPO_"))
    .sort()
    .map((key) => `export ${key}=${shellQuote(env[key])}`)
  return [
    "# Written by the mobile release check for one test build.",
    ...lines,
    "",
  ].join("\n")
}

function defaultAndroidHome(parentEnv) {
  return (
    parentEnv.ANDROID_HOME ||
    parentEnv.ANDROID_SDK_ROOT ||
    path.join(parentEnv.HOME ?? "", "Library/Android/sdk")
  )
}

async function resolveJavaHome(parentEnv) {
  const result = await run("/usr/libexec/java_home", ["-v", "17"], {
    env: { PATH: "/usr/bin:/bin", HOME: parentEnv.HOME ?? "" },
    timeoutMs: 30_000,
  })
  const javaHome = result.stdout.trim()
  if (result.code !== 0 || javaHome === "") {
    throw new TestBuildError(
      "java_missing",
      "Java 17 is not installed. Install a JDK 17 (the spike used Amazon Corretto 17).",
    )
  }
  return javaHome
}

// The full output goes to `<logDir>/<name>.log`; the step record keeps a tail.
async function runStep(steps, name, command, args, options) {
  const { cwd, env, timeoutMs, logDir, signal } = options
  fs.mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, `${name}.log`)
  const result = await run(command, args, {
    cwd,
    env,
    timeoutMs,
    logFile,
    signal,
    tailBytes: STEP_TAIL_BYTES,
  })
  const step = {
    name,
    ok: result.code === 0 && !result.timedOut && !result.stopped,
    code: result.code,
    timedOut: result.timedOut,
    stopped: result.stopped,
    durationMs: result.durationMs,
    logFile,
    error: result.error,
    tail: `${result.stdout.slice(-2048)}${result.stderr.slice(-2048)}`,
  }
  steps.push(step)
  return { step, result }
}

module.exports = {
  TestBuildError,
  buildEnv,
  defaultAndroidHome,
  resolveJavaHome,
  runStep,
  settingValues,
  xcodeEnvLocal,
}
