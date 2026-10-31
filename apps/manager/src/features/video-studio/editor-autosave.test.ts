import { afterEach, expect, it, vi } from "vitest"
import type { Short, StudioApply } from "@forge/studio-contracts"
import { EditorSession } from "./editor-session"
import { startEditorAutosave } from "./editor-autosave"

const project: Short = {
  projectId: "autosave",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Before",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    tracks: [{ id: "audio", kind: "audio" }],
    components: [],
    items: [
      {
        id: "ending",
        kind: "audio",
        trackId: "audio",
        startFrame: 240,
        durationInFrames: 60,
        asset: { assetId: "audio", versionId: "v1", digest: "a".repeat(64) },
        sourceStartMs: 0,
        volume: 1,
      },
    ],
  },
}
class FixtureError extends Error {}
afterEach(() => vi.useRealTimers())

function fixture() {
  let stored = structuredClone(project)
  const apply = vi.fn(async (input: StudioApply) => {
    expect(input.expectedRevision).toBe(stored.revision)
    const operation = input.operations[0]
    if (operation.kind !== "restore-document")
      throw new FixtureError("Expected snapshot")
    stored = {
      ...stored,
      revision: stored.revision + 1,
      document: operation.document,
    }
    return {
      projectId: stored.projectId,
      revision: stored.revision,
      outcome: "ACCEPTED" as const,
    }
  })
  const session = new EditorSession(project, {
    read: async () => stored,
    apply,
  })
  return { session, apply, stored: () => stored }
}

it("autosaves audio deletion without Save, coalesces edits and ignores playback", async () => {
  vi.useFakeTimers()
  const f = fixture(),
    stop = startEditorAutosave(f.session)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.apply).not.toHaveBeenCalled()
  f.session.edit((d) => ({ ...d, items: [] }))
  await vi.advanceTimersByTimeAsync(400)
  f.session.edit((d) => ({ ...d, title: "After" }))
  await vi.advanceTimersByTimeAsync(500)
  f.session.select("ending")
  f.session.reportPlaybackFrame(24)
  await vi.advanceTimersByTimeAsync(250)
  expect(f.apply).toHaveBeenCalledTimes(1)
  expect(f.stored().document).toMatchObject({ title: "After", items: [] })
  expect(f.session.getSnapshot()).toMatchObject({
    status: "saved",
    hasUnsavedChanges: false,
  })
  stop()
})

it("serializes changes made while saving onto the accepted revision", async () => {
  vi.useFakeTimers()
  const f = fixture()
  let release: (() => void) | undefined
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = f.apply.getMockImplementation()!
  f.apply.mockImplementationOnce(async (input) => {
    await blocked
    return original(input)
  })
  const stop = startEditorAutosave(f.session)
  f.session.edit((d) => ({ ...d, items: [] }))
  await vi.advanceTimersByTimeAsync(750)
  f.session.edit((d) => ({ ...d, title: "Later" }))
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.apply).toHaveBeenCalledTimes(1)
  release?.()
  await vi.advanceTimersByTimeAsync(750)
  expect(f.apply).toHaveBeenCalledTimes(2)
  expect(f.stored()).toMatchObject({
    revision: 3,
    document: { title: "Later", items: [] },
  })
  stop()
})

it("pauses on 401, retains further edits, retries the same receipt and then saves latest edits", async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.apply.mockRejectedValueOnce(
    Object.assign(new FixtureError("Session expired"), { status: 401 }),
  )
  const stop = startEditorAutosave(f.session)
  f.session.edit((d) => ({ ...d, items: [] }))
  await vi.advanceTimersByTimeAsync(750)
  f.session.edit((d) => ({ ...d, title: "Later" }))
  await vi.advanceTimersByTimeAsync(10000)
  expect(f.apply).toHaveBeenCalledTimes(1)
  expect(f.session.getSnapshot()).toMatchObject({
    status: "failed",
    authenticationRequired: true,
    hasUnsavedChanges: true,
  })
  await f.session.save()
  expect(f.apply.mock.calls[1][0]).toEqual(f.apply.mock.calls[0][0])
  await vi.advanceTimersByTimeAsync(750)
  expect(f.stored()).toMatchObject({
    revision: 3,
    document: { title: "Later", items: [] },
  })
  expect(f.session.getSnapshot().authenticationRequired).toBe(false)
  stop()
})

it("pauses on preview authentication failure, generic save failure and revision conflict", async () => {
  vi.useFakeTimers()
  const f = fixture(),
    stop = startEditorAutosave(f.session)
  f.session.edit((d) => ({ ...d, items: [] }))
  f.session.requireSignIn()
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.apply).not.toHaveBeenCalled()
  f.apply.mockRejectedValueOnce(new FixtureError("Offline"))
  await f.session.save()
  f.session.edit((d) => ({ ...d, title: "Still offline" }))
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.apply).toHaveBeenCalledTimes(1)
  f.apply.mockRejectedValueOnce(
    Object.assign(new FixtureError("Conflict"), { status: 409 }),
  )
  await f.session.save()
  f.session.edit((d) => ({ ...d, title: "Local conflict edit" }))
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.apply).toHaveBeenCalledTimes(2)
  expect(f.session.getSnapshot().status).toBe("conflict")
  stop()
})

it("does not save an edit undone before debounce and cancels work on disposal", async () => {
  vi.useFakeTimers()
  const f = fixture(),
    stop = startEditorAutosave(f.session)
  f.session.edit((d) => ({ ...d, items: [] }))
  f.session.undo()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.apply).not.toHaveBeenCalled()
  expect(f.session.getSnapshot().hasUnsavedChanges).toBe(false)
  f.session.redo()
  stop()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.apply).not.toHaveBeenCalled()
})

it("autosaves recovered unsent edits without silently retrying ambiguous flights", async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.session.recover({
    document: { ...project.document, items: [] },
    revision: 1,
    flight: null,
  })
  const stop = startEditorAutosave(f.session)
  await vi.advanceTimersByTimeAsync(750)
  expect(f.stored().document.items).toEqual([])
  stop()
})
