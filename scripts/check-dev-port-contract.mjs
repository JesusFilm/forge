#!/usr/bin/env node
// Guards the stable application ports used by the Compose-backed devcontainer.
// This script intentionally has no workspace dependencies so CI can run it
// without installing packages. validateDevPortContract() stays pure for the
// fixture suite; filesystem access is confined to the executable entrypoint.
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const nextScript = (path, script = "dev") => ({
  kind: "next-script",
  path,
  script,
})

const mastraScript = (path, script) => ({
  kind: "mastra-script",
  path,
  script,
})

const mastraConfig = (path) => ({ kind: "mastra-config", path })

const workerDefault = (path) => ({ kind: "worker-default", path })

const workerListener = (path) => ({ kind: "worker-listener", path })

const SSH_PORT_MAPPING = "127.0.0.1:2222:22"

export const DEV_PORT_CONTRACT = Object.freeze(
  [
    {
      service: "Web",
      port: 3000,
      sources: [nextScript("apps/web/package.json")],
    },
    {
      service: "Manager",
      port: 3002,
      sources: [nextScript("apps/manager/package.json")],
    },
    {
      service: "Admin",
      port: 3003,
      sources: [nextScript("apps/admin/package.json")],
    },
    {
      service: "Auth",
      port: 3004,
      sources: [nextScript("apps/auth/package.json")],
    },
    {
      service: "Mastra Gateway",
      port: 3005,
      sources: [nextScript("apps/mastra-gateway/package.json")],
    },
    {
      service: "YouTube Mapper",
      port: 3010,
      sources: [
        workerDefault("apps/yt-video-mapper-backend/src/config/env.ts"),
        workerListener("apps/yt-video-mapper-backend/src/server.ts"),
      ],
    },
    {
      service: "Crop Worker",
      port: 3011,
      sources: [
        workerDefault("apps/crop-worker/src/config/env.ts"),
        workerListener("apps/crop-worker/src/server.ts"),
      ],
    },
    {
      service: "Shorts Worker",
      port: 3012,
      sources: [
        workerDefault("apps/shorts-worker/src/config/env.ts"),
        workerListener("apps/shorts-worker/src/server.ts"),
      ],
    },
    {
      service: "Roadmap",
      port: 3100,
      sources: [nextScript("apps/roadmap/package.json")],
    },
    {
      service: "Chat",
      port: 3200,
      sources: [nextScript("apps/chat/package.json")],
    },
    {
      service: "Mastra",
      port: 4111,
      sources: [
        mastraScript("apps/admin/package.json", "mastra:dev"),
        mastraConfig("apps/admin/src/mastra/index.ts"),
        mastraScript("apps/mastra/package.json", "dev"),
        mastraConfig("apps/mastra/src/mastra/index.ts"),
      ],
    },
  ].map((entry) =>
    Object.freeze({
      ...entry,
      sources: Object.freeze(
        entry.sources.map((source) => Object.freeze(source)),
      ),
    }),
  ),
)

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0
}

function isActive(line) {
  const trimmed = line.trim()
  return trimmed !== "" && !trimmed.startsWith("#")
}

function blockAt(lines, index) {
  const indent = indentation(lines[index])
  let end = lines.length
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (isActive(lines[cursor]) && indentation(lines[cursor]) <= indent) {
      end = cursor
      break
    }
  }
  return { indent, start: index + 1, end }
}

function keyPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^\\s*${escaped}:\\s*(?:#.*)?$`)
}

function findTopLevelBlock(lines, key) {
  const pattern = keyPattern(key)
  const index = lines.findIndex(
    (line) => isActive(line) && indentation(line) === 0 && pattern.test(line),
  )
  return index === -1 ? undefined : blockAt(lines, index)
}

function findChildBlock(lines, parent, key) {
  if (parent == null) return undefined

  const activeChildren = lines
    .slice(parent.start, parent.end)
    .map((line, offset) => ({ line, index: parent.start + offset }))
    .filter(({ line }) => isActive(line) && indentation(line) > parent.indent)
  if (activeChildren.length === 0) return undefined

  const childIndent = Math.min(
    ...activeChildren.map(({ line }) => indentation(line)),
  )
  const pattern = keyPattern(key)
  const child = activeChildren.find(
    ({ line }) => indentation(line) === childIndent && pattern.test(line),
  )
  return child == null ? undefined : blockAt(lines, child.index)
}

