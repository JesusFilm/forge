// Test stand-in for a web script that predates the caller options (R19). The
// command must refuse to call it, so this file only logs that it ran.

import fs from "node:fs"

// The flags the script knew before U1: no --policy, --contexts, or --stop-on-quota.
const KNOWN_FLAGS = [
  "--messages-dir",
  "--inventory",
  "--manifest",
  "--progress",
  "--locales",
  "--model",
  "--concurrency",
  "--max-attempts",
]

fs.appendFileSync(
  process.env.FAKE_WEB_LOG,
  `${JSON.stringify({ script: "without-caller-options", knownFlags: KNOWN_FLAGS, argv: process.argv.slice(2) })}\n`,
)
