import { createOpenAI } from "@ai-sdk/openai"
import { Workspace, LocalFilesystem } from "@mastra/core/workspace"
import type {
  CopyOptions,
  FileContent,
  FileEntry,
  FilesystemInfo,
  FileStat,
  ListOptions,
  ProviderStatus,
  ReadOptions,
  RemoveOptions,
  WorkspaceFilesystem,
  WriteOptions,
} from "@mastra/core/workspace"
import { PgVector } from "@mastra/pg"
import { S3Filesystem } from "@mastra/s3"
import { embed } from "ai"

import {
  getDevotionalWorkspaceEnvironment,
  type DevotionalWorkspaceEnvironment,
} from "../../../config/env"
import {
  AuditedFilesystem,
  type WorkspaceMutationAuditSink,
  type WorkspaceMutationContext,
} from "./audited-filesystem"
import {
  createDatabaseAuditSink,
  getDevotionalDatabase,
  getDevotionalSchemaReadiness,
  hasDevotionalVectorCapability,
  type QueryExecutor,
} from "./database"

export const DEVOTIONAL_WORKSPACE_ID = "devotional-workspace"
export const DEVOTIONAL_WORKSPACE_NAME = "Devotional Workspace"
export const DEVOTIONAL_WORKSPACE_SEARCH_INDEX =
  "devotional_workspace_native_search"

type StorageConfig =
  | { backend: "local"; directory: string }
  | {
      backend: "s3"
      bucket: string
      endpoint: string
      region: string
      accessKeyId: string
      secretAccessKey: string
      prefix: string
      forcePathStyle: false
    }
  | { backend: "unavailable"; reason: string }

export type DevotionalWorkspaceConfig = {
  storage: StorageConfig
  databaseUrl: string
  databasePoolMax: number
  embedding?: {
    apiKey: string
    baseUrl: string
    model: string
    userAgent?: string
  }
  issues: string[]
}

const S3_FIELD_LABELS = [
  "endpoint",
  "region",
  "bucket",
  "accessKeyId",
  "secretAccessKey",
] as const

/** Pure configuration resolution used by startup and focused env tests. */
export function resolveDevotionalWorkspaceConfig(
  environment: DevotionalWorkspaceEnvironment,
): DevotionalWorkspaceConfig {
  const issues: string[] = []
  const suppliedS3Fields = S3_FIELD_LABELS.filter((field) =>
    Boolean(environment.s3[field]),
  )
  const completeS3 = suppliedS3Fields.length === S3_FIELD_LABELS.length
  const noS3 = suppliedS3Fields.length === 0

  let storage: StorageConfig
  if (completeS3) {
    storage = {
      backend: "s3",
      endpoint: environment.s3.endpoint!,
      region: environment.s3.region!,
      bucket: environment.s3.bucket!,
      accessKeyId: environment.s3.accessKeyId!,
      secretAccessKey: environment.s3.secretAccessKey!,
      prefix: environment.prefix,
      // Railway Object Storage uses virtual-hosted addressing. Keep this
      // explicit because @mastra/s3 defaults custom endpoints to path style.
      forcePathStyle: false,
    }
  } else if (noS3 && environment.nodeEnv !== "production") {
    storage = { backend: "local", directory: environment.localDirectory }
  } else {
    const missing = S3_FIELD_LABELS.filter(
      (field) => !environment.s3[field],
    ).join(", ")
    const reason = `dedicated devotional Workspace S3 configuration is incomplete: ${missing}`
    issues.push(reason)
    storage = { backend: "unavailable", reason }
  }

  const embedding = environment.embedding.apiKey
    ? {
        apiKey: environment.embedding.apiKey,
        baseUrl: environment.embedding.baseUrl,
        model: environment.embedding.model,
        userAgent: environment.embedding.userAgent,
      }
    : undefined
  if (!embedding) issues.push("devotional Workspace embedder is unavailable")
  if (!environment.databaseUrl) {
    issues.push("devotional Workspace vector database is unavailable")
  }

  return {
    storage,
    databaseUrl: environment.databaseUrl,
    databasePoolMax: environment.databasePoolMax,
    embedding,
    issues,
  }
}

