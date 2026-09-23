import { Buffer } from "node:buffer"
const { Response } = globalThis
import { generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "./http.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const output = process.argv[2]
if (!output || !output.startsWith("/") || output.startsWith(`${root}/`))
  throw new Error(
    "Supply an absolute private output directory outside the checkout",
  )
const database = process.env.STUDIO_TEST_DATABASE_URL
if (
  database !== "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_fresh"
)
  throw new Error(
    "Only the task-owned guarded loopback qualification database is permitted",
  )
await mkdir(output, { recursive: true, mode: 0o700 })
const service = generateKeyPairSync("ed25519")
const issuer = generateKeyPairSync("rsa", { modulusLength: 2048 })
const origin = "http://127.0.0.1:55470"
const audience = "http://127.0.0.1:55471/mcp"
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")
const header = encode({ alg: "RS256", kid: "qualification-issuer" })
const claims = encode({
  iss: origin,
  aud: audience,
  sub: "shorts-local-qualification",
  client_id: "codex-local-qualification",
  scope: "shorts:read shorts:edit",
  "https://jesusfilm.org/claims/app": "shorts-mcp",
  "https://jesusfilm.org/claims/environment": "local",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
})
const token = `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), issuer.privateKey).toString("base64url")}`
await writeFile(resolve(output, "token"), token, { mode: 0o600 })
const bearer = randomBytes(32).toString("hex")
const config = {
  CI: "1",
  NODE_ENV: "test",
  DATABASE_URL: database,
  ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
  MANAGER_SESSION_SECRET: randomBytes(32).toString("hex"),
  MANAGER_ADMIN_API_KEY: bearer,
  ADMIN_MANAGER_API_KEY: bearer,
  AUTH_ISSUER_URL: origin,
  AUTH_MANAGER_CLIENT_ID: "local-manager",
  MANAGER_BASE_URL: "http://127.0.0.1:55471",
  ADMIN_GRAPHQL_URL: "http://127.0.0.1:55472/api/graphql",
  STUDIO_ENVIRONMENT: "local",
  STUDIO_MCP_AUDIENCE: audience,
  STUDIO_MCP_CLIENT_IDS: "codex-local-qualification",
  STUDIO_INTERACTIVE_KEY_ID: "qualification-service",
  STUDIO_INTERACTIVE_PRIVATE_KEY: service.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }),
  STUDIO_INTERACTIVE_PUBLIC_KEYS: JSON.stringify({
    "qualification-service": service.publicKey.export({
      type: "spki",
      format: "pem",
    }),
  }),
  STUDIO_PRODUCTION_ENABLED: "false",
  STUDIO_PUBLICATION_ENABLED: "false",
  STUDIO_AGENT_ENABLED: "false",
  STUDIO_RENDER_POOL_ENABLED: "false",
}
const configPath = resolve(output, "environment.json")
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
const server = serve(55470, {
  "GET /api/auth/jwks": () =>
    Response.json({
      keys: [
        {
          ...issuer.publicKey.export({ format: "jwk" }),
          kid: "qualification-issuer",
          alg: "RS256",
          use: "sig",
        },
      ],
    }),
})
const children = ["admin", "manager"].map((app) =>
  spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      "--tsconfig",
      "tsconfig.json",
      "scripts/studio-agent-local.ts",
      configPath,
      resolve(output, "mcp-audit.jsonl"),
    ],
    {
      cwd: resolve(root, "apps", app),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "1" },
      stdio: "inherit",
      detached: true,
    },
  ),
)
function stop() {
  for (const child of children) process.kill(-child.pid, "SIGTERM")
  server.close()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
console.log(
  `Local issuer only; token file ${resolve(output, "token")}. No production OAuth consent or browser UI proof.`,
)
