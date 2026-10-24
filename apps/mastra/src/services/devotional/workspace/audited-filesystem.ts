import { createHash, randomUUID } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"

import type {
  CopyOptions,
  FileContent,
  FileEntry,
  FilesystemInfo,
  FilesystemMountConfig,
  FileStat,
  ListOptions,
  ReadOptions,
  RemoveOptions,
  WorkspaceFilesystem,
  WriteOptions,
} from "@mastra/core/workspace"

export type WorkspaceMutationAction =
  | "write"
  | "append"
  | "delete"
  | "copy"
  | "move"
  | "mkdir"
  | "rmdir"

export type WorkspaceMutationContext = {
  actorId: string
  requestId: string
  trustedEditorialRightsAssertion: boolean
}

export type WorkspaceMutationAuditRecord = WorkspaceMutationContext & {
  id: string
  operationId: string
  phase: "intent" | "completed"
  occurredAt: Date
  action: WorkspaceMutationAction
  path: string
  targetPath?: string
  preDigest?: string
  postDigest?: string
}

export type WorkspaceMutationAuditSink = (
  record: WorkspaceMutationAuditRecord,
) => Promise<void>

export type WorkspaceDigestReader = (
  path: string,
) => Promise<string | undefined>

const MAX_BUFFERED_AUDIT_DIGEST_BYTES = 16 * 1024 * 1024

const mutationContext = new AsyncLocalStorage<WorkspaceMutationContext>()

const currentMutationContext = (): WorkspaceMutationContext =>
  mutationContext.getStore() ?? {
    actorId: "unknown",
    requestId: randomUUID(),
    trustedEditorialRightsAssertion: false,
  }

export function runWithWorkspaceMutationContext<T>(
  context: WorkspaceMutationContext,
  callback: () => T,
): T {
  return mutationContext.run(context, callback)
}