class UnavailableFilesystem implements WorkspaceFilesystem {
  readonly id = "devotional-workspace-unavailable-filesystem"
  readonly name = "UnavailableFilesystem"
  readonly provider = "unavailable"
  readonly readOnly = true
  status: ProviderStatus = "error"
  error: string

  constructor(reason: string) {
    this.error = reason
  }

  init(): Promise<void> {
    return Promise.resolve()
  }

  destroy(): Promise<void> {
    return Promise.resolve()
  }

  isReady(): boolean {
    return false
  }

  getInfo(): FilesystemInfo {
    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      status: this.status,
      error: this.error,
      readOnly: true,
    }
  }

  readFile(_path: string, _options?: ReadOptions): Promise<string | Buffer> {
    return this.reject()
  }
  writeFile(
    _path: string,
    _content: FileContent,
    _options?: WriteOptions,
  ): Promise<void> {
    return this.reject()
  }
  appendFile(_path: string, _content: FileContent): Promise<void> {
    return this.reject()
  }
  deleteFile(_path: string, _options?: RemoveOptions): Promise<void> {
    return this.reject()
  }
  copyFile(
    _source: string,
    _target: string,
    _options?: CopyOptions,
  ): Promise<void> {
    return this.reject()
  }
  moveFile(
    _source: string,
    _target: string,
    _options?: CopyOptions,
  ): Promise<void> {
    return this.reject()
  }
  mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    return this.reject()
  }
  rmdir(_path: string, _options?: RemoveOptions): Promise<void> {
    return this.reject()
  }
  readdir(_path: string, _options?: ListOptions): Promise<FileEntry[]> {
    return this.reject()
  }
  exists(_path: string): Promise<boolean> {
    return this.reject()
  }
  stat(_path: string): Promise<FileStat> {
    return this.reject()
  }

  private reject<T>(): Promise<T> {
    return Promise.reject(new Error(this.error))
  }
}

export type DevotionalWorkspaceRuntime = {
  workspace: Workspace
  filesystem: AuditedFilesystem
  vectorStore?: PgVector
  embedder?: WorkspaceEmbedder
  config: DevotionalWorkspaceConfig
}

export type WorkspaceEmbedder = (text: string) => Promise<number[]>

export function createDevotionalWorkspaceRuntime(options?: {
  environment?: DevotionalWorkspaceEnvironment
  filesystem?: WorkspaceFilesystem
  auditSink?: WorkspaceMutationAuditSink
  mutationContext?: () => WorkspaceMutationContext
  vectorStore?: PgVector
  embedder?: WorkspaceEmbedder
}): DevotionalWorkspaceRuntime {
  const config = resolveDevotionalWorkspaceConfig(
    options?.environment ?? getDevotionalWorkspaceEnvironment(),
  )

  const baseFilesystem =
    options?.filesystem ?? createFilesystemFromConfig(config.storage)
  const auditSink =
    options?.auditSink ?? createDatabaseAuditSink(getDevotionalDatabase())
  const filesystem = new AuditedFilesystem(
    baseFilesystem,
    auditSink,
    options?.mutationContext,
  )

  const vectorStore =
    options?.vectorStore ??
    (config.embedding
      ? new PgVector({
          id: "devotional-workspace-native-vector",
          connectionString: config.databaseUrl,
          schemaName: "devotional_workspace",
          max: 1,
          pgPoolOptions: { max: 1 },
        })
      : undefined)
  const embedder =
    options?.embedder ??
    (config.embedding ? createEmbedder(config.embedding) : undefined)

  const workspace = new Workspace({
    id: DEVOTIONAL_WORKSPACE_ID,
    name: DEVOTIONAL_WORKSPACE_NAME,
    filesystem,
    bm25: true,
    ...(vectorStore && embedder ? { vectorStore, embedder } : {}),
    searchIndexName: DEVOTIONAL_WORKSPACE_SEARCH_INDEX,
    // Studio uses native Workspace endpoints. Agents and workflows do not
    // inherit filesystem tools; devotional business logic reads via its typed
    // repository instead.
    tools: { enabled: false },
  })

  return { workspace, filesystem, vectorStore, embedder, config }
}

