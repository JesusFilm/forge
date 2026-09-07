import { it, expect, vi } from "vitest"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
const mode = vi.hoisted(() => ({ value: "tag" }))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: () => {
    if (mode.value === "tag") throw new Error("injected tag storage failure")
  },
}))
vi.mock("@/lib/cloudflare-cache", () => ({
  purgeWatchDynamicCollectionsCache: async () =>
    mode.value === "edge" ? "failed" : "skipped",
}))
import { POST } from "/home/tataihono/.codex/worktrees/06c1/forge/apps/web/src/app/api/revalidate/route"
it("actual receiver over native HTTP → canonical webhook → durable acknowledgement fails closed then retries", async () => {
  const replies: {
    mode: string
    status: number
    body: { delivery: { edge: string } }
  }[] = []
  const server = createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const response = await POST(
        new Request("http://127.0.0.1:34674/api/revalidate", {
          method: "POST",
          headers: req.headers as HeadersInit,
          body: Buffer.concat(chunks),
        }),
      )
      const text = await response.text()
      replies.push({
        mode: mode.value,
        status: response.status,
        body: JSON.parse(text),
      })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(text)
    } catch {
      res.writeHead(500)
      res.end()
    }
  })
  await new Promise<void>((resolve) =>
    server.listen(34674, "127.0.0.1", resolve),
  )
  const run = () =>
    new Promise<string>((resolve, reject) => {
      let out = ""
      const child = spawn(
        "node",
        [
          "/home/tataihono/.cache/forge-studio-460-runtime/browser/runtime.mjs",
          "seed",
          "/home/tataihono/.cache/forge-studio-460-runtime/browser/reconcile-chain.ts",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
      child.stdout.on("data", (b) => (out += b))
      child.stderr.on("data", (b) => (out += b))
      child.on("exit", (code) =>
        code === 0 ? resolve(out) : reject(new Error(out)),
      )
    })
  try {
    expect(await run()).toContain('"status":"pending"')
    expect(replies.every((r) => r.status === 503)).toBe(true)
    mode.value = "edge"
    expect(await run()).toContain('"status":"pending"')
    expect(
      replies.some(
        (r) => r.mode === "edge" && r.body.delivery.edge === "failed",
      ),
    ).toBe(true)
    mode.value = "success"
    expect(await run()).toContain('"status":"delivered"')
    expect(
      replies.some(
        (r) => r.mode === "success" && r.body.delivery.edge === "skipped",
      ),
    ).toBe(true)
    const count = replies.length
    expect(await run()).toContain('"status":"idle"')
    expect(replies.length).toBe(count)
    console.log(
      JSON.stringify(
        replies.map((r) => ({
          mode: r.mode,
          status: r.status,
          delivery: r.body.delivery,
        })),
      ),
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
