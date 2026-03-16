#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const SOR_DIR = join(ROOT, "docs")
const REQUIRED_PATHS = [
  "README.md",
  "index.md",
  "migration-manifest.json",
  "templates/issue-template.md",
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
      if (!item.issueNumber) fail("Manifest item missing issueNumber.")
      if (!item.issueArtifact)
        fail(`Issue #${item.issueNumber} missing issueArtifact.`)
      if (!item.planArtifact)
        fail(`Issue #${item.issueNumber} missing planArtifact.`)
      if (!String(item.issueArtifact).includes("/issues/")) {
        fail(`Issue #${item.issueNumber} issueArtifact must be scope-grouped.`)
      }
      if (!String(item.planArtifact).includes("/plans/")) {
        fail(`Issue #${item.issueNumber} planArtifact must be scope-grouped.`)
      }
      try {
        const issueDoc = read(item.issueArtifact)
        const planDoc = read(item.planArtifact)
        if (!issueDoc.includes("## Background")) {
          fail(
            `Issue artifact missing Background section: ${item.issueArtifact}`,
          )
        }
        if (!issueDoc.includes("## Key review notes")) {
          fail(`Issue artifact missing Key review notes: ${item.issueArtifact}`)
        }
        if (!planDoc.includes("## Planned approach")) {
          fail(`Plan artifact missing Planned approach: ${item.planArtifact}`)
        }
      } catch {
        fail(`Manifest references missing file for issue #${item.issueNumber}.`)
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
    if (!index.includes("## Issue Artifacts")) {
      fail("index.md missing Issue Artifacts section.")
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
