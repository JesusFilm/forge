import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { ObservedPool } from "../db/observed-pool"

const temporaryDirectories: string[] = []

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("legacy detail session CLI protocol streams", () => {
  it("emits a real pool acquisition failure through console.info", async () => {
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    })
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolveListen)
    })
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new Error("loopback-listener")
    const diagnostic = vi.spyOn(console, "info").mockImplementation(() => {})
    const pool = new ObservedPool({
      host: "127.0.0.1",
      port: address.port,
      user: "fixture",
      password: "fixture",
      database: "unused",
      connectionTimeoutMillis: 100,
    })
    try {
      await expect(pool.connect()).rejects.toThrow()
      const events = diagnostic.mock.calls.map(([line]) =>
        JSON.parse(String(line)),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "database.pool_acquisition",
          outcome: "rejected",
        }),
      )
    } finally {
      diagnostic.mockRestore()
      await pool.end()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      )
    }
  })

  it("keeps a database acquisition diagnostic off stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "legacy-session-stdio-"))
    temporaryDirectories.push(directory)
    const preload = join(directory, "emit-acquisition.cjs")
    await writeFile(
      preload,
      `const onListener = (event) => {
        if (event !== "data") return
        process.stdin.off("newListener", onListener)
        console.info(JSON.stringify({ event: "database.pool_acquisition", outcome: "acquired" }))
      }
      process.stdin.on("newListener", onListener)
      `,
    )
    const child = spawn(
      resolve("node_modules/.bin/tsx"),
      [
        "src/scripts/retire-legacy-recommendation-detail-session.ts",
        "--confirm-cohort",
        "a".repeat(64),
        "--confirm-target",
        "b".repeat(64),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ADMIN_SESSION_SECRET: "x".repeat(32),
          AUTH_ISSUER_URL: "http://localhost:3000",
          AUTH_ADMIN_CLIENT_ID: "session-stdio-test",
          DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/unused",
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${preload}`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.stdin.end("{}\n")
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject)
      child.once("close", resolveExit)
    }).finally(() => clearTimeout(timeout))
    expect(exitCode).toBe(1)
    const frames = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      kind: "stopped-uncertain",
      rawDiagnosticsSuppressed: true,
    })
    expect(stderr).toContain('"event":"database.pool_acquisition"')
  })
})
