// Dependency-free behavior tests for the devcontainer development-port contract.
// Run: node scripts/check-dev-port-contract.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEV_PORT_CONTRACT,
  validateDevPortContract,
} from "./check-dev-port-contract.mjs"

const EXPECTED_SERVICES = [
  ["Web", 3000],
  ["Manager", 3002],
  ["Admin", 3003],
  ["Auth", 3004],
  ["Mastra Gateway", 3005],
  ["YouTube Mapper", 3010],
  ["Crop Worker", 3011],
  ["Shorts Worker", 3012],
  ["Roadmap", 3100],
  ["Chat", 3200],
  ["Mastra", 4111],
]

const packageJson = (dev, extraScripts = {}) =>
  JSON.stringify({ scripts: { dev, ...extraScripts } })

const VALID_DEVCONTAINER = JSON.stringify({
  name: "Forge",
  dockerComposeFile: "docker-compose.yml",
  service: "app",
})

const VALID_SOURCE_FILES = {
  "apps/web/package.json": packageJson(
    "pnpm run generate:ui-locales && next dev --hostname 0.0.0.0 --port 3000",
  ),
  "apps/manager/package.json": packageJson(
    "next dev --hostname 0.0.0.0 --port 3002",
  ),
  "apps/admin/package.json": packageJson(
    "next dev --hostname 0.0.0.0 --port 3003",
    {
      "mastra:dev": "PORT=4111 mastra dev --dir src/mastra-playground",
    },
  ),
  "apps/admin/src/mastra/index.ts": "return new Mastra({ agents, workflows })",
  "apps/auth/package.json": packageJson(
    "next dev --hostname 0.0.0.0 --port 3004",
  ),
  "apps/mastra-gateway/package.json": packageJson(
    "next dev --hostname 0.0.0.0 --port 3005",
  ),
  "apps/roadmap/package.json": packageJson(
    "next dev --hostname 0.0.0.0 -p 3100 --turbopack",
  ),
  "apps/chat/package.json": packageJson("next dev --hostname 0.0.0.0 -p 3200"),
  "apps/mastra/package.json": packageJson(
    'PORT=4111 NODE_OPTIONS="--import tsx" mastra dev',
  ),
  "apps/mastra/src/mastra/index.ts":
    'export const mastra = new Mastra({ server: { studioBase: "/studio" } })',
  "apps/yt-video-mapper-backend/src/config/env.ts":
    "const envSchema = z.object({ PORT: z.coerce.number().int().positive().default(3010) })",
  "apps/yt-video-mapper-backend/src/server.ts":
    "createServer(handleRequest).listen(port, () => {})",
  "apps/crop-worker/src/config/env.ts":
    "const envSchema = z.object({ PORT: z.coerce.number().int().positive().default(3011) })",
  "apps/crop-worker/src/server.ts":
    "createServer(handleRequest).listen(port, () => {})",
  "apps/shorts-worker/src/config/env.ts":
    "const envSchema = z.object({ PORT: z.coerce.number().int().positive().default(3012) })",
  "apps/shorts-worker/src/server.ts":
    "createServer(handleRequest).listen(port, () => {})",
}

function defaultMappings() {
  return EXPECTED_SERVICES.map(
    ([, port]) => `      - "127.0.0.1:${port}:${port}"`,
  ).concat('      - "127.0.0.1:2222:22"')
}

function composeFixture({
  mappings = defaultMappings(),
  environment = [
    '      HOST: "0.0.0.0"',
    '      MASTRA_AUTO_DETECT_URL: "true"',
  ],
  appOptions = [],
  otherServices = [],
} = {}) {
  return [
    "services:",
    "  app:",
    ...appOptions,
    "    environment:",
    ...environment,
    "    ports:",
    ...mappings,
    "    command: sleep infinity",
    ...otherServices,
    "",
  ].join("\n")
}

function resolvedComposeFixture({
  ports = defaultMappings().map((line) => {
    const [hostIp, published, target] = line.match(/"(.+)"/)[1].split(":")
    return {
      mode: "ingress",
      host_ip: hostIp,
      target: Number(target),
      published,
      protocol: "tcp",
    }
  }),
  environment = {
    HOST: "0.0.0.0",
    MASTRA_AUTO_DETECT_URL: "true",
  },
  networkMode,
} = {}) {
  return JSON.stringify({
    services: {
      app: {
        environment,
        ports,
        ...(networkMode == null ? {} : { network_mode: networkMode }),
      },
    },
  })
}

