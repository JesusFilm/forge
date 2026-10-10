import type { ExportFolder } from "./rawExport"

/**
 * The one sequence both download sheets run when the viewer confirms a raw
 * export: ask for a folder, dismiss the sheet, start the run. The ORDER is the
 * point — a dismissed sheet has no view controller to present a picker from,
 * and a run that has started cannot wait on one. A dismissal stops the
 * sequence before anything happens, so the sheet stays open for a retry.
 */
export type RawExportStartDeps = {
  pickFolder: () => Promise<ExportFolder | null>
  dismiss: () => void
  start: (folder: ExportFolder) => void
}

export type RawExportStartOutcome = "started" | "dismissed"

export async function startRawExportAfterPick(
  deps: RawExportStartDeps,
): Promise<RawExportStartOutcome> {
  const folder = await deps.pickFolder()
  if (!folder) return "dismissed"
  deps.dismiss()
  deps.start(folder)
  return "started"
}
