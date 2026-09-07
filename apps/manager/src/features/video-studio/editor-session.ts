import {
  studioDocumentSchema,
  studioApplySchema,
  type StudioDocument,
  type StudioProject,
  type StudioApply,
  type StudioCommandResult,
} from "@forge/studio-contracts"

type Transport = {
  read: () => Promise<StudioProject>
  apply: (input: StudioApply) => Promise<StudioCommandResult>
}
class StudioEditorError extends Error {}

export type EditorSnapshot = {
  document: StudioDocument
  revision: number
  selection: string | null
  playhead: number
  status: "saved" | "unsaved" | "saving" | "failed" | "conflict"
  error: string | null
  remote: StudioProject | null
  canUndo: boolean
  canRedo: boolean
  editable: boolean
}
const equal = (a: StudioDocument, b: StudioDocument) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Owns a local editing session and its revision-bound save, not canonical persistence. */
export class EditorSession {
  private state: EditorSnapshot
  private saved: StudioDocument
  private undoStack: StudioDocument[] = []
  private redoStack: StudioDocument[] = []
  private flight: StudioApply | null = null
  private listeners = new Set<() => void>()
  constructor(
    private project: StudioProject,
    private transport: Transport,
  ) {
    this.saved = project.document
    this.state = {
      document: project.document,
      revision: project.revision,
      selection: null,
      playhead: 0,
      status: "saved",
      error: null,
      remote: null,
      canUndo: false,
      canRedo: false,
      editable: project.lifecycle === "DRAFT" && !project.firstPublishedAt,
    }
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = () => this.state
  private set(patch: Partial<EditorSnapshot>) {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    }
    this.listeners.forEach((fn) => fn())
  }
  select(id: string | null) {
    this.set({ selection: id })
  }
  seek(frame: number) {
    this.set({
      playhead: Math.max(
        0,
        Math.min(Math.round(frame), this.state.document.durationInFrames - 1),
      ),
    })
  }
  edit(change: (doc: StudioDocument) => StudioDocument) {
    if (!this.state.editable) return
    const next = studioDocumentSchema.parse(
      change(structuredClone(this.state.document)),
    )
    if (equal(next, this.state.document)) return
    this.undoStack.push(this.state.document)
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack = []
    this.set({
      document: next,
      status: this.dirtyStatus(),
      error: null,
    })
  }
  private dirtyStatus(): EditorSnapshot["status"] {
    return this.state.status === "saving" || this.state.status === "conflict"
      ? this.state.status
      : "unsaved"
  }
  undo() {
    if (!this.state.editable) return
    const next = this.undoStack.pop()
    if (!next || !this.state.editable) return
    this.redoStack.push(this.state.document)
    this.set({
      document: next,
      status: this.dirtyStatus(),
    })
  }
  redo() {
    if (!this.state.editable) return
    const next = this.redoStack.pop()
    if (!next || !this.state.editable) return
    this.undoStack.push(this.state.document)
    this.set({
      document: next,
      status: this.dirtyStatus(),
    })
  }
  recovery() {
    return {
      document: this.state.document,
      revision: this.state.revision,
      flight: this.flight,
    }
  }
  recover(raw: {
    document: StudioDocument
    revision: number
    flight: StudioApply | null
  }) {
    const document = studioDocumentSchema.parse(raw.document)
    if (equal(document, this.saved) && !raw.flight) return
    const flight = raw.flight ? studioApplySchema.parse(raw.flight) : null
    if (
      flight &&
      (flight.projectId !== this.project.projectId ||
        flight.operations.length !== 1 ||
        flight.operations[0]?.kind !== "restore-document")
    )
      throw new StudioEditorError("Invalid recovered save")
    this.flight = flight
    this.set({
      document,
      status: flight
        ? "failed"
        : raw.revision === this.state.revision
          ? "unsaved"
          : "conflict",
      remote: raw.revision === this.state.revision ? null : this.project,
    })
  }
  async save() {
    if (
      !this.state.editable ||
      this.state.status === "saving" ||
      this.state.status === "conflict"
    )
      return
    const input = this.flight ?? {
      projectId: this.project.projectId,
      expectedRevision: this.state.revision,
      idempotencyKey: crypto.randomUUID(),
      operations: [
        { kind: "restore-document" as const, document: this.state.document },
      ],
    }
    this.flight = input
    this.set({ status: "saving", error: null })
    try {
      const result = await this.transport.apply(input)
      const operation = input.operations[0]
      if (operation?.kind !== "restore-document")
        throw new StudioEditorError("Invalid recovered save")
      this.saved = operation.document
      this.flight = null
      this.set({
        revision: result.revision,
        status: equal(this.saved, this.state.document) ? "saved" : "unsaved",
        error: null,
      })
    } catch (error) {
      const conflict =
        error instanceof Error &&
        (error.message === "CONFLICT" ||
          ("status" in error && error.status === 409))
      const remote = conflict
        ? await this.transport.read().catch(() => null)
        : null
      this.set({
        status: conflict ? "conflict" : "failed",
        remote,
        error: conflict
          ? "This project changed in another session. Compare versions before saving."
          : "Save failed. Your changes are retained; retry sends the same save.",
      })
    }
  }
  async reload() {
    const remote = await this.transport.read()
    this.project = remote
    this.saved = remote.document
    this.flight = null
    this.undoStack = []
    this.redoStack = []
    this.set({
      document: remote.document,
      revision: remote.revision,
      status: "saved",
      remote: null,
      error: null,
      editable: remote.lifecycle === "DRAFT" && !remote.firstPublishedAt,
    })
  }
  /** Explicit operator reconciliation, never an automatic last-write-wins retry. */
  async useLocalVersion() {
    const remote = this.state.remote
    if (!remote) return
    this.project = remote
    this.saved = remote.document
    this.flight = null
    this.set({
      revision: remote.revision,
      remote: null,
      error: null,
      status: "unsaved",
      editable: remote.lifecycle === "DRAFT" && !remote.firstPublishedAt,
    })
    await this.save()
  }
}
