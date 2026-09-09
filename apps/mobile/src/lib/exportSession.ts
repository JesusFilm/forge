/**
 * KTD5: in-flight raw exports live in a memory-only session store, and a minimal
 * staging note persists beside it. The store answers "what is running now" and
 * dies with the process; the note is what the next launch reconciles against.
 *
 * A factory plus a lazy module singleton, matching `miniPlayer/store.ts`: every
 * behaviour decision unit-tests against a fresh instance with no React and no
 * native module, while the app reads one store. Storage arrives through an
 * INJECTED port, so this module never imports AsyncStorage.
 */

import { telemetryErrorMessage } from "./downloadErrors"

/**
 * KTD5/KD4: the note is NOT a Download Record. Its key sits outside the
 * `offline.` namespace so no offline reconciliation path can read it as
 * offline state.
 */
export const EXPORT_STAGING_NOTES_STORAGE_KEY = "rawexport.staging.notes"

/** Schema version; a note from another version is dropped on read. */
export const EXPORT_STAGING_NOTE_VERSION = 1

/**
 * Where the saved video landed. iOS with an add-only grant cannot create a
 * named album, so R17's fallback saves to the library and the confirmation
 * names the library instead.
 */
export type ExportAlbumIntent = "album" | "library"

/**
 * How one export ended. `blocked` is a pre-transfer refusal by storage or
 * policy, `refused` is a denied library permission, and `abandoned` is what a
 * killed process left for the launch sweep to report.
 */
export type ExportOutcome =
  | "saved"
  | "failed"
  | "blocked"
  | "refused"
  | "cancelled"
  | "abandoned"

/**
 * The minimal record of a staged file (KTD5). `transferFinished` is the flag
 * R28's two cases turn on: false means discard the stage, true means finish the
 * library write the killed process never ran.
 */
export type ExportStagingNote = {
  version: number
  /** The video slug this export saves. */
  target: string
  /** The run that staged it — one per single export, one per series run. */
  runId: string
  stagedPath: string
  albumIntent: ExportAlbumIntent
  transferFinished: boolean
}

/** Injected persistence, so this module needs no native module under jest. */
export type ExportStoragePort = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
}

/** One export in flight, as every indicator surface reads it (R16). */
export type ExportSessionEntry = {
  target: string
  runId: string
  title: string | null
  seriesSlug: string | null
  /** Transfer progress, 0 to 1. */
  progress: number
  cancelRequested: boolean
}

export type ExportSessionSnapshot = {
  byTarget: Readonly<Record<string, ExportSessionEntry>>
  /** Non-zero holds KTD3's fence over the engine's global configure call. */
  activeCount: number
  /**
   * Which targets are exporting, with an identity that survives a progress
   * tick. The snapshot itself cannot: progress lands about once a second, and a
   * consumer that only cares WHETHER a target is exporting would otherwise
   * recompute — and re-render — on every tick.
   */
  targets: ReadonlySet<string>
}

/** The capabilities one run gets over its own slot and its own note. */
export type ExportRunHandle = {
  target: string
  runId: string
  /** Publish transfer progress; a fraction outside 0 to 1 is clamped. */
  publishProgress: (fraction: number) => void
  isCancelRequested: () => boolean
  /** Write (or refresh) the staging note for the file being staged. */
  stage: (args: {
    stagedPath: string
    albumIntent: ExportAlbumIntent
  }) => Promise<void>
  /** The bytes are on disk; only the library write remains (R28). */
  markTransferFinished: () => Promise<void>
  /**
   * KTD4: the app is not active, so the library write is handed to the next
   * foreground transition or the launch sweep. The note then outlives this run.
   */
  deferStagingNote: () => void
}

export type ExportRunInput = {
  target: string
  runId: string
  title?: string | null
  seriesSlug?: string | null
  /** Stops the underlying transfer when the viewer cancels (R22, R30). */
  onCancel?: () => void
}

export type ExportRunResult =
  /** R27: the viewer is told the target is already exporting. */
  | { started: false; reason: "alreadyExporting" }
  | { started: true; outcome: ExportOutcome; errorMessage: string | null }

export type ExportSessionStore = ReturnType<typeof createExportSessionStore>

