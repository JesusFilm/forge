import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import type { QueryResult, QueryResultRow } from "pg"

import type { DevotionalWorkspaceEnvironment } from "../../../config/env"
import {
  createDevotionalWorkspaceRuntime,
  getDevotionalWorkspaceReadiness,
  resolveDevotionalWorkspaceConfig,
} from "./config"
import type { QueryExecutor } from "./database"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function environment(
  overrides: Partial<DevotionalWorkspaceEnvironment> = {},
): DevotionalWorkspaceEnvironment {
  return {
    nodeEnv: "test",
    localDirectory: "/tmp/devotional-workspace-test",
    prefix: "devotional",
    databaseUrl: "postgresql://localhost/forge",
    databasePoolMax: 3,
    s3: {},
    embedding: {
      baseUrl: "https://ai-gateway.example.test/v1",
      model: "embeddings",
      provider: "test",
    },
    ...overrides,
  }
}

function readyExecutor(): QueryExecutor {
  return {
    async query<T extends QueryResultRow>(
      text: string,
    ): Promise<QueryResult<T>> {
      const rows = /pg_extension/.test(text)
        ? [{ available: true }]
        : /workspace_readiness/.test(text)
          ? [
              {
                ready: true,
                manifest_digest: "a".repeat(64),
                reason: null,
                verified_at: "2026-07-31T12:00:00.000Z",
              },
            ]
          : [{ version: 1 }]
      return {
        rows: rows as unknown as T[],
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      }
    },
  }
}

describe("devotional Workspace configuration", () => {
  it("uses dedicated S3 with Railway virtual-hosted addressing", () => {
    const productionEnvironment = environment({
      nodeEnv: "production",
      s3: {
        endpoint: "https://objects.example.test",
        region: "auto",
        bucket: "devotional-content",
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
      embedding: {
        apiKey: "embed-key",
        baseUrl: "https://ai-gateway.example.test/v1",
        model: "embeddings",
        provider: "test",
      },
    })
    const resolved = resolveDevotionalWorkspaceConfig(productionEnvironment)
    const runtime = createDevotionalWorkspaceRuntime({
      environment: productionEnvironment,
      auditSink: async () => undefined,
    })

    expect(resolved.storage).toMatchObject({
      backend: "s3",
      bucket: "devotional-content",
      prefix: "devotional",
      forcePathStyle: false,
    })
    expect(resolved.issues).toEqual([])
    expect(runtime.filesystem.provider).toBe("s3")
    expect(runtime.filesystem.readOnly).toBe(false)
    expect(runtime.filesystem.getMountConfig()).toMatchObject({
      type: "s3",
      bucket: "devotional-content",
      prefix: "devotional/",
    })
  })

  it("bounds a stalled S3 request", async () => {
    const sockets = new Set<Socket>()
    let connectionCount = 0
    const server = createServer(() => undefined)
    server.on("connection", (socket) => {
      connectionCount += 1
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test server address")
    }

    try {
      const runtime = createDevotionalWorkspaceRuntime({
        environment: environment({
          nodeEnv: "production",
          s3: {
            endpoint: `http://127.0.0.1:${address.port}`,
            region: "auto",
            bucket: "devotional-content",
            accessKeyId: "access",
            secretAccessKey: "secret",
          },
        }),
        auditSink: async () => undefined,
        s3ClientLimits: {
          connectionTimeoutMs: 100,
          requestTimeoutMs: 100,
          socketTimeoutMs: 100,
          maxAttempts: 1,
        },
      })

      await expect(runtime.filesystem.init()).rejects.toThrow(
        /request.*exceeded/iu,
      )
      expect(connectionCount).toBe(1)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  it("uses an equivalent contained local filesystem without network access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devo-workspace-"))
    temporaryDirectories.push(directory)
    const runtime = createDevotionalWorkspaceRuntime({
      environment: environment({ localDirectory: directory }),
      auditSink: async () => undefined,
    })

    await runtime.filesystem.init()
    await runtime.filesystem.writeFile("inputs/reflections/test.md", "Grace", {
      recursive: true,
    })

    expect(runtime.config.storage).toEqual({ backend: "local", directory })
    expect(
      await runtime.filesystem.readFile("inputs/reflections/test.md", {
        encoding: "utf8",
      }),
    ).toBe("Grace")
    expect(runtime.workspace.canBM25).toBe(true)
  })

  it("does not fall back to local for a partial production S3 tuple", () => {
    const resolved = resolveDevotionalWorkspaceConfig(
      environment({
        nodeEnv: "production",
        s3: { bucket: "only-one-field" },
      }),
    )

    expect(resolved.storage.backend).toBe("unavailable")
    expect(resolved.issues.join(" ")).toMatch(/S3 configuration is incomplete/)
  })

  it("disables inherited agent tools and reports missing hybrid/schema capability", async () => {
    const runtime = createDevotionalWorkspaceRuntime({
      environment: environment(),
      auditSink: async () => undefined,
    })
    const readiness = await getDevotionalWorkspaceReadiness(runtime, {
      query: async () => {
        throw new Error("schema missing")
      },
    })

    expect(runtime.workspace.getToolsConfig()).toEqual({ enabled: false })
    expect(runtime.workspace.canHybrid).toBe(false)
    expect(readiness).toMatchObject({
      ready: false,
      filesystem: { ready: true },
      hybridSearch: { ready: false },
      databaseSchema: { ready: false },
      cutover: { ready: false },
    })
  })

  it("reports all infrastructure ready when filesystem, vector, embedder, and schema exist", async () => {
    const runtime = createDevotionalWorkspaceRuntime({
      environment: environment({
        embedding: {
          apiKey: "embed-key",
          baseUrl: "https://ai-gateway.example.test/v1",
          model: "embeddings",
          provider: "test",
        },
      }),
      auditSink: async () => undefined,
    })
    const readiness = await getDevotionalWorkspaceReadiness(
      runtime,
      readyExecutor(),
    )

    expect(runtime.workspace.canHybrid).toBe(true)
    expect(typeof runtime.embedder).toBe("function")
    expect(runtime.vectorStore).toBeDefined()
    expect(readiness.ready).toBe(true)
    expect(readiness.cutover).toEqual({
      ready: true,
      manifestDigest: "a".repeat(64),
    })
  })

  it("reports a configured filesystem that fails its live health check", async () => {
    const runtime = createDevotionalWorkspaceRuntime({
      environment: environment({
        localDirectory: "/dev/null/devotional-workspace",
        embedding: {
          apiKey: "embed-key",
          baseUrl: "https://ai-gateway.example.test/v1",
          model: "embeddings",
          provider: "test",
        },
      }),
      auditSink: async () => undefined,
    })

    const readiness = await getDevotionalWorkspaceReadiness(
      runtime,
      readyExecutor(),
    )

    expect(readiness).toMatchObject({
      ready: false,
      filesystem: {
        ready: false,
        reason: "devotional Workspace filesystem health check failed",
      },
    })
  })
})