function validate(overrides = {}) {
  return validateDevPortContract({
    composeText: composeFixture(),
    devcontainerText: VALID_DEVCONTAINER,
    resolvedComposeText: resolvedComposeFixture(),
    sourceFiles: { ...VALID_SOURCE_FILES },
    ...overrides,
  })
}

function expectInvalid(result, ...patterns) {
  assert.equal(result.status, "invalid")
  const output = result.errors.join("\n")
  for (const pattern of patterns) assert.match(output, pattern)
}

test("exports the one 11-service stable development-port inventory", () => {
  assert.deepEqual(
    DEV_PORT_CONTRACT.map(({ service, port }) => [service, port]),
    EXPECTED_SERVICES,
  )
  assert.equal(
    DEV_PORT_CONTRACT.flatMap(({ sources }) => sources).length,
    17,
    "Mastra owns two scripts plus two config sources, and each worker owns a default plus a listener source",
  )
})

test("accepts the complete Compose, devcontainer, and source contract", () => {
  assert.deepEqual(validate(), { status: "ok", errors: [] })
})

test("reports a missing app mapping with its service and port", () => {
  const mappings = defaultMappings().filter(
    (line) => !line.includes(":3003:3003"),
  )
  expectInvalid(
    validate({ composeText: composeFixture({ mappings }) }),
    /Admin.*3003.*missing/i,
  )
})

test("rejects duplicate exact app mappings", () => {
  const mappings = defaultMappings()
  mappings.push('      - "127.0.0.1:3000:3000"')
  expectInvalid(
    validate({ composeText: composeFixture({ mappings }) }),
    /Web.*3000.*(?:duplicate|exactly once)/i,
  )
})

for (const [label, replacement] of [
  ["omitted host", '      - "3002:3002"'],
  ["wildcard host", '      - "0.0.0.0:3002:3002"'],
]) {
  test(`rejects a ${label} publication`, () => {
    const mappings = defaultMappings().map((line) =>
      line.includes(":3002:3002") ? replacement : line,
    )
    expectInvalid(
      validate({ composeText: composeFixture({ mappings }) }),
      /Manager.*3002.*127\.0\.0\.1/i,
      /unsupported mapping/i,
    )
  })
}

for (const [label, replacement] of [
  ["translated host port", '      - "127.0.0.1:13000:3000"'],
  ["translated container target", '      - "127.0.0.1:3000:13000"'],
]) {
  test(`rejects a ${label}`, () => {
    const mappings = defaultMappings().map((line) =>
      line.includes(":3000:3000") ? replacement : line,
    )
    expectInvalid(
      validate({ composeText: composeFixture({ mappings }) }),
      /Web.*3000.*127\.0\.0\.1:3000:3000/i,
      /unsupported mapping/i,
    )
  })
}

test("a commented mapping does not satisfy the contract", () => {
  const mappings = defaultMappings().map((line) =>
    line.includes(":3010:3010") ? `      #${line.trimStart()}` : line,
  )
  expectInvalid(
    validate({ composeText: composeFixture({ mappings }) }),
    /YouTube Mapper.*3010.*missing/i,
  )
})

test("a matching mapping under another service does not satisfy app", () => {
  const mappings = defaultMappings().filter(
    (line) => !line.includes(":3010:3010"),
  )
  const otherServices = [
    "  mapper:",
    "    ports:",
    '      - "127.0.0.1:3010:3010"',
  ]
  expectInvalid(
    validate({
      composeText: composeFixture({ mappings, otherServices }),
    }),
    /YouTube Mapper.*3010.*missing/i,
  )
})

test("rejects a long-form wildcard publication beside the exact mapping", () => {
  const mappings = defaultMappings().concat(
    "      - target: 3002",
    "        published: 3002",
    '        host_ip: "0.0.0.0"',
  )
  expectInvalid(
    validate({ composeText: composeFixture({ mappings }) }),
    /unsupported mapping.*target: 3002/i,
  )
})

test("rejects an IPv6 wildcard publication beside the exact mapping", () => {
  const mappings = defaultMappings().concat('      - "[::]:3002:3002"')
  expectInvalid(
    validate({ composeText: composeFixture({ mappings }) }),
    /unsupported mapping.*\[::\]:3002:3002/i,
  )
})

test("rejects host networking", () => {
  expectInvalid(
    validate({
      composeText: composeFixture({ appOptions: ["    network_mode: host"] }),
    }),
    /network_mode.*must be omitted/i,
  )
})

