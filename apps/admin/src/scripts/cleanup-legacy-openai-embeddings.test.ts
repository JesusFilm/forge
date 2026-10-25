import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  type CleanupAudit,
  type CleanupDb,
  EXECUTE_TRANSACTION_OPTIONS,
  LegacyEmbeddingCleanupError,
  buildCleanupAudit,
  executeLegacyCleanup,
  parseArgs,
  readQwenAudit,
  runCleanup,
  writeReportToPath,
} from "./cleanup-legacy-openai-embeddings"

const fixedNow = new Date("2026-06-14T12:00:00.000Z")

class FakeCleanupDb implements CleanupDb {
  queries: string[] = []
  executes: string[] = []
  executeResults: number[] = []
  transactionCalls = 0
  transactionOptions: unknown[] = []

  constructor(
    private readonly queryResponder: (query: string) => unknown[] = () => [],
  ) {}

  async $queryRawUnsafe<T = unknown>(query: string): Promise<T> {
    this.queries.push(query)
    return this.queryResponder(query) as T
  }

  async $executeRawUnsafe(query: string): Promise<number> {
    this.executes.push(query)
    return this.executeResults.shift() ?? 0
  }

  async $transaction<T>(
    fn: (tx: CleanupDb) => Promise<T>,
    options?: unknown,
  ): Promise<T> {
    this.transactionCalls += 1
    this.transactionOptions.push(options)
    return fn(this)
  }

  async $disconnect(): Promise<void> {}
}

function baseAudit(overrides: Partial<CleanupAudit> = {}): CleanupAudit {
  return {
    scenes: {
      legacyTargets: 3,
      preservedRows: 10,
      ambiguousRows: 0,
      metadataOnlyLegacyModelRows: 2,
    },
    experiences: {
      legacyTargets: 2,
      preservedRows: 8,
      ambiguousRows: 1,
      metadataOnlyLegacyModelRows: 0,
    },
    transcripts: {
      legacyParents: 1,
      legacyChunks: 4,
      preservedParents: 3,
      preservedChunks: 9,
      ambiguousParents: 0,
      ambiguousChunks: 0,
    },
    qwen: {
      action: "verified_absent",
      safeToDrop: true,
      blockedReasons: [],
      columns: [],
      indexes: [],
      migrations: [],
    },
    ...overrides,
  }
}

function auditQueryResponder(query: string): unknown[] {
  if (
    query.includes("FROM video_scene_locale") &&
    query.includes("COUNT(*) FILTER")
  ) {
    return [
      {
        legacyTargets: 3,
        preservedRows: 10,
        ambiguousRows: 0,
        metadataOnlyLegacyModelRows: 2,
      },
    ]
  }
  if (
    query.includes("FROM experience_locale") &&
    query.includes("COUNT(*) FILTER")
  ) {
    return [
      {
        legacyTargets: "2",
        preservedRows: "8",
        ambiguousRows: "1",
        metadataOnlyLegacyModelRows: "0",
      },
    ]
  }
  if (
    query.includes("FROM video_transcript t") &&
    query.includes("COUNT(DISTINCT t.id)")
  ) {
    return [
      {
        legacyParents: 1n,
        legacyChunks: 4n,
        preservedParents: 3n,
        preservedChunks: 9n,
        ambiguousParents: 0n,
        ambiguousChunks: 0n,
      },
    ]
  }
  if (query.includes("information_schema.columns")) {
    return [
      { tableName: "video_scene_locale", columnName: "embedding_qwen" },
      { tableName: "video_transcript_chunk", columnName: "embedding_qwen" },
    ]
  }
  if (query.includes('FROM "video_scene_locale"')) {
    return [{ count: 6 }]
  }
  if (query.includes('FROM "video_transcript_chunk"')) {
    return [{ count: "7" }]
  }
  if (query.includes("FROM pg_indexes")) {
    return [
      {
        tableName: "video_scene_locale",
        indexName: "video_scene_locale_embedding_qwen_hnsw",
      },
    ]
  }
  if (query.includes("FROM _prisma_migrations")) {
    return [
      {
        migrationName: "0033_drop_video_embedding_qwen",
        finishedAt: new Date("2026-06-08T00:00:00.000Z"),
        rolledBackAt: null,
        logs: null,
      },
    ]
  }
  return []
}

