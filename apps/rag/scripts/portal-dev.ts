/** Local-only UI development composition. Never imported by serve.ts. */
import { createServer } from "node:https"
import { readFileSync } from "node:fs"
import { getRequestListener } from "@hono/node-server"
import { Hono } from "hono"
import { setCookie } from "hono/cookie"

import { PrismaClient } from "../src/generated/prisma/index.js"
import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"
import { createPostgresSessionStore } from "../src/adapters/postgres/portal-sessions.js"
import { createApp } from "../src/serving/http/app.js"
import { randomToken } from "../src/serving/http/portal-token.js"
import { verifyConsumerRoles } from "./consumer-role-policy.js"

class PortalDevError extends Error {
  constructor(
    readonly code:
      | "local_database_required"
      | "isolated_local_database_required"
      | "local_tls_files_required"
      | "local_oauth_unavailable",
  ) {
    super(code)
    this.name = "PortalDevError"
  }
}

function localDatabase(value: string | undefined): string {
  if (!value) throw new PortalDevError("local_database_required")
  const url = new URL(value)
  if (
    url.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/forge_rag_portal_dev"
  )
    throw new PortalDevError("isolated_local_database_required")
  return value
}
const writer = new PrismaClient({
  datasourceUrl: localDatabase(process.env.RAG_CONSUMER_WRITER_DATABASE_URL),
})
const reader = new PrismaClient({
  datasourceUrl: localDatabase(process.env.RAG_CONSUMER_AUTH_DATABASE_URL),
})
const sessions = createPostgresSessionStore(
  localDatabase(process.env.RAG_PORTAL_SESSION_DATABASE_URL),
)
await verifyConsumerRoles(writer, reader)
const keyPath = process.env.RAG_PORTAL_DEV_TLS_KEY
const certPath = process.env.RAG_PORTAL_DEV_TLS_CERT
if (!keyPath || !certPath) throw new PortalDevError("local_tls_files_required")
const origin = "https://localhost:3445"
const users = [
  { id: 53001, login: "local-owner" },
  { id: 53002, login: "local-member" },
  { id: 53003, login: "local-other" },
]
const app = new Hono()
app.get("/portal/login", (c) => {
  c.header("Cache-Control", "no-store")
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  )
  return c.html(
    `<!doctype html><html lang="en"><title>Local portal sign-in</title><h1>Local development sign-in</h1><p>Synthetic identities. All consumer actions use the PostgreSQL backend.</p>${users.map((user) => `<form method="post" action="/local-sign-in"><input type="hidden" name="id" value="${user.id}"><button>Continue as ${user.login}</button></form>`).join("")}</html>`,
  )
})
app.post("/local-sign-in", async (c) => {
  c.header("Cache-Control", "no-store")
  if (c.req.header("origin") !== origin) return c.body(null, 403)
  const body = await c.req.parseBody()
  const user = users.find((entry) => String(entry.id) === body.id)
  if (!user) return c.body(null, 403)
  const token = randomToken()
  await sessions.createSession(token, user)
  setCookie(c, "__Host-rag_portal", token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 7200,
  })
  return c.redirect("/portal", 303)
})
app.route(
  "/",
  createApp({
    // Synthetic retrieval only; actual ops dogfood belongs to feat-529.
    retriever: { search: async () => [] },
    tokens: new Map(),
    consumerAuth: new PostgresConsumerAuthenticator(reader),
    portal: {
      origin,
      callbackUrl: origin + "/portal/callback",
      clientId: "local-only",
      sessions,
      consumers: new PostgresConsumerAccess(writer),
      allowedSourceKeys: ["synthetic-source"],
      admission: {
        current: async () => ({ sha: "5".repeat(40), allowlist: { users } }),
        eligible: async (identity) =>
          users.some(
            (user) => user.id === identity.id && user.login === identity.login,
          ),
        exchange: async () => {
          throw new PortalDevError("local_oauth_unavailable")
        },
      },
    },
  }),
)
const server = createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  getRequestListener(app.fetch),
)
server.listen(3445, "127.0.0.1", () => {
  console.log(
    "Local RAG portal: https://localhost:3445/portal (synthetic sign-in)",
  )
})
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void Promise.all([
        writer.$disconnect(),
        reader.$disconnect(),
        sessions.close(),
      ]).then(() => process.exit(0))
    })
  })
}