for (const [label, composeText, pattern] of [
  [
    "YAML merge key",
    composeFixture({ appOptions: ["    <<: *app-defaults"] }),
    /services\.app\.<<.*not allowed/i,
  ],
  [
    "service extends",
    composeFixture({ appOptions: ["    extends:", "      service: base"] }),
    /services\.app\.extends.*not allowed/i,
  ],
  [
    "top-level include",
    `${composeFixture()}include:\n  - override.yml\n`,
    /Top-level Compose include.*not allowed/i,
  ],
]) {
  test(`rejects Compose indirection through ${label}`, () => {
    expectInvalid(validate({ composeText }), pattern)
  })
}

test("rejects host networking in the resolved Compose model", () => {
  expectInvalid(
    validate({
      resolvedComposeText: resolvedComposeFixture({ networkMode: "host" }),
    }),
    /Resolved services\.app\.network_mode.*must be omitted/i,
  )
})

test("rejects a wildcard publication in the resolved Compose model", () => {
  const resolved = JSON.parse(resolvedComposeFixture())
  resolved.services.app.ports[1].host_ip = "0.0.0.0"
  expectInvalid(
    validate({ resolvedComposeText: JSON.stringify(resolved) }),
    /resolved services\.app\.ports.*unsupported mapping.*0\.0\.0\.0:3002:3002/i,
  )
})

test("reports invalid resolved Compose JSON", () => {
  expectInvalid(
    validate({ resolvedComposeText: "{" }),
    /Resolved Compose input is not valid JSON/i,
  )
})

test("requires the approved loopback SSH publication", () => {
  const mappings = defaultMappings().filter(
    (line) => !line.includes(":2222:22"),
  )
  expectInvalid(
    validate({ composeText: composeFixture({ mappings }) }),
    /SSH.*127\.0\.0\.1:2222:22.*exactly once/i,
  )
})

test("rejects contracted editor forwardPorts", () => {
  const devcontainerText = JSON.stringify({ forwardPorts: [3000] })
  expectInvalid(validate({ devcontainerText }), /must not forward.*3000/i)
})

test("rejects contracted editor portsAttributes", () => {
  const devcontainerText = JSON.stringify({
    portsAttributes: { 3000: { label: "Forge Web" } },
  })
  expectInvalid(
    validate({ devcontainerText }),
    /must not configure portsAttributes.*3000/i,
  )
})

test("reports invalid devcontainer JSON", () => {
  expectInvalid(
    validate({ devcontainerText: "{" }),
    /devcontainer\.json is not valid JSON/i,
  )
})

for (const [label, value, pattern] of [
  [
    "another Compose file",
    "other.yml",
    /must select only docker-compose\.yml/i,
  ],
  [
    "multiple Compose files",
    ["docker-compose.yml", "override.yml"],
    /must select only docker-compose\.yml/i,
  ],
]) {
  test(`rejects devcontainer selection of ${label}`, () => {
    const devcontainerText = JSON.stringify({
      dockerComposeFile: value,
      service: "app",
    })
    expectInvalid(validate({ devcontainerText }), pattern)
  })
}

test("rejects a devcontainer service other than app", () => {
  const devcontainerText = JSON.stringify({
    dockerComposeFile: "docker-compose.yml",
    service: "db",
  })
  expectInvalid(validate({ devcontainerText }), /must select service app/i)
})

for (const [service, path] of [
  ["Web", "apps/web/package.json"],
  ["Manager", "apps/manager/package.json"],
  ["Admin", "apps/admin/package.json"],
  ["Auth", "apps/auth/package.json"],
  ["Mastra Gateway", "apps/mastra-gateway/package.json"],
  ["Roadmap", "apps/roadmap/package.json"],
  ["Chat", "apps/chat/package.json"],
]) {
  test(`reports ${service} Next dev-script port drift`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES }
    sourceFiles[path] = sourceFiles[path].replace(
      /(?:--port|-p) (?:3000|3002|3003|3004|3005|3100|3200)/,
      "--port 3999",
    )
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(`${service}.*${path.replaceAll("/", "\\/")}.*port`, "i"),
    )
  })

  test(`reports ${service} Next listener-host drift`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES }
    sourceFiles[path] = sourceFiles[path].replace(
      "--hostname 0.0.0.0",
      "--hostname 127.0.0.1",
    )
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(
        `${service}.*${path.replaceAll("/", "\\/")}.*0\\.0\\.0\\.0`,
        "i",
      ),
    )
  })
}