const EMPTY_TARGETS: ReadonlySet<string> = new Set()

const EMPTY_SNAPSHOT: ExportSessionSnapshot = {
  byTarget: {},
  activeCount: 0,
  targets: EMPTY_TARGETS,
}

const NOOP_STORAGE: ExportStoragePort = {
  get: async () => null,
  set: async () => undefined,
  remove: async () => undefined,
}

/**
 * Progress fractions arrive from native byte counts and from three display
 * surfaces. A non-finite one would render as a broken ring, so every consumer
 * bounds it the same way.
 */
export function clampFraction(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function isStagingNote(value: unknown): value is ExportStagingNote {
  if (typeof value !== "object" || value === null) return false
  const note = value as Partial<ExportStagingNote>
  return (
    note.version === EXPORT_STAGING_NOTE_VERSION &&
    typeof note.target === "string" &&
    typeof note.runId === "string" &&
    typeof note.stagedPath === "string" &&
    (note.albumIntent === "album" || note.albumIntent === "library") &&
    typeof note.transferFinished === "boolean"
  )
}

export function createExportSessionStore(deps?: {
  storage?: ExportStoragePort
}) {
  let storage: ExportStoragePort = deps?.storage ?? NOOP_STORAGE
  let snapshot: ExportSessionSnapshot = EMPTY_SNAPSHOT
  const entries = new Map<string, ExportSessionEntry>()
  const cancellers = new Map<string, () => void>()
  const listeners = new Set<() => void>()

  let targets: ReadonlySet<string> = EMPTY_TARGETS

  /** Rebuild the target set ONLY when membership changed, so a progress tick
   *  leaves its identity alone. */
  function sameTargets(): boolean {
    if (targets.size !== entries.size) return false
    for (const target of entries.keys()) if (!targets.has(target)) return false
    return true
  }

  /** A listener's throw is contained: the terminal notification runs inside the
   *  run's `finally`, where an escaping error would replace the outcome the
   *  export actually reached. */
  function commit() {
    const byTarget: Record<string, ExportSessionEntry> = {}
    for (const [target, entry] of entries) byTarget[target] = entry
    if (!sameTargets()) targets = new Set(entries.keys())
    snapshot = { byTarget, activeCount: entries.size, targets }
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // Deliberately ignored; see the note above.
      }
    }
  }

  /** All notes live under ONE key, so two targets cannot each hold a shard the
   *  other overwrites. Reads never throw: a corrupt value reads as empty. */
  async function readNotes(): Promise<Record<string, ExportStagingNote>> {
    const raw = await storage.get(EXPORT_STAGING_NOTES_STORAGE_KEY)
    if (!raw) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {}
    }
    if (typeof parsed !== "object" || parsed === null) return {}
    const notes: Record<string, ExportStagingNote> = {}
    for (const [target, value] of Object.entries(parsed)) {
      if (isStagingNote(value)) notes[target] = value
    }
    return notes
  }

  /**
   * Read-modify-write on one key loses an update when two runs interleave, so
   * every mutation queues behind the last one. Same idiom, same reason, as
   * `onQueue` in watchProgress/sync.ts — a private closure there, so extracting
   * one owner would touch an unrelated feature.
   */
  let noteTail: Promise<unknown> = Promise.resolve()
  function serializeNotes<T>(operation: () => Promise<T>): Promise<T> {
    const next = noteTail.then(operation, operation)
    noteTail = next.catch(() => undefined)
    return next
  }

  function mutateNotes(
    change: (notes: Record<string, ExportStagingNote>) => void,
  ): Promise<void> {
    return serializeNotes(async () => {
      const notes = await readNotes()
      change(notes)
      if (Object.keys(notes).length === 0) {
        await storage.remove(EXPORT_STAGING_NOTES_STORAGE_KEY)
        return
      }
      await storage.set(EXPORT_STAGING_NOTES_STORAGE_KEY, JSON.stringify(notes))
    })
  }

  async function clearStagingNote(target: string): Promise<void> {
    await mutateNotes((notes) => {
      delete notes[target]
    })
  }

  return {
    getSnapshot(): ExportSessionSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** The provider wires AsyncStorage here; until then the port no-ops. */
    attachStorage(port: ExportStoragePort): void {
      storage = port
    },

    /**
     * Reserve the target's slot and run the export inside it. R27: a target
     * already in flight is refused and the callback never runs.
     *
     * The reservation is released in a `finally` that wraps the WHOLE body —
     * the start notification included — because anything throwing between the
     * reservation and the transfer would otherwise leak the slot forever.
     */
    async run(
      input: ExportRunInput,
      work: (handle: ExportRunHandle) => ExportOutcome | Promise<ExportOutcome>,
    ): Promise<ExportRunResult> {
      const { target, runId } = input
      if (entries.has(target)) {
        return { started: false, reason: "alreadyExporting" }
      }
      entries.set(target, {
        target,
        runId,
        title: input.title ?? null,
        seriesSlug: input.seriesSlug ?? null,
        progress: 0,
        cancelRequested: false,
      })
      if (input.onCancel) cancellers.set(target, input.onCancel)
      let keepNote = false

      try {
        commit()
        const live = (): ExportSessionEntry | undefined => {
          const entry = entries.get(target)
          return entry?.runId === runId ? entry : undefined
        }
        const handle: ExportRunHandle = {
          target,
          runId,
          publishProgress(fraction) {
            const entry = live()
            if (!entry) return
            const clamped = clampFraction(fraction)
            if (clamped === entry.progress) return
            entries.set(target, { ...entry, progress: clamped })
            commit()
          },
          isCancelRequested() {
            return live()?.cancelRequested ?? false
          },
          async stage({ stagedPath, albumIntent }) {
            await mutateNotes((notes) => {
              notes[target] = {
                version: EXPORT_STAGING_NOTE_VERSION,
                target,
                runId,
                stagedPath,
                albumIntent,
                transferFinished: false,
              }
            })
          },
          async markTransferFinished() {
            await mutateNotes((notes) => {
              const note = notes[target]
              if (note) notes[target] = { ...note, transferFinished: true }
            })
          },
          deferStagingNote() {
            keepNote = true
          },
        }

        const outcome = await work(handle)
        const cancelled = live()?.cancelRequested ?? false
        return {
          started: true,
          // A cancel is not a failure: R21 counts it separately and R22 keeps
          // what already saved.
          outcome: cancelled && outcome === "failed" ? "cancelled" : outcome,
          errorMessage: null,
        }
      } catch (error) {
        const cancelled = entries.get(target)?.cancelRequested ?? false
        return {
          started: true,
          outcome: cancelled ? "cancelled" : "failed",
          errorMessage: telemetryErrorMessage(error),
        }
      } finally {
        entries.delete(target)
        cancellers.delete(target)
        // A storage fault must not turn a saved export into a rejection; the
        // launch sweep reconciles a note the clear could not remove.
        if (!keepNote) await clearStagingNote(target).catch(() => undefined)
        commit()
      }
    },

    /** Viewer cancel (R22, R30). Reports whether a run was there to cancel. */
    requestCancel(target: string): boolean {
      const entry = entries.get(target)
      if (!entry) return false
      if (!entry.cancelRequested) {
        entries.set(target, { ...entry, cancelRequested: true })
        commit()
      }
      cancellers.get(target)?.()
      return true
    },

    writeStagingNote(note: Omit<ExportStagingNote, "version">): Promise<void> {
      return mutateNotes((notes) => {
        notes[note.target] = { version: EXPORT_STAGING_NOTE_VERSION, ...note }
      })
    },

    async readStagingNote(target: string): Promise<ExportStagingNote | null> {
      const notes = await serializeNotes(readNotes)
      return notes[target] ?? null
    },

    /** Every surviving note, for the launch sweep to reconcile (U7). */
    async listStagingNotes(): Promise<ExportStagingNote[]> {
      const notes = await serializeNotes(readNotes)
      return Object.values(notes)
    },

    clearStagingNote,
  }
}

let store: ExportSessionStore | null = null

/** The app-wide export session store. */
export function getExportSessionStore(): ExportSessionStore {
  if (!store) store = createExportSessionStore()
  return store
}

/** Test-only: drop the singleton so a suite starts from a clean store. */
export function resetExportSessionStoreForTests(): void {
  store = null
}