function stripInlineComment(value) {
  let quote
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if ((character === '"' || character === "'") && value[index - 1] !== "\\") {
      quote = quote === character ? undefined : (quote ?? character)
    }
    if (character === "#" && quote == null) return value.slice(0, index).trim()
  }
  return value.trim()
}

function unquote(value) {
  const trimmed = stripInlineComment(value)
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function directChildIndent(lines, block) {
  if (block == null) return undefined
  const indents = lines
    .slice(block.start, block.end)
    .filter(isActive)
    .map(indentation)
    .filter((indent) => indent > block.indent)
  return indents.length === 0 ? undefined : Math.min(...indents)
}

function readPortMappings(lines, portsBlock) {
  const childIndent = directChildIndent(lines, portsBlock)
  if (childIndent == null) return []

  return lines
    .slice(portsBlock.start, portsBlock.end)
    .filter(
      (line) =>
        isActive(line) &&
        indentation(line) === childIndent &&
        line.trimStart().startsWith("-"),
    )
    .map((line) => unquote(line.trimStart().slice(1).trim()))
}

function readEnvironment(lines, environmentBlock) {
  const values = new Map()
  const childIndent = directChildIndent(lines, environmentBlock)
  if (childIndent == null) return values

  for (const line of lines.slice(
    environmentBlock.start,
    environmentBlock.end,
  )) {
    if (!isActive(line) || indentation(line) !== childIndent) continue
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (match != null) values.set(match[1], unquote(match[2]))
  }
  return values
}

function readChildValues(lines, parent, key) {
  const childIndent = directChildIndent(lines, parent)
  if (childIndent == null) return []

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`^\\s*${escaped}:\\s*(.*)$`)
  return lines
    .slice(parent.start, parent.end)
    .filter((line) => isActive(line) && indentation(line) === childIndent)
    .map((line) => line.match(pattern))
    .filter((match) => match != null)
    .map((match) => unquote(match[1]))
}

function validatePortMappings(mappings, context, errors) {
  const expectedAppMappings = DEV_PORT_CONTRACT.map(
    ({ port }) => `127.0.0.1:${port}:${port}`,
  )
  const approvedMappings = new Set([...expectedAppMappings, SSH_PORT_MAPPING])

  for (const mapping of mappings) {
    if (!approvedMappings.has(mapping)) {
      errors.push(
        `${context} contains unsupported mapping "${mapping}"; only the exact loopback application mappings and ${SSH_PORT_MAPPING} are allowed.`,
      )
    }
  }

  for (const { service, port } of DEV_PORT_CONTRACT) {
    const expected = `127.0.0.1:${port}:${port}`
    const exactCount = mappings.filter((mapping) => mapping === expected).length
    if (exactCount === 0) {
      errors.push(
        `${service} (${port}) mapping ${expected} is missing from ${context}.`,
      )
    } else if (exactCount > 1) {
      errors.push(
        `${service} (${port}) mapping ${expected} must appear exactly once in ${context}; found ${exactCount} duplicates.`,
      )
    }
  }

  const sshCount = mappings.filter(
    (mapping) => mapping === SSH_PORT_MAPPING,
  ).length
  if (sshCount !== 1) {
    errors.push(
      `SSH mapping ${SSH_PORT_MAPPING} must appear exactly once in ${context}; found ${sshCount}.`,
    )
  }
}

