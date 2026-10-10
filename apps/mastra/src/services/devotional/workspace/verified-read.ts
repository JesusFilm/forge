import { createHash } from "node:crypto"

import type { WorkspaceFilesystem } from "@mastra/core/workspace"

import { DevotionalWorkspaceError } from "./errors"
import { toNativeWorkspaceFilesystemPath } from "./inventory"
import type { DevotionalSourceRef } from "./state-schema"

/** Stable, digest-pinned read shared by attempt consumers and side-effect gates. */
export async function readVerifiedWorkspaceSource(
  filesystem: WorkspaceFilesystem,
  ref: DevotionalSourceRef,
): Promise<Buffer> {
  try {
    const nativePath = toNativeWorkspaceFilesystemPath(ref.path)
    const before = await filesystem.stat(nativePath)
    const value = await filesystem.readFile(nativePath)
    const bytes = typeof value === "string" ? Buffer.from(value) : value
    const after = await filesystem.stat(nativePath)
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (
      before.size !== after.size ||
      before.modifiedAt.getTime() !== after.modifiedAt.getTime() ||
      bytes.byteLength !== ref.size ||
      digest !== ref.digest
    ) {
      throw new Error("digest or stat changed")
    }
    return Buffer.from(bytes)
  } catch (cause) {
    throw new DevotionalWorkspaceError(
      "source-changed",
      `Workspace source changed after reconciliation: ${ref.path}`,
      { cause, details: { path: ref.path }, retryable: true },
    )
  }
}