describe("parseArgs", () => {
  it("requires an explicit target env", () => {
    expect(() => parseArgs([], fixedNow)).toThrow(
      "--target-env=development|staging|production is required",
    )
  })

  it("defaults to dry-run and resolves a report path", () => {
    const args = parseArgs(["--target-env=local"], fixedNow)

    expect(args.targetEnv).toBe("development")
    expect(args.execute).toBe(false)
    expect(args.reportOutPath).toBe(
      resolve(
        process.cwd(),
        ".tmp/legacy-openai-embedding-cleanup/2026-06-14T12-00-00-000Z.json",
      ),
    )
  })

  it("refuses production execute without the production unlock", () => {
    expect(() =>
      parseArgs(
        [
          "--target-env=production",
          "--execute",
          "--backup-evidence=admin-video-db-backups/video-search/prod.dump",
        ],
        fixedNow,
      ),
    ).toThrow("Refusing production cleanup")
  })

  it("refuses production execute without backup evidence", () => {
    expect(() =>
      parseArgs(
        ["--target-env=production", "--execute", "--allow-production-target"],
        fixedNow,
      ),
    ).toThrow("backup-evidence")
  })

  it("accepts production execute only with both explicit safeguards", () => {
    const args = parseArgs(
      [
        "--target-env=production",
        "--execute",
        "--allow-production-target",
        "--backup-evidence=admin-video-db-backups/video-search/prod.dump",
      ],
      fixedNow,
    )

    expect(args.execute).toBe(true)
    expect(args.targetEnv).toBe("production")
    expect(args.backupEvidence).toBe(
      "admin-video-db-backups/video-search/prod.dump",
    )
  })
})

describe("buildCleanupAudit", () => {
  it("aggregates legacy, preserved, ambiguous, and Qwen counts", async () => {
    const db = new FakeCleanupDb(auditQueryResponder)

    const audit = await buildCleanupAudit(db)

    expect(audit.scenes).toEqual({
      legacyTargets: 3,
      preservedRows: 10,
      ambiguousRows: 0,
      metadataOnlyLegacyModelRows: 2,
    })
    expect(audit.experiences.legacyTargets).toBe(2)
    expect(audit.transcripts).toEqual({
      legacyParents: 1,
      legacyChunks: 4,
      preservedParents: 3,
      preservedChunks: 9,
      ambiguousParents: 0,
      ambiguousChunks: 0,
    })
    expect(audit.qwen.action).toBe("would_drop")
    expect(audit.qwen.columns).toEqual([
      {
        tableName: "video_scene_locale",
        columnName: "embedding_qwen",
        nonNullValues: 6,
      },
      {
        tableName: "video_transcript_chunk",
        columnName: "embedding_qwen",
        nonNullValues: 7,
      },
    ])
    expect(JSON.stringify(audit)).not.toContain("[0.")
  })

  it("does not use chunking_version as a transcript target predicate", async () => {
    const db = new FakeCleanupDb(auditQueryResponder)

    await buildCleanupAudit(db)

    const transcriptQuery = db.queries.find((query) =>
      query.includes("FROM video_transcript t"),
    )
    expect(transcriptQuery).toContain("t.model IN")
    expect(transcriptQuery).not.toContain("chunking_version")
  })
})

describe("readQwenAudit", () => {
  it("blocks Qwen cleanup when migration state is failed or unresolved", async () => {
    const db = new FakeCleanupDb((query) => {
      if (query.includes("information_schema.columns")) {
        return [
          { tableName: "video_scene_locale", columnName: "embedding_qwen" },
        ]
      }
      if (query.includes('FROM "video_scene_locale"')) return [{ count: 1 }]
      if (query.includes("FROM pg_indexes")) return []
      if (query.includes("FROM _prisma_migrations")) {
        return [
          {
            migrationName: "0032_video_embedding_qwen",
            finishedAt: null,
            rolledBackAt: null,
            logs: "failed",
          },
        ]
      }
      return []
    })

    const audit = await readQwenAudit(db)

    expect(audit.action).toBe("blocked")
    expect(audit.safeToDrop).toBe(false)
    expect(audit.blockedReasons[0]).toContain("0032_video_embedding_qwen")
  })

  it("blocks unresolved Qwen migration state even without schema artifacts", async () => {
    const db = new FakeCleanupDb((query) => {
      if (query.includes("FROM _prisma_migrations")) {
        return [
          {
            migrationName: "0032_video_embedding_qwen",
            finishedAt: null,
            rolledBackAt: null,
            logs: "failed",
          },
        ]
      }
      return []
    })

    const audit = await readQwenAudit(db)

    expect(audit.action).toBe("blocked")
    expect(audit.safeToDrop).toBe(false)
    expect(audit.columns).toEqual([])
    expect(audit.indexes).toEqual([])
  })
})

