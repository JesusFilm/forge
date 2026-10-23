"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The Android test build: a Release APK for the arm64 emulators. The lint
// tasks add minutes and check nothing that the release check needs.

const fs = require("node:fs")
const path = require("node:path")

const { runStep } = require("./env")

const APK = "app/build/outputs/apk/release/app-release.apk"
const ANDROID_ARTIFACT = path.join("android", "app-release.apk")

const GRADLE_ARGS = Object.freeze([
  "--no-daemon",
  "-Dorg.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=2g",
  ":app:assembleRelease",
  "-PreactNativeArchitectures=arm64-v8a",
  "-x",
  "lintVitalAnalyzeRelease",
  "-x",
  "lintVitalReportRelease",
  "-x",
  "lintVitalRelease",
])

async function buildAndroid({ mobileDir, env, buildDir, signal, timeouts }) {
  const steps = []
  const androidDir = path.join(mobileDir, "android")
  const gradle = await runStep(
    steps,
    "android-gradle",
    "./gradlew",
    [...GRADLE_ARGS],
    {
      cwd: androidDir,
      env,
      timeoutMs: timeouts.gradle,
      logDir: path.join(buildDir, "logs"),
      signal,
    },
  )
  if (!gradle.step.ok) {
    return {
      platform: "android",
      ok: false,
      artifact: null,
      steps,
      failedStep: gradle.step.name,
    }
  }
  // The next prebuild deletes android/, so the run keeps its own copy.
  const artifact = path.join(buildDir, ANDROID_ARTIFACT)
  fs.mkdirSync(path.dirname(artifact), { recursive: true })
  fs.copyFileSync(
    path.join(androidDir, APK),
    artifact,
    fs.constants.COPYFILE_FICLONE,
  )
  return { platform: "android", ok: true, artifact, steps, failedStep: null }
}

module.exports = { ANDROID_ARTIFACT, buildAndroid }