function digest(content: FileContent): string {
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Decorates any Mastra filesystem without changing its path or lifecycle
 * contract. Mutations remain visible through Studio's native Workspace APIs,
 * while every mutation is surrounded by append-only intent and completion
 * records. A durable intent remains reconcilable if the process stops after
 * the filesystem mutation but before its completion record.
 */
export class AuditedFilesystem implements WorkspaceFilesystem {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly readOnly?: boolean
  readonly basePath?: string
  readonly icon
  readonly displayName?: string
  readonly description?: string

  constructor(
    readonly delegate: WorkspaceFilesystem,
    private readonly sink: WorkspaceMutationAuditSink,
    private readonly contextProvider: () => WorkspaceMutationContext = currentMutationContext,
    private readonly digestReader?: WorkspaceDigestReader,
  ) {
    this.id = delegate.id
    this.name = delegate.name
    this.provider = delegate.provider
    this.readOnly = delegate.readOnly
    this.basePath = delegate.basePath
    this.icon = delegate.icon
    this.displayName = delegate.displayName
    this.description = delegate.description
  }

  get status() {
    return this.delegate.status
  }

  set status(value) {
    this.delegate.status = value
  }

  get error() {
    return this.delegate.error
  }

  set error(value) {
    this.delegate.error = value
  }

  getInstructions() {
    // Deliberately suppressed — the wrapper's one divergence from its
    // delegate's contract. A non-empty description here becomes a SECOND
    // system message auto-injected into every registered agent's turns (the
    // global-Workspace fallback in @mastra/core adds a
    // WorkspaceInstructionsProcessor), which one-system-message models behind
    // the AI Gateway reject with 400 (seeker incident, 2026-08-12) and which
    // sends the bucket name to every model provider on every turn. No agent
    // can act on the description anyway: the Workspace disables inherited
    // file tools (config.ts `tools: { enabled: false }` — the coupled half of
    // this suppression). The protection rests on the processor's truthiness
    // guard skipping addSystem on "" (pinned dist fact, verified @mastra/core
    // 1.55.0 — re-verify on `@mastra/*` bumps; the processor-level pin in
    // config.test.ts is the CI guard). Restoring delegation is NOT made safe
    // by enabling tools — the one-system-message gateway constraint is
    // independent of tools — so any re-description of storage needs a
    // gateway-safe composition or a per-agent workspace, decided deliberately.
    return ""
  }

  getMountConfig(): FilesystemMountConfig {
    const config = this.delegate.getMountConfig?.()
    if (!config) throw new Error("filesystem does not support mounting")
    return config
  }

  resolveAbsolutePath(path: string): string | undefined {
    return this.delegate.resolveAbsolutePath?.(path)
  }

  realpath(path: string): Promise<string> {
    return this.delegate.realpath?.(path) ?? Promise.resolve(path)
  }

  async init(): Promise<void> {
    await this.delegate.init?.()
  }

  async destroy(): Promise<void> {
    await this.delegate.destroy?.()
  }

  async isReady(): Promise<boolean> {
    return (await this.delegate.isReady?.()) ?? this.status === "ready"
  }

  async getInfo(): Promise<FilesystemInfo> {
    const info = await this.delegate.getInfo?.()
    return (
      info ?? {
        id: this.id,
        name: this.name,
        provider: this.provider,
        status: this.status,
        readOnly: this.readOnly,
      }
    )
  }

  readFile(path: string, options?: ReadOptions): Promise<string | Buffer> {
    return this.delegate.readFile(path, options)
  }

  readdir(path: string, options?: ListOptions): Promise<FileEntry[]> {
    return this.delegate.readdir(path, options)
  }

  exists(path: string): Promise<boolean> {
    return this.delegate.exists(path)
  }

  stat(path: string): Promise<FileStat> {
    return this.delegate.stat(path)
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void> {
    const preDigest = await this.readDigest(path)
    const postDigest = digest(content)
    const operationId = randomUUID()
    await this.record(
      operationId,
      "intent",
      "write",
      path,
      undefined,
      preDigest,
      postDigest,
    )
    await this.delegate.writeFile(path, content, options)
    await this.record(
      operationId,
      "completed",
      "write",
      path,
      undefined,
      preDigest,
      postDigest,
    )
  }

  async appendFile(path: string, content: FileContent): Promise<void> {
    const preDigest = await this.readDigest(path)
    const operationId = randomUUID()
    await this.record(
      operationId,
      "intent",
      "append",
      path,
      undefined,
      preDigest,
    )
    await this.delegate.appendFile(path, content)
    await this.record(
      operationId,
      "completed",
      "append",
      path,
      undefined,
      preDigest,
      await this.readDigest(path),
    )
  }

  async deleteFile(path: string, options?: RemoveOptions): Promise<void> {
    const preDigest = await this.readDigest(path)
    const operationId = randomUUID()
    await this.record(
      operationId,
      "intent",
      "delete",
      path,
      undefined,
      preDigest,
    )
    await this.delegate.deleteFile(path, options)
    await this.record(
      operationId,
      "completed",
      "delete",
      path,
      undefined,
      preDigest,
    )
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: CopyOptions,
  ): Promise<void> {
    const preDigest = await this.readDigest(targetPath)
    const postDigest = await this.readDigest(sourcePath)
    const operationId = randomUUID()
    await this.record(
      operationId,
      "intent",
      "copy",
      sourcePath,
      targetPath,
      preDigest,
      postDigest,
    )
    await this.delegate.copyFile(sourcePath, targetPath, options)
    await this.record(
      operationId,
      "completed",
      "copy",
      sourcePath,
      targetPath,
      preDigest,
      await this.readDigest(targetPath),
    )
  }

  async moveFile(
    sourcePath: string,
    targetPath: string,
    options?: CopyOptions,
  ): Promise<void> {
    const preDigest = await this.readDigest(sourcePath)
    const operationId = randomUUID()
    await this.record(
      operationId,
      "intent",
      "move",
      sourcePath,
      targetPath,
      preDigest,
      preDigest,
    )
    await this.delegate.moveFile(sourcePath, targetPath, options)
    await this.record(
      operationId,
      "completed",
      "move",
      sourcePath,
      targetPath,
      preDigest,
      await this.readDigest(targetPath),
    )
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const operationId = randomUUID()
    await this.record(operationId, "intent", "mkdir", path)
    await this.delegate.mkdir(path, options)
    await this.record(operationId, "completed", "mkdir", path)
  }

  async rmdir(path: string, options?: RemoveOptions): Promise<void> {
    const operationId = randomUUID()
    await this.record(operationId, "intent", "rmdir", path)
    await this.delegate.rmdir(path, options)
    await this.record(operationId, "completed", "rmdir", path)
  }

  private async readDigest(path: string): Promise<string | undefined> {
    if (!(await this.delegate.exists(path))) return undefined
    const stat = await this.delegate.stat(path)
    if (stat.type !== "file") return undefined
    if (this.digestReader) return this.digestReader(path)
    if (stat.size > MAX_BUFFERED_AUDIT_DIGEST_BYTES) {
      throw new Error(
        `audit digest requires streaming for files larger than ${MAX_BUFFERED_AUDIT_DIGEST_BYTES} bytes`,
      )
    }
    const content = await this.delegate.readFile(path)
    return digest(content)
  }

  private async record(
    operationId: string,
    phase: WorkspaceMutationAuditRecord["phase"],
    action: WorkspaceMutationAction,
    path: string,
    targetPath?: string,
    preDigest?: string,
    postDigest?: string,
  ): Promise<void> {
    await this.sink({
      id: randomUUID(),
      operationId,
      phase,
      occurredAt: new Date(),
      action,
      path,
      targetPath,
      preDigest,
      postDigest,
      ...this.contextProvider(),
    })
  }
}
