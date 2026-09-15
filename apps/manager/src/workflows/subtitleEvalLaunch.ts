import { env } from "@/config/env"
import { resolveCreateRunRequest } from "@/features/subtitle-lab/subtitle-lab-contract"
import type { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import type { ManagerSessionPrincipal } from "@/lib/manager-session-cookie"
import type { SubtitleEvalWorkflowInput } from "@/workflows/subtitleEval"
import {
  buildSubtitleEvalWorkflowInput,
  recoverSubtitleEvalRun,
} from "@/workflows/subtitleEvalRecovery"

export async function createAndLaunchSubtitleEvalRun(input: {
  rawRequest: unknown
  session: ManagerSessionPrincipal
  client: SubtitleLabAdminClient
  launch: (workflowInput: SubtitleEvalWorkflowInput) => Promise<unknown>
  deployedCodeRevision?: string
}) {
  const request = resolveCreateRunRequest(
    input.rawRequest,
    input.deployedCodeRevision ?? loadSubtitleEvalCodeRevision(),
  )
  const corpus = await input.client.getCorpusVersion(request.corpusVersionId)
  if (!corpus) throw new Error("Subtitle evaluation corpus was not found.")
  const selected = new Set(request.corpusCellIds)
  if (
    selected.size !== request.corpusCellIds.length ||
    corpus.cells.filter((cell) => selected.has(cell.id)).length !==
      selected.size
  ) {
    throw new Error("Run selection is not part of the frozen corpus.")
  }
  const created = await input.client.createRun(input.session, request)
  if (created.replayed) {
    return { runId: created.id, status: created.status, replayed: true }
  }
  const run = await input.client.getRun(created.id)
  if (!run) throw new Error("Created subtitle evaluation run was not found.")
  const workflowInput = buildSubtitleEvalWorkflowInput(run, corpus)
  try {
    await input.launch(workflowInput)
  } catch {
    await recoverSubtitleEvalRun({
      client: input.client,
      runId: run.id,
      dispatchFailed: true,
      launch: input.launch,
    })
  }
  return { runId: created.id, status: created.status, replayed: false }
}

export function loadSubtitleEvalCodeRevision(
  source: {
    nodeEnv: "development" | "test" | "production"
    railwayRevision?: string
    gitRevision?: string
  } = {
    nodeEnv: env.NODE_ENV,
    railwayRevision: env.RAILWAY_GIT_COMMIT_SHA,
    gitRevision: env.GIT_COMMIT_SHA,
  },
) {
  const revision = (source.railwayRevision ?? source.gitRevision)?.trim()
  if (revision && revision !== "unknown") return revision.slice(0, 128)
  if (source.nodeEnv === "production") {
    throw new Error(
      "Subtitle evaluation requires a deployed source code revision.",
    )
  }
  return "local-development"
}
