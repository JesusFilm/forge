import type { WorkspaceFilesystem } from "@mastra/core/workspace"

import { DevotionalWorkspaceError } from "./errors"
import type { DevotionalSourceRef } from "./state-schema"
import { readVerifiedWorkspaceSource } from "./verified-read"

type WorkspaceOwner = {
  getWorkspace(): { filesystem?: WorkspaceFilesystem } | undefined
}

export async function verifySelectedWorkspaceSources(
  filesystem: WorkspaceFilesystem,
  refs: DevotionalSourceRef[],
): Promise<void> {
  for (const ref of refs) {
    await readVerifiedWorkspaceSource(filesystem, ref)
  }
}

export async function verifyWorkflowWorkspaceSources(
  mastra: WorkspaceOwner,
  refs: DevotionalSourceRef[],
): Promise<void> {
  const filesystem = mastra.getWorkspace()?.filesystem
  if (!filesystem) {
    throw new DevotionalWorkspaceError(
      "hybrid-search-unavailable",
      "Devotional Workspace filesystem is unavailable",
    )
  }
  await verifySelectedWorkspaceSources(filesystem, refs)
}
