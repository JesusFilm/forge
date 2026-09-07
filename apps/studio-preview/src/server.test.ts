import { afterAll, beforeAll, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
let child: ChildProcess, origin: string, directory: string, clock: string
const startedAt = Date.now()
class StudioPreviewHostFixtureError extends Error {}

const key = randomBytes(32).toString("hex")
const headers = {
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
}
const input = {
  document: {
    version: 1,
    title: "Fixture",
    language: "english",
    runtimeVersion: STUDIO_RUNTIME_VERSION,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
  media: {},
  code: {},
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "studio-preview-expiry-"))
  clock = join(directory, "clock")
  await writeFile(clock, String(startedAt))
  const preload = join(directory, "clock.mjs")
  await writeFile(
    preload,
    `import {readFileSync} from "node:fs"; Date.now = () => Number(readFileSync(${JSON.stringify(clock)}, "utf8"));`,
  )
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.on("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string")
        throw new StudioPreviewHostFixtureError("No test port")
      probe.close(() => resolve(address.port))
    })
  })
  origin = `http://127.0.0.1:${port}`
  await new Promise<void>((resolve, reject) => {
    const build = spawn(process.execPath, ["build.mjs"], { stdio: "pipe" })
    build.once("error", reject)
    build.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new StudioPreviewHostFixtureError("Preview build failed")),
    )
  })
  child = spawn(process.execPath, ["--import", preload, "dist/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      STUDIO_PREVIEW_PUBLIC_ORIGIN: origin,
      STUDIO_MANAGER_ORIGIN: "http://studio456.localhost:3456",
      STUDIO_PREVIEW_API_KEY: key,
    },
    stdio: "pipe",
  })
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(origin)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new StudioPreviewHostFixtureError("Preview test host did not start")
}, 15000)
afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    )
    child.kill("SIGTERM")
    await exited
  }
  if (directory) await rm(directory, { recursive: true, force: true })
})
it("authenticates staging, releases and renews sessions, and reclaims abandoned quota", async () => {
  expect(
    (
      await fetch(origin + "/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(401)
  const tokens: string[] = []
  for (let i = 0; i < 8; i++) {
    const response = await fetch(origin + "/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
    expect(response.status).toBe(200)
    tokens.push((await response.json()).token)
  }
  expect(
    (
      await fetch(origin + "/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(429)
  const url = origin + "/s/" + tokens[0] + "/"
  const page = await fetch(url)
  expect(page.headers.get("content-security-policy")).toContain(
    "frame-ancestors http://studio456.localhost:3456",
  )
  expect(await page.text()).not.toContain(key)
  expect((await fetch(url, { method: "PATCH" })).status).toBe(401)
  expect((await fetch(url, { method: "PATCH", headers })).status).toBe(204)
  expect((await fetch(url, { method: "DELETE" })).status).toBe(401)
  expect((await fetch(url, { method: "DELETE", headers })).status).toBe(204)
  expect((await fetch(url)).status).toBe(410)
  expect(
    (
      await fetch(origin + "/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(200)

  // The real HTTP operations above filled the eight-session pool. Advance only this
  // child process's clock; the application TTL and host clock remain unchanged.
  await writeFile(clock, String(startedAt + 15 * 60000 + 1))
  const sessions: string[] = []
  for (let i = 0; i < 8; i++) {
    const response = await fetch(origin + "/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
    expect(response.status).toBe(200)
    sessions.push((await response.json()).url)
  }
  await writeFile(clock, String(startedAt + 29 * 60000))
  expect((await fetch(sessions[0]!, { method: "PATCH", headers })).status).toBe(
    204,
  )
  await writeFile(clock, String(startedAt + 31 * 60000))
  expect((await fetch(sessions[1]!)).status).toBe(410)
  expect((await fetch(sessions[0]!)).status).toBe(200)
  for (let i = 0; i < 7; i++) {
    expect(
      (
        await fetch(origin + "/sessions", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(200)
  }
  expect(
    (
      await fetch(origin + "/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(429)
})
