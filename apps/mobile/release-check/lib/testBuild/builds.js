"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const fs = require("node:fs")
const path = require("node:path")

const { ANDROID_ARTIFACT } = require("./buildAndroid")

const KEEP_BUILDS = 2

function iosArtifactIn(buildDir) {
  const dir = path.join(buildDir, "ios")
  if (!fs.existsSync(dir)) return null
  const apps = fs.readdirSync(dir).filter((name) => name.endsWith(".app"))
  return apps.length === 1 ? path.join(dir, apps[0]) : null
}

function artifactPath(buildDir, platform) {
  if (platform === "ios") return iosArtifactIn(buildDir)
  const apk = path.join(buildDir, ANDROID_ARTIFACT)
  return fs.existsSync(apk) ? apk : null
}

function pruneBuilds(home, keepCommit, now) {
  const buildsDir = path.join(home, "builds")
  if (!fs.existsSync(buildsDir)) return
  const current = path.join(buildsDir, keepCommit)
  if (fs.existsSync(current)) {
    const time = new Date(now)
    fs.utimesSync(current, time, time)
  }
  const others = fs
    .readdirSync(buildsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== keepCommit)
    .map((entry) => ({
      dir: path.join(buildsDir, entry.name),
      mtimeMs: fs.statSync(path.join(buildsDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const entry of others.slice(KEEP_BUILDS - 1)) {
    fs.rmSync(entry.dir, { recursive: true, force: true })
  }
}

module.exports = {
  artifactPath,
  pruneBuilds,
}