describe("executeLegacyCleanup", () => {
  it("clears legacy vectors, deletes legacy chunks, and drops Qwen artifacts", async () => {
    const args = parseArgs(["--target-env=staging", "--execute"], fixedNow)
    const db = new FakeCleanupDb()
    db.executeResults = [3, 2, 4]
    const audit = baseAudit({
      qwen: {
        action: "would_drop",
        safeToDrop: true,
        blockedReasons: [],
        columns: [
          {
            tableName: "video_scene_locale",
            columnName: "embedding_qwen",
            nonNullValues: 6,
          },
          {
            tableName: "video_transcript_chunk",
            columnName: "embedding_qwen",
            nonNullValues: 7,
          },
        ],
        indexes: [
          {
            tableName: "video_scene_locale",
            indexName: "video_scene_locale_embedding_qwen_hnsw",
          },
        ],
        migrations: [],
      },
    })

    const summary = await executeLegacyCleanup(db, args, audit)

    expect(summary).toEqual({
      sceneLocalesCleared: 3,
      experienceLocalesCleared: 2,
      transcriptChunksDeleted: 4,
      qwenIndexesDropped: 1,
      qwenColumnsDropped: 2,
    })
    expect(db.transactionCalls).toBe(1)
    expect(db.transactionOptions).toEqual([EXECUTE_TRANSACTION_OPTIONS])
    const transcriptDelete = db.executes.find((query) =>
      query.includes("DELETE FROM video_transcript_chunk"),
    )
    expect(transcriptDelete).toContain("JOIN video_transcript t")
    expect(transcriptDelete).toContain("t.model IN")
    expect(transcriptDelete).not.toContain("chunking_version")
  })

  it("fails before mutation when Qwen cleanup is blocked", async () => {
    const args = parseArgs(["--target-env=staging", "--execute"], fixedNow)
    const db = new FakeCleanupDb()
    const audit = baseAudit({
      qwen: {
        action: "blocked",
        safeToDrop: false,
        blockedReasons: ["migration 0032_video_embedding_qwen is failed"],
        columns: [],
        indexes: [],
        migrations: [],
      },
    })

    await expect(executeLegacyCleanup(db, args, audit)).rejects.toThrow(
      LegacyEmbeddingCleanupError,
    )
    expect(db.executes).toHaveLength(0)
  })
})

describe("runCleanup and report writing", () => {
  let tmpDir: string | undefined

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  })

  it("dry-runs without executing mutations", async () => {
    const db = new FakeCleanupDb(auditQueryResponder)
    const args = parseArgs(["--target-env=development"], fixedNow)

    const report = await runCleanup(db, args, fixedNow)

    expect(report.event).toBe(
      "cleanup-legacy-openai-embeddings.dry-run-complete",
    )
    expect(report.dryRun).toBe(true)
    expect(report.mutations).toBeUndefined()
    expect(db.executes).toHaveLength(0)
  })

  it("writes redacted report JSON to disk", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "legacy-embedding-cleanup-"))
    const path = join(tmpDir, "report.json")
    const db = new FakeCleanupDb(auditQueryResponder)
    const args = parseArgs(
      ["--target-env=development", `--report-out=${path}`],
      fixedNow,
    )
    const report = await runCleanup(db, args, fixedNow)

    const result = await writeReportToPath(path, report)

    expect(result.ok).toBe(true)
    const contents = await readFile(path, "utf8")
    expect(JSON.parse(contents)).toMatchObject({
      event: "cleanup-legacy-openai-embeddings.dry-run-complete",
      targetEnv: "development",
    })
    expect(contents).not.toContain("postgresql://")
    expect(contents).not.toContain("Bearer ")
    expect(contents).not.toContain("[0.")
  })
})
