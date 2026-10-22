#!/usr/bin/env node
// The mobile release check (KTD13): node apps/mobile/release-check/cli.mjs <mode>.
// Not a package.json script, because the scripts block is a fingerprint input.
// Built-ins only until the preflight passes, so a bad setup gets a plain refusal.

import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE_DIR = path.resolve(HERE, "..")
const REQUIRED_NODE_MAJOR = 24
const REFUSED = 2

function preflightRefusal() {
  const major = Number(process.versions.node.split(".")[0])
  if (major < REQUIRED_NODE_MAJOR) {
    return `Node ${REQUIRED_NODE_MAJOR} or later is required, and this is Node ${process.versions.node}. Run \`nvm use\` at the repo root.`
  }
  if (!fs.existsSync(path.join(MOBILE_DIR, "node_modules"))) {
    return "apps/mobile/node_modules does not exist. Run `pnpm install` at the repo root."
  }
  return null
}

async function main() {
  const preflight = preflightRefusal()
  if (preflight) {
    console.error(`release-check refused: ${preflight}`)
    return REFUSED
  }
  const require = createRequire(import.meta.url)
  const contract = require("./lib/contract.js")
  const lifecycle = () => require("./lib/lifecycle.js")
  const withDeps = (name) => (command) => {
    const modes = lifecycle()
    return modes[name](command, modes.createDeps())
  }

  // A later unit adds its mode here; the parser reads only contract.MODES.
  const handlers = {
    plan: (command) =>
      require("./lib/plan.js").planCommand(command, lifecycle().createDeps()),
    setup: withDeps("setupMode"),
    run: withDeps("runCommand"),
    status: withDeps("statusCommand"),
    stop: withDeps("stopCommand"),
    recover: withDeps("recoverCommand"),
    "check-lists": (command) =>
      require("./lib/lists.js").checkListsCommand(command),
    "check-screens": (command) =>
      require("./lib/journeys/screens.js").checkScreensCommand(command),
    "check-build": (command) =>
      require("./lib/testBuild/artifactCheck.js").checkBuildCommand(command),
    "check-log": (command) =>
      require("./lib/server/logCheck.js").checkLogCommand(command),
    session: (command) => require("./lib/session.js").sessionCommand(command),
    "record-search": (command) =>
      require("./lib/server/record.js").recordSearchCommand(command),
  }

  const command = contract.parseArgs(process.argv.slice(2))
  if (!command.ok) {
    console.error(contract.formatRefusal(command))
    return contract.EXIT.refused
  }
  const handler = handlers[command.mode]
  if (!handler) {
    const label = [command.mode, command.subcommand].filter(Boolean).join(" ")
    console.error(
      `release-check refused: \`${label}\` is not built yet. Built modes: ${Object.keys(handlers).join(", ")}.`,
    )
    return contract.EXIT.refused
  }
  return handler(command)
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`release-check failed: ${error.stack ?? error.message}`)
  process.exitCode = 1
}
