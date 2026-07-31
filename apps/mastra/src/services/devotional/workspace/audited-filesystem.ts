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
 * while every successful mutation is followed by an append-only audit record.
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

  getInstructions(
    options?: Parameters<
      NonNullable<WorkspaceFilesystem["getInstructions"]>
    >[0],
  ) {
    return this.delegate.getInstructions?.(options) ?? ""
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
    await this.delegate.writeFile(path, content, options)
    await this.record("write", path, undefined, preDigest, postDigest)
  }

  async appendFile(path: string, content: FileContent): Promise<void> {
    const preDigest = await this.readDigest(path)
    await this.delegate.appendFile(path, content)
    await this.record(
      "append",
      path,
      undefined,
      preDigest,
      await this.readDigest(path),
    )
  }

  async deleteFile(path: string, options?: RemoveOptions): Promise<void> {
    const preDigest = await this.readDigest(path)
    await this.delegate.deleteFile(path, options)
    await this.record("delete", path, undefined, preDigest, undefined)
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: CopyOptions,
  ): Promise<void> {
    const preDigest = await this.readDigest(targetPath)
    await this.delegate.copyFile(sourcePath, targetPath, options)
    await this.record(
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
    await this.delegate.moveFile(sourcePath, targetPath, options)
    await this.record(
      "move",
      sourcePath,
      targetPath,
      preDigest,
      await this.readDigest(targetPath),
    )
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.delegate.mkdir(path, options)
    await this.record("mkdir", path)
  }

  async rmdir(path: string, options?: RemoveOptions): Promise<void> {
    await this.delegate.rmdir(path, options)
    await this.record("rmdir", path)
  }

  private async readDigest(path: string): Promise<string | undefined> {
    if (!(await this.delegate.exists(path))) return undefined
    const stat = await this.delegate.stat(path)
    if (stat.type !== "file") return undefined
    const content = await this.delegate.readFile(path)
    return digest(content)
  }

  private async record(
    action: WorkspaceMutationAction,
    path: string,
    targetPath?: string,
    preDigest?: string,
    postDigest?: string,
  ): Promise<void> {
    await this.sink({
      id: randomUUID(),
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
