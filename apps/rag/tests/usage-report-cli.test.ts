import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { expect, it } from "vitest"
const exec = promisify(execFile)
it("CLI prints recorded counts without coverage and fails on an actual read error", async () => {
  let failed = false
  const app = new Hono().get("/", (c) =>
    failed
      ? c.json({ error: "usage_unavailable" }, 503)
      : c.json({
          consumerId: "00000000-0000-4000-8000-000000000528",
          label: "ragbot",
          windowStart: "2026-09-22T05:17:00.000Z",
          windowEnd: "2026-09-29T05:17:00.000Z",
          requestCount: 5,
          successfulRequestCount: 5,
          lastActivityAt: "2026-09-29T03:41:32.000Z",
          generatedAt: "2026-09-29T06:00:00.000Z",
        }),
  )
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  )
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("synthetic server unavailable")
  const options = {
    env: {
      ...process.env,
      RAG_USAGE_REPORT_URL: `http://127.0.0.1:${address.port}/`,
      RAG_USAGE_REPORT_SECRET: "synthetic-report-only",
    },
  }
  const args = [
    "--import",
    "tsx",
    "scripts/usage-report.ts",
    "--consumer",
    "00000000-0000-4000-8000-000000000528",
    "--from",
    "2026-09-22T05:17:00Z",
    "--to",
    "2026-09-29T05:17:00Z",
  ]
  try {
    const result = await exec(process.execPath, args, options)
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestCount: 5,
      successfulRequestCount: 5,
      windowStart: "2026-09-22T05:17:00.000Z",
    })
    expect(result.stderr).toBe("")
    failed = true
    await expect(exec(process.execPath, args, options)).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "usage report unavailable\n",
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
