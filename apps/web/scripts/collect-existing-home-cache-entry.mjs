import { createRequire } from "node:module"
import { measureCacheEntry } from "./measure-cache-entry.mjs"

// Run in a separate diagnostic process on the existing Web container. Read one
// known route key, capped at 8 MiB. Never call the handler or render a request:
// either would introduce writes/regeneration. Emit only sanitized size facts.
if (
  process.env.RAILWAY_SERVICE_ID !== "23b82451-0da1-4edc-bcde-096a9fd2a687" ||
  process.env.RAILWAY_ENVIRONMENT_ID !== "5f41e037-90e4-4674-a3ea-66bbd05fb3b4"
) {
  throw new Error("Expected the specified Railway production Web environment")
}

const require = createRequire("/app/apps/web/package.json")
const { createClient } = require("redis")
const { getRouteCacheKey } = require("next/dist/server/lib/route-cache-key.js")
const client = createClient({
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
})
client.on("error", () => {})
const startedUtc = new Date().toISOString()
const deadline = setTimeout(() => {
  console.error("Cache size probe deadline exceeded")
  process.exit(1)
}, 10000)

try {
  await client.connect()
  const prefix = process.env.NEXT_CACHE_REDIS_PREFIX || "forge:web:next-cache:"
  const key = getRouteCacheKey("/en/en", {
    kind: "APP_PAGE",
    sourceRoute: "/[locale]/[htmlLang]/(content)/page",
  })
  const cap = 8 * 1024 * 1024
  const stored = await client.getRange(
    `${prefix.endsWith(":") ? prefix : `${prefix}:`}${key}`,
    0,
    cap,
  )
  if (!stored || Buffer.byteLength(stored) > cap) {
    throw new Error("Entry absent or above diagnostic cap")
  }
  const measurement = measureCacheEntry(stored)
  console.log(
    JSON.stringify({
      startedUtc,
      finishedUtc: new Date().toISOString(),
      deployment: process.env.RAILWAY_DEPLOYMENT_ID,
      replica: process.env.RAILWAY_REPLICA_ID,
      publicRoute: "/watch",
      internalRoute: "/en/en",
      query: "GETRANGE <configured-prefix><Next-route-cache-key> 0 8388608",
      measurement,
    }),
  )
} catch {
  console.error("Cache size probe failed; no payload or credentials emitted")
  process.exitCode = 1
} finally {
  client.destroy()
  clearTimeout(deadline)
}
