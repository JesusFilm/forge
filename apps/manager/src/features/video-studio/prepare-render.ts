import { studioDocumentSchema } from "@forge/studio-contracts"
import { attachPreparedSources } from "./preview-state"
import type { EditorSession } from "./editor-session"
class ShortsRenderPreparationError extends Error {}
/** Materialize only on an explicit render action; never overwrite edits made while waiting. */
export async function prepareRender(session: EditorSession, projectId: string) {
  const before = session.getSnapshot()
  const response = await fetch("/api/shorts/render-prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, document: before.document }),
    signal: AbortSignal.timeout(300000),
  })
  const payload = await response.json()
  if (!response.ok)
    throw new ShortsRenderPreparationError(
      payload.error ?? "Render preparation failed",
    )
  const now = session.getSnapshot()
  if (
    now.document !== before.document ||
    now.revision !== before.revision ||
    now.status !== "saved"
  )
    throw new ShortsRenderPreparationError(
      "The project changed during preparation. Save and render again.",
    )
  const next = attachPreparedSources(
    now.document,
    before.document,
    studioDocumentSchema.parse(payload.document),
  )
  if (JSON.stringify(next) !== JSON.stringify(now.document)) {
    session.edit(() => next)
    await session.save()
  }
  const saved = session.getSnapshot()
  if (saved.status !== "saved")
    throw new ShortsRenderPreparationError(
      "Save the prepared sources before rendering",
    )
  return saved.revision
}
