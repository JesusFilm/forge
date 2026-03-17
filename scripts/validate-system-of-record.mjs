#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const SOR_DIR = join(ROOT, "docs")
const REQUIRED_PATHS = [
  "README.md",
  "index.md",
  "migration-manifest.json",
  "templates/plan-template.md",
]

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function read(path) {
  return readFileSync(join(SOR_DIR, path), "utf8")
}

function validateRequiredFiles() {
  for (const relativePath of REQUIRED_PATHS) {
    try {
      read(relativePath)
    } catch {
      fail(`Missing required file: docs/${relativePath}`)
    }
  }
}

function validateManifest() {
  try {
    const manifest = JSON.parse(read("migration-manifest.json"))
    if (manifest.version !== 1) fail("Manifest version must be 1.")
    if (!Array.isArray(manifest.items)) fail("Manifest items must be an array.")
    for (const item of manifest.items || []) {
      if (!item.sourceId) fail("Manifest item missing sourceId.")
      if (!item.planArtifact)
        fail(`Item #${item.sourceId} missing planArtifact.`)
      if (!String(item.planArtifact).includes("/plans/")) {
        fail(`Item #${item.sourceId} planArtifact must be scope-grouped.`)
      }
      try {
        const planDoc = read(item.planArtifact)
        if (!planDoc.includes("## Planned approach")) {
          fail(`Plan artifact missing Planned approach: ${item.planArtifact}`)
        }
        if (!planDoc.includes("## Review notes")) {
          fail(`Plan artifact missing Review notes: ${item.planArtifact}`)
        }
      } catch {
        fail(`Manifest references missing file for item #${item.sourceId}.`)
      }
    }
  } catch {
    fail("Unable to parse migration-manifest.json.")
  }
}

function validateIndex() {
  try {
    const index = read("index.md")
    if (!index.includes("## Summary")) fail("index.md missing Summary section.")
    if (!index.includes("## Scope Breakdown")) {
      fail("index.md missing Scope Breakdown section.")
    }
    if (!index.includes("## Plan Artifacts")) {
      fail("index.md missing Plan Artifacts section.")
    }
  } catch {
    fail("Unable to read index.md.")
  }
}

validateRequiredFiles()
validateManifest()
validateIndex()

if (!process.exitCode) {
  console.log("System-of-record validation passed.")
}