function validateCompose(composeText, errors) {
  const lines = composeText.split(/\r?\n/)
  const services = findTopLevelBlock(lines, "services")
  const app = findChildBlock(lines, services, "app")
  const mappings = readPortMappings(lines, findChildBlock(lines, app, "ports"))
  validatePortMappings(mappings, "services.app.ports", errors)

  if (readChildValues(lines, app, "network_mode").length > 0) {
    errors.push(
      "services.app.network_mode must be omitted; the devcontainer requires the default bridge isolation.",
    )
  }
  for (const key of ["<<", "extends"]) {
    if (readChildValues(lines, app, key).length > 0) {
      errors.push(
        `services.app.${key} is not allowed; keep the devcontainer service explicit and validate Compose's resolved model.`,
      )
    }
  }
  if (
    lines.some(
      (line) =>
        isActive(line) &&
        indentation(line) === 0 &&
        /^\s*include\s*:/.test(line),
    )
  ) {
    errors.push(
      "Top-level Compose include is not allowed; devcontainer configuration must stay in the validated Compose file.",
    )
  }

  const environment = readEnvironment(
    lines,
    findChildBlock(lines, app, "environment"),
  )
  if (environment.get("HOST") !== "0.0.0.0") {
    errors.push(
      "services.app.environment must set HOST=0.0.0.0 so Mastra listens beyond container loopback.",
    )
  }
  if (environment.get("MASTRA_AUTO_DETECT_URL") !== "true") {
    errors.push(
      "services.app.environment must set MASTRA_AUTO_DETECT_URL=true so Studio uses the browser page origin.",
    )
  }
}

function validateResolvedCompose(resolvedComposeText, errors) {
  let resolved
  try {
    resolved = JSON.parse(resolvedComposeText)
  } catch (error) {
    errors.push(`Resolved Compose input is not valid JSON: ${error.message}`)
    return
  }

  const app = resolved?.services?.app
  if (app == null || typeof app !== "object") {
    errors.push("Resolved Compose model must contain services.app.")
    return
  }

  if (app.network_mode != null) {
    errors.push(
      "Resolved services.app.network_mode must be omitted; the devcontainer requires the default bridge isolation.",
    )
  }

  const mappings = Array.isArray(app.ports)
    ? app.ports.map((port) => {
        if (
          port != null &&
          typeof port === "object" &&
          port.protocol === "tcp" &&
          port.mode === "ingress"
        ) {
          return `${port.host_ip}:${port.published}:${port.target}`
        }
        return `unrecognized resolved port ${JSON.stringify(port)}`
      })
    : []
  validatePortMappings(mappings, "resolved services.app.ports", errors)

  if (app.environment?.HOST !== "0.0.0.0") {
    errors.push(
      "Resolved services.app.environment must set HOST=0.0.0.0 so Mastra listens beyond container loopback.",
    )
  }
  if (app.environment?.MASTRA_AUTO_DETECT_URL !== "true") {
    errors.push(
      "Resolved services.app.environment must set MASTRA_AUTO_DETECT_URL=true so Studio uses the browser page origin.",
    )
  }
}

function validateDevcontainer(devcontainerText, errors) {
  let devcontainer
  try {
    devcontainer = JSON.parse(devcontainerText)
  } catch (error) {
    errors.push(
      `.devcontainer/devcontainer.json is not valid JSON: ${error.message}`,
    )
    return
  }

  if (devcontainer?.dockerComposeFile !== "docker-compose.yml") {
    errors.push(
      ".devcontainer/devcontainer.json must select only docker-compose.yml so the validated Compose model is the model Dev Containers runs.",
    )
  }
  if (devcontainer?.service !== "app") {
    errors.push(
      ".devcontainer/devcontainer.json must select service app, which owns the stable development-port publications.",
    )
  }

  const contractedPorts = new Set(DEV_PORT_CONTRACT.map(({ port }) => port))
  const forwardPorts = Array.isArray(devcontainer.forwardPorts)
    ? devcontainer.forwardPorts
    : []
  for (const value of forwardPorts) {
    const ports = String(value).match(/\d+/g)?.map(Number) ?? []
    for (const port of ports) {
      if (contractedPorts.has(port)) {
        errors.push(
          `.devcontainer/devcontainer.json must not forward contracted port ${port}; Compose is the only publication mechanism.`,
        )
      }
    }
  }

  for (const key of Object.keys(devcontainer.portsAttributes ?? {})) {
    const ports = key.match(/\d+/g)?.map(Number) ?? []
    for (const port of ports) {
      if (contractedPorts.has(port)) {
        errors.push(
          `.devcontainer/devcontainer.json must not configure portsAttributes for contracted port ${port}.`,
        )
      }
    }
  }
}

