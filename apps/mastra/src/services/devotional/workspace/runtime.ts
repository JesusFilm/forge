import { z } from "zod"

import type { UsedClipsStore } from "../used-clips-ledger"
import { DEVOTIONAL_AUTHORED_PATHS } from "../authored-data"
import { MastraGenerationVectorIndex } from "./catalog"
import {
  assertDevotionalWorkspaceReadyForStarts,
  createDevotionalWorkspaceRuntime,
  type DevotionalWorkspaceRuntime,
} from "./config"
import { getDevotionalDatabase, type DevotionalDatabase } from "./database"
import { createWorkspaceInventoryFilesystem } from "./inventory"
import { PostgresCatalogStore } from "./postgres-catalog"
import { createPostgresUsedClipsStore } from "./postgres-used-clips"
import { DevotionalWorkspaceRepository } from "./repository"
import { DevotionalSourceRefSchema } from "./state-schema"
import {
  PostgresDevotionalAttemptStore,
  type DevotionalAttemptStore,
} from "./state"

const SelectedSourcesSchema = z.array(DevotionalSourceRefSchema).min(1).max(500)
const RECONCILIATION_ADVISORY_LOCK = "devotional-workspace-reconciliation"

async function writeReconciliationReports(options: {
  runtime: DevotionalWorkspaceRuntime
  generation: number
  inventoryDigest: string
  inventory: Awaited<
    ReturnType<DevotionalWorkspaceRepository["reconcile"]>
  >["inventory"]
}): Promise<void> {
  const reconciledAt = new Date().toISOString()
  await Promise.all([
    options.runtime.filesystem.writeFile(
      "_system/eligibility/latest.json",
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generation: options.generation,
          inventoryDigest: options.inventoryDigest,
          reconciledAt,
          discovered: options.inventory.discovered,
          eligible: options.inventory.eligible.map(
            ({ content: _content, ...source }) => source,
          ),
          excluded: options.inventory.excluded,
        },
        null,
        2,
      )}\n`,
      { recursive: true, overwrite: true, mimeType: "application/json" },
    ),
    options.runtime.filesystem.writeFile(
      "_system/readiness/latest.json",
      `${JSON.stringify(
        {
          schemaVersion: 1,
          ready: true,
          catalogGeneration: options.generation,
          inventoryDigest: options.inventoryDigest,
          checkedAt: reconciledAt,
        },
        null,
        2,
      )}\n`,
      { recursive: true, overwrite: true, mimeType: "application/json" },
    ),
  ])
}

export type ReconciliationRepository = Pick<
  DevotionalWorkspaceRepository,
  "reconcile" | "search" | "retireLocalGenerations"
>

export type PreparedDevotionalWorkspaceAttempt = {
  generation: number
  selectedSources: z.infer<typeof DevotionalSourceRefSchema>[]
}

export type DevotionalDataPlaneRuntime = {
  workspaceRuntime: DevotionalWorkspaceRuntime
  database: DevotionalDatabase
  catalog: PostgresCatalogStore
  repository: ReconciliationRepository
  attempts: DevotionalAttemptStore
  usedClips: UsedClipsStore
  assertReady(): Promise<void>
  reconcileAttempt(options?: {
    query?: string
  }): Promise<PreparedDevotionalWorkspaceAttempt>
}

export async function withDevotionalReconciliationLease<T>(
  database: Pick<DevotionalDatabase, "transaction">,
  work: () => Promise<T>,
): Promise<T> {
  return database.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      RECONCILIATION_ADVISORY_LOCK,
    ])
    return work()
  })
}

export function createDevotionalDataPlaneRuntime(
  options: {
    workspaceRuntime?: DevotionalWorkspaceRuntime
    database?: DevotionalDatabase
    catalog?: PostgresCatalogStore
    repository?: ReconciliationRepository
    attempts?: DevotionalAttemptStore
    usedClips?: UsedClipsStore
    assertReady?: () => Promise<void>
  } = {},
): DevotionalDataPlaneRuntime {
  const workspaceRuntime =
    options.workspaceRuntime ?? createDevotionalWorkspaceRuntime()
  const database = options.database ?? getDevotionalDatabase()
  const catalog = options.catalog ?? new PostgresCatalogStore(database)
  const vectorIndex = workspaceRuntime.vectorStore
    ? new MastraGenerationVectorIndex(workspaceRuntime.vectorStore)
    : undefined
  const repository =
    options.repository ??
    new DevotionalWorkspaceRepository({
      filesystem: createWorkspaceInventoryFilesystem(
        workspaceRuntime.filesystem,
      ),
      catalog,
      ...(vectorIndex ? { vectorIndex } : {}),
      ...(workspaceRuntime.embedder
        ? { embedder: workspaceRuntime.embedder }
        : {}),
    })
  const attempts =
    options.attempts ?? new PostgresDevotionalAttemptStore(database)
  const usedClips =
    options.usedClips ?? createPostgresUsedClipsStore({ database })
  const assertReady =
    options.assertReady ??
    (() => assertDevotionalWorkspaceReadyForStarts(workspaceRuntime, database))

  return {
    workspaceRuntime,
    database,
    catalog,
    repository,
    attempts,
    usedClips,
    assertReady,
    async reconcileAttempt(reconcileOptions = {}) {
      return withDevotionalReconciliationLease(database, async () => {
        await assertReady()
        const result = await repository.reconcile()
        const query =
          reconcileOptions.query ??
          "daily devotional Jesus scripture reflection faith hope grace prayer"
        const [scripture, reflections] = await Promise.all([
          repository.search(query, { category: "scripture", topK: 100 }),
          repository.search(query, { category: "reflections", topK: 100 }),
        ])
        const refsByPath = new Map(
          result.inventory.eligible.map(({ content: _content, ...source }) => [
            source.path,
            source,
          ]),
        )
        const selected = new Map<
          string,
          z.infer<typeof DevotionalSourceRefSchema>
        >()
        for (const requiredPath of Object.values(DEVOTIONAL_AUTHORED_PATHS)) {
          const required = refsByPath.get(requiredPath)
          if (!required) {
            throw new Error(
              `Required devotional Workspace input is unavailable: ${requiredPath}`,
            )
          }
          selected.set(required.path, required)
        }
        for (const source of [...scripture, ...reflections]) {
          const ref = {
            path: source.path,
            category: source.category,
            digest: source.digest,
            size: source.size,
            modifiedAt: source.modifiedAt,
            ...(source.etag ? { etag: source.etag } : {}),
            title: source.title,
          }
          selected.set(ref.path, ref)
        }
        const selectedSources = SelectedSourcesSchema.parse([
          ...selected.values(),
        ])
        await writeReconciliationReports({
          runtime: workspaceRuntime,
          generation: result.generation,
          inventoryDigest: result.inventoryDigest,
          inventory: result.inventory,
        })
        const retiredGenerations = await catalog.retireBefore(result.generation)
        repository.retireLocalGenerations(retiredGenerations)
        await Promise.all(
          retiredGenerations.map((generation) =>
            vectorIndex?.deleteGeneration(generation).catch(() => undefined),
          ),
        )
        return { generation: result.generation, selectedSources }
      })
    },
  }
}