for (const [path, script] of [
  ["apps/admin/package.json", "mastra:dev"],
  ["apps/mastra/package.json", "dev"],
]) {
  test(`reports Mastra port drift in ${path}#${script}`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES }
    sourceFiles[path] = sourceFiles[path].replace("PORT=4111", "PORT=4999")
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(
        `Mastra.*${path.replaceAll("/", "\\/")}.*${script}.*4111`,
        "i",
      ),
    )
  })
}

for (const [name, value] of [
  ["HOST", "127.0.0.1"],
  ["MASTRA_AUTO_DETECT_URL", "false"],
]) {
  test(`rejects inline Mastra ${name} override`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES }
    sourceFiles["apps/admin/package.json"] = sourceFiles[
      "apps/admin/package.json"
    ].replace("PORT=4111", `PORT=4111 ${name}=${value}`)
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(`must not assign ${name}`),
    )
  })
}

for (const [path, source] of [
  [
    "apps/admin/src/mastra/index.ts",
    'return new Mastra({ server: { host: "localhost" } })',
  ],
  [
    "apps/mastra/src/mastra/index.ts",
    'return new Mastra({ server: {\n  host: "127.0.0.1"\n} })',
  ],
]) {
  test(`rejects Mastra source-level host override in ${path}`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES, [path]: source }
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(`Mastra.*${path.replaceAll("/", "\\/")}.*server\\.host`, "i"),
    )
  })
}

for (const [service, configPath, serverPath, port] of [
  [
    "YouTube Mapper",
    "apps/yt-video-mapper-backend/src/config/env.ts",
    "apps/yt-video-mapper-backend/src/server.ts",
    3010,
  ],
  [
    "Crop Worker",
    "apps/crop-worker/src/config/env.ts",
    "apps/crop-worker/src/server.ts",
    3011,
  ],
  [
    "Shorts Worker",
    "apps/shorts-worker/src/config/env.ts",
    "apps/shorts-worker/src/server.ts",
    3012,
  ],
]) {
  test(`reports ${service} worker-default drift`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES }
    sourceFiles[configPath] = sourceFiles[configPath].replace(
      `.default(${port})`,
      ".default(3999)",
    )
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(
        `${service}.*${configPath.replaceAll("/", "\\/")}.*${port}`,
        "i",
      ),
    )
  })

  test(`reports ${service} worker-listener drift`, () => {
    const sourceFiles = { ...VALID_SOURCE_FILES }
    sourceFiles[serverPath] = sourceFiles[serverPath].replace(
      "listen(port, ()",
      'listen(port, "127.0.0.1", ()',
    )
    expectInvalid(
      validate({ sourceFiles }),
      new RegExp(
        `${service}.*${serverPath.replaceAll("/", "\\/")}.*0\\.0\\.0\\.0`,
        "i",
      ),
    )
  })
}

test("reports a missing contracted source file", () => {
  const sourceFiles = { ...VALID_SOURCE_FILES }
  delete sourceFiles["apps/crop-worker/src/server.ts"]
  expectInvalid(
    validate({ sourceFiles }),
    /Crop Worker.*apps\/crop-worker\/src\/server\.ts.*missing/i,
  )
})

test("reports malformed package JSON", () => {
  const sourceFiles = { ...VALID_SOURCE_FILES, "apps/web/package.json": "{" }
  expectInvalid(
    validate({ sourceFiles }),
    /Web.*apps\/web\/package\.json.*not valid JSON/i,
  )
})

test("reports a missing required development script", () => {
  const sourceFiles = {
    ...VALID_SOURCE_FILES,
    "apps/mastra/package.json": JSON.stringify({ scripts: {} }),
  }
  expectInvalid(
    validate({ sourceFiles }),
    /Mastra.*apps\/mastra\/package\.json.*scripts\.dev.*missing/i,
  )
})

test("reports both missing Compose app environment contracts together", () => {
  const result = validate({
    composeText: composeFixture({ environment: [] }),
  })
  expectInvalid(result, /HOST.*0\.0\.0\.0/i, /MASTRA_AUTO_DETECT_URL.*true/i)
})

test("environment values under another service do not satisfy app", () => {
  const composeText = composeFixture({
    environment: [],
    otherServices: [
      "  mastra:",
      "    environment:",
      '      HOST: "0.0.0.0"',
      '      MASTRA_AUTO_DETECT_URL: "true"',
    ],
  })
  expectInvalid(
    validate({ composeText }),
    /HOST.*0\.0\.0\.0/i,
    /MASTRA_AUTO_DETECT_URL.*true/i,
  )
})
