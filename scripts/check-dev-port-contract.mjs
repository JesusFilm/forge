#!/usr/bin/env node

// Validate the resolved Compose model, not hand-parsed YAML. This keeps the
// host-access contract small and aligned with what Docker will actually run.
const EXPECTED_PORTS = new Map([
  [3000, 3000],
  [3002, 3002],
  [3003, 3003],
  [3004, 3004],
  [3005, 3005],
  [3010, 3010],
  [3011, 3011],
  [3012, 3012],
  [3100, 3100],
  [3200, 3200],
  [4111, 4111],
  [22, 2222],
])

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let compose
try {
  compose = JSON.parse(Buffer.concat(chunks).toString("utf8"))
} catch {
  console.error(
    "Unable to read resolved Compose JSON from stdin. Run: docker compose -f .devcontainer/docker-compose.yml config --format json | node scripts/check-dev-port-contract.mjs",
  )
  process.exit(1)
}

const errors = []
const app = compose.services?.app

if (app == null) {
  errors.push('Resolved Compose config must define the "app" service.')
} else {
  if (app.network_mode != null) {
    errors.push("services.app must use the Compose default bridge network.")
  }

  const appNetworks = Object.keys(app.networks ?? {})
  if (appNetworks.length !== 1 || appNetworks[0] !== "default") {
    errors.push('services.app must attach only to the "default" network.')
  }

  const defaultNetwork = compose.networks?.default
  if (defaultNetwork == null) {
    errors.push('Resolved Compose config must define the "default" network.')
  } else {
    if (defaultNetwork.external === true) {
      errors.push('The "default" network must not be external.')
    }
    if (defaultNetwork.driver != null && defaultNetwork.driver !== "bridge") {
      errors.push('The "default" network must use the bridge driver.')
    }
    if (Object.keys(defaultNetwork.driver_opts ?? {}).length > 0) {
      errors.push('The "default" network must not set driver options.')
    }
  }

  if (app.environment?.HOST !== "0.0.0.0") {
    errors.push('services.app.environment.HOST must be "0.0.0.0".')
  }
  if (app.environment?.MASTRA_HOST !== "0.0.0.0") {
    errors.push('services.app.environment.MASTRA_HOST must be "0.0.0.0".')
  }
  if (app.environment?.MASTRA_AUTO_DETECT_URL !== "true") {
    errors.push(
      'services.app.environment.MASTRA_AUTO_DETECT_URL must be "true".',
    )
  }

  const seen = new Map()
  for (const mapping of Array.isArray(app.ports) ? app.ports : []) {
    const target = Number(mapping.target)
    const published = Number(mapping.published)
    const expectedPublished = EXPECTED_PORTS.get(target)
    const label = `${mapping.host_ip ?? "<unset>"}:${published}:${target}`

    seen.set(target, (seen.get(target) ?? 0) + 1)
    if (expectedPublished == null) {
      errors.push(`Unexpected services.app port mapping ${label}.`)
      continue
    }
    if (published !== expectedPublished) {
      errors.push(
        `Port ${target} must publish as 127.0.0.1:${expectedPublished}:${target}; found ${label}.`,
      )
    }
    if (mapping.host_ip !== "127.0.0.1") {
      errors.push(`Port ${target} must bind to host loopback 127.0.0.1.`)
    }
    if (mapping.protocol !== "tcp") {
      errors.push(`Port ${target} must use TCP.`)
    }
    if (mapping.mode !== "ingress") {
      errors.push(`Port ${target} must use ingress mode.`)
    }
  }

  for (const [target, published] of EXPECTED_PORTS) {
    const count = seen.get(target) ?? 0
    if (count === 0) {
      errors.push(
        `Missing services.app mapping 127.0.0.1:${published}:${target}.`,
      )
    } else if (count > 1) {
      errors.push(`Port ${target} must be published exactly once.`)
    }
  }
}

if (errors.length > 0) {
  console.error("Development-port contract failed:")
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  "Development-port contract passed: app services are published on host loopback.",
)