function sourceText(sourceFiles, source, service, port, errors) {
  const text =
    sourceFiles instanceof Map
      ? sourceFiles.get(source.path)
      : sourceFiles?.[source.path]
  if (typeof text !== "string") {
    errors.push(
      `${service} (${port}) source ${source.path} is missing from the validation input.`,
    )
    return undefined
  }
  return text
}

function packageScript(text, source, service, port, errors) {
  let packageFile
  try {
    packageFile = JSON.parse(text)
  } catch (error) {
    errors.push(
      `${service} (${port}) source ${source.path} is not valid JSON: ${error.message}`,
    )
    return undefined
  }

  const script = packageFile.scripts?.[source.script]
  if (typeof script !== "string") {
    errors.push(
      `${service} (${port}) source ${source.path}#scripts.${source.script} is missing.`,
    )
    return undefined
  }
  return script
}

function nextPorts(script) {
  return [
    ...script.matchAll(/(?:^|\s)(?:--port|-p)(?:=|\s+)(\d+)(?=$|\s|&&|[;|])/g),
  ].map((match) => Number(match[1]))
}

function nextHosts(script) {
  return [
    ...script.matchAll(
      /(?:^|\s)(?:--hostname|-H)(?:=|\s+)([^\s;&|]+)(?=$|\s|&&|[;|])/g,
    ),
  ].map((match) => match[1].replace(/^['"]|['"]$/g, ""))
}

function mastraPorts(script) {
  return [...script.matchAll(/(?:^|\s)PORT=(\d+)(?=$|\s|&&|[;|])/g)].map(
    (match) => Number(match[1]),
  )
}

function environmentAssignments(script, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [
    ...script.matchAll(
      new RegExp(`(?:^|\\s)${escaped}=([^\\s;&|]+)(?=$|\\s|&&|[;|])`, "g"),
    ),
  ].map((match) => match[1])
}

function validateSource(entry, source, sourceFiles, errors) {
  const text = sourceText(
    sourceFiles,
    source,
    entry.service,
    entry.port,
    errors,
  )
  if (text == null) return

  if (source.kind === "worker-default") {
    const match = text.match(/\bPORT\s*:[\s\S]{0,240}?\.default\(\s*(\d+)\s*\)/)
    if (match == null || Number(match[1]) !== entry.port) {
      const found = match == null ? "no PORT default" : `default ${match[1]}`
      errors.push(
        `${entry.service} source ${source.path} must keep development port ${entry.port}; found ${found}.`,
      )
    }
    return
  }

  if (source.kind === "worker-listener") {
    const listenCalls = [...text.matchAll(/\.listen\s*\(/g)].length
    const listenerHosts = [
      ...text.matchAll(/\.listen\(\s*port\s*,\s*(["'])([^"']+)\1\s*,/g),
    ].map((match) => match[2])
    const defaultListeners = [
      ...text.matchAll(/\.listen\(\s*port\s*,\s*\(\s*\)\s*=>/g),
    ].length
    if (
      listenCalls !== 1 ||
      (defaultListeners !== 1 &&
        (listenerHosts.length !== 1 || listenerHosts[0] !== "0.0.0.0"))
    ) {
      const found =
        listenerHosts.length === 0 && defaultListeners === 0
          ? "an unrecognized listener signature"
          : listenerHosts.join(", ")
      errors.push(
        `${entry.service} source ${source.path} must use Node's all-interface default listener or explicit 0.0.0.0; found ${found}.`,
      )
    }
    return
  }

  if (source.kind === "mastra-config") {
    const sourceHostOverride =
      /^\s*host\s*:/m.test(text) ||
      /\bserver\s*:\s*\{[^}\n]*\bhost\s*:/.test(text)
    if (sourceHostOverride) {
      errors.push(
        `${entry.service} source ${source.path} must not set server.host; keep the Mastra bind policy Compose-scoped.`,
      )
    }
    return
  }

  const script = packageScript(text, source, entry.service, entry.port, errors)
  if (script == null) return

  if (source.kind === "next-script") {
    const ports = nextPorts(script)
    const hosts = nextHosts(script)
    if (
      !/\bnext\s+dev\b/.test(script) ||
      ports.length !== 1 ||
      ports[0] !== entry.port ||
      hosts.length !== 1 ||
      hosts[0] !== "0.0.0.0"
    ) {
      const foundPort =
        ports.length === 0 ? "no explicit port" : `port ${ports.join(", ")}`
      const foundHost =
        hosts.length === 0
          ? "no explicit hostname"
          : `hostname ${hosts.join(", ")}`
      errors.push(
        `${entry.service} source ${source.path}#scripts.${source.script} must pin next dev to 0.0.0.0:${entry.port}; found ${foundHost}, ${foundPort}.`,
      )
    }
    return
  }

  if (source.kind === "mastra-script") {
    const ports = mastraPorts(script)
    if (
      !/\bmastra\s+dev\b/.test(script) ||
      ports.length !== 1 ||
      ports[0] !== entry.port
    ) {
      const found = ports.length === 0 ? "no PORT assignment" : ports.join(", ")
      errors.push(
        `${entry.service} source ${source.path}#scripts.${source.script} must pin development port ${entry.port} with PORT=${entry.port}; found ${found}.`,
      )
    }
    for (const name of ["HOST", "MASTRA_AUTO_DETECT_URL"]) {
      if (environmentAssignments(script, name).length > 0) {
        errors.push(
          `${entry.service} source ${source.path}#scripts.${source.script} must not assign ${name}; keep the Mastra bind/origin policy Compose-scoped.`,
        )
      }
    }
  }
}

// Pure: validate raw Compose text and an object/Map of repository source text.
// Returns every violation together so one CI run describes the complete drift.
export function validateDevPortContract({
  composeText,
  devcontainerText,
  resolvedComposeText,
  sourceFiles,
}) {
  const errors = []
  if (typeof composeText !== "string") {
    errors.push("Compose input must be provided as text.")
  } else {
    validateCompose(composeText, errors)
  }
  if (typeof devcontainerText !== "string") {
    errors.push("Devcontainer input must be provided as text.")
  } else {
    validateDevcontainer(devcontainerText, errors)
  }
  if (resolvedComposeText != null) {
    if (typeof resolvedComposeText !== "string") {
      errors.push("Resolved Compose input must be provided as text.")
    } else {
      validateResolvedCompose(resolvedComposeText, errors)
    }
  }

  for (const entry of DEV_PORT_CONTRACT) {
    for (const source of entry.sources) {
      validateSource(entry, source, sourceFiles, errors)
    }
  }

  return { status: errors.length === 0 ? "ok" : "invalid", errors }
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const sourcePaths = new Set(
    DEV_PORT_CONTRACT.flatMap(({ sources }) => sources.map(({ path }) => path)),
  )
  const sourceFiles = Object.fromEntries(
    [...sourcePaths].map((path) => [
      path,
      readRepositoryFile(join(repoRoot, path)),
    ]),
  )
  const composeText = readRepositoryFile(
    join(repoRoot, ".devcontainer/docker-compose.yml"),
  )
  const devcontainerText = readRepositoryFile(
    join(repoRoot, ".devcontainer/devcontainer.json"),
  )
  const resolvedComposeText = process.argv.includes("--resolved-compose-stdin")
    ? readFileSync(0, "utf8")
    : undefined
  const result = validateDevPortContract({
    composeText,
    devcontainerText,
    resolvedComposeText,
    sourceFiles,
  })

  if (result.status === "invalid") {
    console.error(
      `dev-port contract FAILED — ${result.errors.length} violation(s):\n${result.errors
        .map((error) => `  - ${error}`)
        .join("\n")}`,
    )
    process.exitCode = 1
    return
  }

  console.log(
    `dev-port contract OK — ${DEV_PORT_CONTRACT.length} stable app ports match Compose and repository sources.`,
  )
}

function readRepositoryFile(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  main()
}
