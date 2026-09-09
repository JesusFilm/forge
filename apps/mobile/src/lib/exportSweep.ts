/**
 * U7: what a launch does with the files and the notes an interrupted raw export
 * left behind, and the KTD3 fence that keeps the engine's global configure call
 * away from an export in flight.
 *
 * The decision is a pure function over enumerated inputs, so the whole table
 * unit-tests with no React, no AsyncStorage and no native module. The provider
 * supplies the effects, and `applyExportSweep` routes each action to exactly one
 * of them.
 *
 * The sweep enumerates the export ROOT rather than the live task list. KTD4's
 * window — the transfer is complete and the library write has not run — has no
 * live native task at all, so a task-based sweep cannot see it.
 */

import type { ExportSessionSnapshot, ExportStagingNote } from "./exportSession"
import { sanitizeSegment } from "./offlineFiles"
import { buildExportTaskId } from "./rawExport"
import { RAW_EXPORT_ENABLED } from "./rawExportConstants"

export type ExportSweepInput = {
  /** Every staging note that survived the last process. */
  notes: readonly ExportStagingNote[]
  /** Entry names directly under the export root — one directory per target. */
  stagedEntries: readonly string[]
  /** Targets whose noted staged file is still on disk. */
  existingStagedFiles: ReadonlySet<string>
  /** Ids of every native task that survived, export ids included. */
  liveTaskIds: ReadonlySet<string>
  /**
   * R33's build-time switch. It defaults to the shipped constant so no call
   * site can pin the posture; a test passes it to reach the other branch.
   */
  enabled?: boolean
}

export type ExportSweepAction =
  /** R28: the transfer finished, so the library write it never ran runs now. */
  | { action: "finish"; note: ExportStagingNote }
  /** R18: interrupted while staging — remove the file, report it unfinished. */
  | { action: "discard"; note: ExportStagingNote; stopTaskId: string | null }
  /** A note whose staged file is already gone: nothing to save, nothing to say. */
  | { action: "dropNote"; target: string }
  /** A staged directory no note claims — bytes nobody can attribute. */
  | { action: "removeStagedDir"; target: string }

export function planExportSweep(input: ExportSweepInput): ExportSweepAction[] {
  const enabled = input.enabled ?? RAW_EXPORT_ENABLED
  const actions: ExportSweepAction[] = []
  const claimed = new Set<string>()

  for (const note of input.notes) {
    if (!input.existingStagedFiles.has(note.target)) {
      // The directory stays UNCLAIMED on purpose: the orphan pass below removes
      // it when some other leftover kept it alive.
      actions.push({ action: "dropNote", target: note.target })
      continue
    }
    claimed.add(sanitizeSegment(note.target))
    // R28/R33: only a finished transfer takes the irreversible step, and only
    // while the feature is on. A disabled build discards the stage instead.
    if (note.transferFinished && enabled) {
      actions.push({ action: "finish", note })
      continue
    }
    const taskId = buildExportTaskId(note.target)
    actions.push({
      action: "discard",
      note,
      stopTaskId: input.liveTaskIds.has(taskId) ? taskId : null,
    })
  }

  for (const entry of input.stagedEntries) {
    if (claimed.has(entry)) continue
    actions.push({ action: "removeStagedDir", target: entry })
  }

  return actions
}

/**
 * The two adapter calls the sweep may make. Passing the adapter itself, rather
 * than two named callbacks, is what stops a call site swapping them.
 */
export type ExportSweepAdapter = {
  completeStagedExport: (note: ExportStagingNote) => Promise<unknown>
  discardStagedExport: (note: ExportStagingNote) => Promise<unknown>
}

export type ExportSweepEffects = {
  adapter: ExportSweepAdapter
  clearStagingNote: (target: string) => Promise<unknown>
  removeStagedDir: (target: string) => Promise<unknown>
  stopExportTask: (taskId: string) => Promise<unknown>
  /** The launch effect's own guard; a torn-down provider stops the sweep. */
  isCancelled?: () => boolean
}

/**
 * Perform one planned sweep. Each action is contained on its own, because a
 * storage fault on one target must not strand every target after it.
 */
export async function applyExportSweep(
  actions: readonly ExportSweepAction[],
  effects: ExportSweepEffects,
): Promise<void> {
  for (const action of actions) {
    if (effects.isCancelled?.()) return
    try {
      switch (action.action) {
        case "finish":
          await effects.adapter.completeStagedExport(action.note)
          break
        case "discard":
          // The transfer stops first: a live task writing into the file the
          // discard is about to remove would re-create the stage behind it.
          if (action.stopTaskId) await effects.stopExportTask(action.stopTaskId)
          await effects.adapter.discardStagedExport(action.note)
          break
        case "dropNote":
          await effects.clearStagingNote(action.target)
          break
        case "removeStagedDir":
          await effects.removeStagedDir(action.target)
          break
      }
    } catch {
      // Deliberately ignored; see the note above.
    }
  }
}

// ── KTD3: the engine-config fence ───────────────────────────────────

export type EngineConfigFenceDeps = {
  /** `configureDownloadEngine`. It recreates the shared URLSession. */
  configure: (opts: { wifiOnly: boolean }) => void
  session: {
    getSnapshot: () => ExportSessionSnapshot
    subscribe: (listener: () => void) => () => void
  }
}

export type EngineConfigFence = {
  /** Apply the preference now, or hold it until the last export settles. */
  setWifiOnly: (wifiOnly: boolean) => void
  dispose: () => void
}

/**
 * KTD3: `configureDownloadEngine` tears down and recreates the shared
 * URLSession, which CANCELS every in-flight transfer — the engine then reports
 * a viewer cancel. A raw export runs on that same session, so a wifi-only
 * toggle mid-export would silently kill it. The fence holds the new value and
 * applies it when the export session store empties.
 */
export function createEngineConfigFence(
  deps: EngineConfigFenceDeps,
): EngineConfigFence {
  let held: boolean | null = null

  const apply = (wifiOnly: boolean): void => {
    try {
      deps.configure({ wifiOnly })
    } catch {
      // Engine unavailable (a build without the native module) — the read
      // surface still works and downloads stay inert until a dev build.
    }
  }

  const unsubscribe = deps.session.subscribe(() => {
    if (held === null) return
    if (deps.session.getSnapshot().activeCount > 0) return
    const pending = held
    held = null
    apply(pending)
  })

  return {
    setWifiOnly(wifiOnly) {
      if (deps.session.getSnapshot().activeCount > 0) {
        held = wifiOnly
        return
      }
      held = null
      apply(wifiOnly)
    },
    dispose: unsubscribe,
  }
}
