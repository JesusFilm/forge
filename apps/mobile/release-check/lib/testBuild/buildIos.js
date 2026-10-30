"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The iOS test build: an ad-hoc signed Release build for the simulator. README
// section 4: a signed simulator build finishes background downloads, and an
// unsigned one most likely did not.

const fs = require("node:fs")
const path = require("node:path")

const { runStep, xcodeEnvLocal } = require("./env")

const PRODUCTS = "Build/Products/Release-iphonesimulator"

function xcodebuildArgs({ workspace, scheme, derivedDataPath }) {
  return [
    "-workspace",
    workspace,
    "-scheme",
    scheme,
    "-configuration",
    "Release",
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    derivedDataPath,
    "ARCHS=arm64",
    "CODE_SIGN_IDENTITY=-",
    "CODE_SIGNING_REQUIRED=YES",
    "CODE_SIGNING_ALLOWED=YES",
  ]
}

function failed(steps, failedStep) {
  return { platform: "ios", ok: false, artifact: null, steps, failedStep }
}

async function buildIos({
  mobileDir,
  env,
  buildDir,
  derivedDataPath,
  signal,
  timeouts,
}) {
  const steps = []
  const iosDir = path.join(mobileDir, "ios")
  const logDir = path.join(buildDir, "logs")
  fs.writeFileSync(path.join(iosDir, ".xcode.env.local"), xcodeEnvLocal(env))

  const pods = await runStep(steps, "ios-pod-install", "pod", ["install"], {
    cwd: iosDir,
    env,
    timeoutMs: timeouts.podInstall,
    logDir,
    signal,
  })
  if (!pods.step.ok) return failed(steps, pods.step.name)

  const workspaces = fs
    .readdirSync(iosDir)
    .filter((name) => name.endsWith(".xcworkspace"))
  if (workspaces.length !== 1) {
    steps.push({
      name: "ios-workspace",
      ok: false,
      error: `ios/ has ${workspaces.length} .xcworkspace folders; expected 1`,
    })
    return failed(steps, "ios-workspace")
  }
  const scheme = workspaces[0].replace(/\.xcworkspace$/, "")
  const xcodebuild = await runStep(
    steps,
    "ios-xcodebuild",
    "xcodebuild",
    xcodebuildArgs({ workspace: workspaces[0], scheme, derivedDataPath }),
    {
      cwd: iosDir,
      env,
      timeoutMs: timeouts.xcodebuild,
      logDir,
      signal,
    },
  )
  if (!xcodebuild.step.ok) return failed(steps, xcodebuild.step.name)

  // Derived data is reused across builds, so the run keeps its own copy.
  const built = path.join(derivedDataPath, PRODUCTS, `${scheme}.app`)
  const artifact = path.join(buildDir, "ios", `${scheme}.app`)
  fs.rmSync(artifact, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(artifact), { recursive: true })
  fs.cpSync(built, artifact, {
    recursive: true,
    verbatimSymlinks: true,
    mode: fs.constants.COPYFILE_FICLONE,
  })
  return { platform: "ios", ok: true, artifact, steps, failedStep: null }
}

module.exports = { buildIos }