function createFilesystemFromConfig(
  storage: StorageConfig,
): WorkspaceFilesystem {
  if (storage.backend === "local") {
    return new LocalFilesystem({
      id: "devotional-workspace-local-filesystem",
      basePath: storage.directory,
      contained: true,
      readOnly: false,
    })
  }
  if (storage.backend === "s3") {
    return new S3Filesystem({
      id: "devotional-workspace-s3-filesystem",
      displayName: DEVOTIONAL_WORKSPACE_NAME,
      bucket: storage.bucket,
      endpoint: storage.endpoint,
      region: storage.region,
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      prefix: storage.prefix,
      forcePathStyle: storage.forcePathStyle,
      readOnly: false,
    })
  }
  return new UnavailableFilesystem(storage.reason)
}

function createEmbedder(
  config: NonNullable<DevotionalWorkspaceConfig["embedding"]>,
): WorkspaceEmbedder {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    name: "devotional-workspace-embeddings",
    headers: config.userAgent ? { "User-Agent": config.userAgent } : undefined,
  })
  const model = provider.textEmbeddingModel(config.model)
  return async (text: string) => {
    const result = await embed({ model, value: text })
    return result.embedding
  }
}

export type DevotionalWorkspaceReadiness = {
  ready: boolean
  filesystem: { ready: boolean; reason?: string }
  hybridSearch: { ready: boolean; reason?: string }
  databaseSchema: { ready: boolean; reason?: string; version?: number }
}

export async function getDevotionalWorkspaceReadiness(
  runtime: DevotionalWorkspaceRuntime,
  database: QueryExecutor,
): Promise<DevotionalWorkspaceReadiness> {
  const schema = await getDevotionalSchemaReadiness(database)
  let filesystemReady = runtime.config.storage.backend !== "unavailable"
  let filesystemReason =
    runtime.config.storage.backend === "unavailable"
      ? runtime.config.storage.reason
      : undefined
  if (filesystemReady) {
    try {
      await runtime.filesystem.init()
      await runtime.filesystem.readdir("")
    } catch {
      filesystemReady = false
      filesystemReason = "devotional Workspace filesystem health check failed"
    }
  }
  const vectorReady = await hasDevotionalVectorCapability(database)
  const hybridReady = runtime.workspace.canHybrid && vectorReady
  return {
    ready: filesystemReady && hybridReady && schema.ready,
    filesystem: filesystemReady
      ? { ready: true }
      : { ready: false, reason: filesystemReason },
    hybridSearch: hybridReady
      ? { ready: true }
      : {
          ready: false,
          reason:
            runtime.config.issues.find((issue) =>
              /embedder|vector/.test(issue),
            ) ??
            (vectorReady
              ? "devotional Workspace hybrid search is unavailable"
              : "devotional Workspace vector database is unavailable"),
        },
    databaseSchema: schema.ready
      ? { ready: true, version: schema.version }
      : { ready: false, reason: schema.reason, version: schema.version },
  }
}

export async function assertDevotionalWorkspaceReadyForStarts(
  runtime: DevotionalWorkspaceRuntime,
  database: QueryExecutor,
): Promise<void> {
  const readiness = await getDevotionalWorkspaceReadiness(runtime, database)
  if (!readiness.ready) {
    const reasons = [
      readiness.filesystem.reason,
      readiness.hybridSearch.reason,
      readiness.databaseSchema.reason,
    ].filter(Boolean)
    throw new Error(`devotional Workspace is not ready: ${reasons.join("; ")}`)
  }
}
