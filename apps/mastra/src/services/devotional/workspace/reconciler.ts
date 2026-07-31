import { mapWithConcurrency } from "../../concurrency"
import {
  Bm25GenerationIndex,
  createInventoryDigest,
  type CatalogStore,
  type Embedder,
  type GenerationVectorIndex,
} from "./catalog"
import type { CatalogHead } from "./catalog-schema"
import { DevotionalWorkspaceError, isDevotionalWorkspaceError } from "./errors"
import {
  DEVOTIONAL_INVENTORY_DEFAULTS,
  inventoryDevotionalInputs,
  type DevotionalInventory,
  type DevotionalInventoryLimits,
  type InventoryFilesystem,
} from "./inventory"

const DEVOTIONAL_EMBEDDING_CONCURRENCY = 5

async function withinDeadline<T>(
  work: Promise<T>,
  remainingMs: number,
  deadlineMs: number,
): Promise<T> {
  if (remainingMs <= 0) {
    throw new DevotionalWorkspaceError(
      "inventory-deadline-exceeded",
      "Devotional Workspace reconciliation exceeded its deadline",
      { details: { deadlineMs }, retryable: true },
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DevotionalWorkspaceError(
                "inventory-deadline-exceeded",
                "Devotional Workspace reconciliation exceeded its deadline",
                { details: { deadlineMs }, retryable: true },
              ),
            ),
          remainingMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type ReconciliationResult = {
  generation: number
  inventoryDigest: string
  inventory: DevotionalInventory
  head: CatalogHead
  keywordIndex: Bm25GenerationIndex
}

export async function reconcileDevotionalWorkspace(options: {
  filesystem: InventoryFilesystem
  catalog: CatalogStore
  vectorIndex?: GenerationVectorIndex
  embedder?: Embedder
  limits?: Partial<DevotionalInventoryLimits>
}): Promise<ReconciliationResult> {
  if (!options.vectorIndex || !options.embedder) {
    throw new DevotionalWorkspaceError(
      "hybrid-search-unavailable",
      "Devotional hybrid retrieval requires BM25, vectors, and an embedder",
    )
  }

  const limits = { ...DEVOTIONAL_INVENTORY_DEFAULTS, ...options.limits }
  const startedAt = limits.now()
  const inventory = await inventoryDevotionalInputs(options.filesystem, limits)
  const generation = await options.catalog.nextGeneration()
  const documents = inventory.eligible.map((entry) => ({ ...entry }))
  const inventoryDigest = createInventoryDigest(documents)

  try {
    await options.catalog.stage(generation, documents)
    const keywordIndex = new Bm25GenerationIndex(documents)
    const vectorDocuments = await mapWithConcurrency(
      documents,
      DEVOTIONAL_EMBEDDING_CONCURRENCY,
      async (document) => ({
        path: document.path,
        digest: document.digest,
        vector: await withinDeadline(
          options.embedder!(`${document.title}\n${document.content}`),
          limits.deadlineMs - (limits.now() - startedAt),
          limits.deadlineMs,
        ),
      }),
    )
    await withinDeadline(
      options.vectorIndex.replaceGeneration(generation, vectorDocuments),
      limits.deadlineMs - (limits.now() - startedAt),
      limits.deadlineMs,
    )
    const head = await options.catalog.commit(generation, inventoryDigest)
    return { generation, inventoryDigest, inventory, head, keywordIndex }
  } catch (error) {
    await options.catalog.fail(
      generation,
      error instanceof Error ? error.message : "Unknown reconciliation failure",
    )
    await options.vectorIndex
      .deleteGeneration(generation)
      .catch(() => undefined)
    if (isDevotionalWorkspaceError(error)) throw error
    throw new DevotionalWorkspaceError(
      "reconciliation-failed",
      "Devotional Workspace reconciliation failed before head commit",
      { cause: error, retryable: true },
    )
  }
}
