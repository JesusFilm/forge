import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const mastraSource = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
)
const workspaceSource = readFileSync(
  new URL("../services/devotional/workspace/config.ts", import.meta.url),
  "utf8",
)
const workerStorageSource = readFileSync(
  new URL("../../../shorts-worker/src/storage.ts", import.meta.url),
  "utf8",
)
const workerEnvSource = readFileSync(
  new URL("../../../shorts-worker/src/config/env.ts", import.meta.url),
  "utf8",
)

describe("devotional Workspace registration", () => {
  it("registers exactly one global Workspace without replacing workflow or observability storage", () => {
    expect(mastraSource).toContain(
      "const devotionalWorkspaceRuntime = createDevotionalWorkspaceRuntime()",
    )
    // Mastra extracts the server configuration into a separate bundle. Exported
    // registration-only singletons are omitted from that bundle and fail at
    // runtime even though TypeScript accepts the source composition.
    expect(mastraSource).not.toContain(
      "export const devotionalWorkspaceRuntime",
    )
    expect(mastraSource).not.toContain(
      "export const devotionalDataPlaneRuntime",
    )
    expect(
      mastraSource.match(/workspace: devotionalWorkspaceRuntime\.workspace/g),
    ).toHaveLength(1)
    expect(mastraSource).toContain("new PostgresStore({")
    expect(mastraSource).toContain("new DuckDBStore({")
    expect(mastraSource).toContain("new MastraCompositeStore({")
  })

  it("keeps Workspace access programmatic while disabling inherited agent tools", () => {
    expect(workspaceSource).toContain("name: DEVOTIONAL_WORKSPACE_NAME")
    expect(workspaceSource).toContain("tools: { enabled: false }")
    expect(workspaceSource).not.toContain("autoIndexPaths")
    expect(mastraSource).toContain("runWithWorkspaceMutationContext")
    expect(mastraSource).toContain("x-forge-workspace-actor-id")
  })

  it("pins a dedicated S3 provider and explicit Railway endpoint style", () => {
    expect(workspaceSource).toContain("new S3Filesystem({")
    expect(workspaceSource).toContain("forcePathStyle: storage.forcePathStyle")
    expect(workspaceSource).toContain("forcePathStyle: false")
  })

  it("keeps Mastra and Worker v2 keys in the same configured namespace", () => {
    expect(workspaceSource).toContain("prefix: storage.prefix")
    expect(workerEnvSource).toContain(
      'DEVOTIONAL_WORKSPACE_PREFIX: z.string().min(1).default("devotional")',
    )
    expect(workerStorageSource).toContain(
      '[normalizedWorkspacePrefix, relativeKey].filter(Boolean).join("/")',
    )
    expect(workerStorageSource).toContain(
      "workspacePrefix: env.DEVOTIONAL_WORKSPACE_PREFIX",
    )
  })

  it("composes new starts and retries with the durable data plane", () => {
    expect(mastraSource).toContain("createDevotionalDataPlaneRuntime({")
    expect(mastraSource).toContain(
      "attempts: devotionalDataPlaneRuntime.attempts",
    )
    expect(mastraSource).toContain(
      "devotionalDataPlaneRuntime.reconcileAttempt(options)",
    )
    expect(mastraSource).toContain(
      "devotionalDataPlaneRuntime.usedClips.renew(",
    )
    expect(mastraSource).toContain('c.req.header("idempotency-key")')
  })
})
