import { studioIdSchema } from "@forge/studio-contracts"
export type RenderHandoff = { attemptId: string; revision: number }
export function parseRenderHandoff(
  query: Record<string, string | string[] | undefined>,
): RenderHandoff | undefined {
  const id = studioIdSchema.safeParse(query.renderAttemptId)
  const revision =
    typeof query.revision === "string" && /^\d+$/.test(query.revision)
      ? Number(query.revision)
      : NaN
  return id.success && Number.isSafeInteger(revision) && revision > 0
    ? { attemptId: id.data, revision }
    : undefined
}
/** Advisory browser guard. Admin repeats exact identity/current revision checks under lock. */
export function canApproveRenderedEvidence(input: {
  selectedAttemptId: string | null
  reviewedAttemptId: string | null
  evidenceRevision: number | null
  currentRevision: number
  editorRevision: number
  editorStatus: string
  stale: boolean
  locked: boolean
}) {
  return Boolean(
    input.selectedAttemptId &&
    input.reviewedAttemptId === input.selectedAttemptId &&
    input.evidenceRevision === input.currentRevision &&
    input.evidenceRevision === input.editorRevision &&
    input.editorStatus === "saved" &&
    !input.stale &&
    !input.locked,
  )
}
