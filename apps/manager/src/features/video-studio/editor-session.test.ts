import { expect, it } from "vitest"
import type { StudioProject } from "@forge/studio-contracts"
import { EditorSession } from "./editor-session"

class StudioEditorFixtureError extends Error {}

const project: StudioProject = {
  projectId: "project",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Untitled",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 900,
    tracks: [{ id: "main", kind: "visual" }],
    components: [],
    items: [
      {
        id: "title",
        kind: "text",
        trackId: "main",
        startFrame: 0,
        durationInFrames: 90,
        text: "Before",
        properties: {},
      },
    ],
    packRevisionIds: [],
  },
}
it("saves timing and crop after undo without resetting selection or playhead", async () => {
  let stored = structuredClone(project)
  const session = new EditorSession(project, {
    read: async () => stored,
    apply: async (input) => {
      stored = {
        ...stored,
        revision: stored.revision + 1,
        document:
          input.operations[0].kind === "restore-document"
            ? input.operations[0].document
            : stored.document,
      }
      return {
        projectId: "project",
        revision: stored.revision,
        outcome: "ACCEPTED",
      }
    },
  })
  session.select("title")
  session.seek(24)
  session.edit((doc) => ({
    ...doc,
    items: doc.items.map((i) => ({
      ...i,
      startFrame: 30,
      transform: {
        x: 10,
        y: 20,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        crop: { left: 0.1, right: 0, top: 0, bottom: 0 },
      },
    })),
  }))
  session.edit((doc) => ({ ...doc, title: "Discard this" }))
  session.undo()
  await session.save()
  expect(stored.document.title).toBe("Untitled")
  expect(stored.document.items[0]?.startFrame).toBe(30)
  expect(stored.document.items[0]?.transform?.crop?.left).toBe(0.1)
  expect(session.getSnapshot()).toMatchObject({
    selection: "title",
    playhead: 24,
    revision: 2,
    status: "saved",
  })
})
it("does not overwrite a revision newer than the conflict the operator reviewed", async () => {
  let stored = structuredClone(project)
  const adapter = {
    read: async () => structuredClone(stored),
    apply: async (input: import("@forge/studio-contracts").StudioApply) => {
      if (input.expectedRevision !== stored.revision)
        throw new StudioEditorFixtureError("CONFLICT")
      const operation = input.operations[0]!
      if (operation.kind === "restore-document")
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
    },
  }
  const first = new EditorSession(project, adapter),
    second = new EditorSession(project, adapter)
  first.edit((d) => ({ ...d, title: "First writer" }))
  await first.save()
  second.edit((d) => ({ ...d, title: "Second writer" }))
  await second.save()
  expect(second.getSnapshot().remote?.revision).toBe(2)
  first.edit((d) => ({ ...d, title: "A third change" }))
  await first.save()
  await second.useLocalVersion()
  expect(stored.document.title).toBe("A third change")
  expect(second.getSnapshot()).toMatchObject({
    status: "conflict",
    remote: { revision: 3 },
  })
})

it("recovers a lost save response using its original receipt before saving later edits", async () => {
  let stored = structuredClone(project)
  const receipts = new Map<
    string,
    import("@forge/studio-contracts").StudioCommandResult
  >()
  let loseResponse = true
  const adapter = {
    read: async () => structuredClone(stored),
    apply: async (input: import("@forge/studio-contracts").StudioApply) => {
      const receipt = receipts.get(input.idempotencyKey)
      if (receipt) return receipt
      if (input.expectedRevision !== stored.revision)
        throw new StudioEditorFixtureError("CONFLICT")
      const operation = input.operations[0]!
      if (operation.kind !== "restore-document")
        throw new StudioEditorFixtureError("Expected snapshot command")
      stored = {
        ...stored,
        revision: stored.revision + 1,
        document: operation.document,
      }
      const result = {
        projectId: stored.projectId,
        revision: stored.revision,
        outcome: "ACCEPTED" as const,
      }
      receipts.set(input.idempotencyKey, result)
      if (loseResponse) {
        loseResponse = false
        throw new StudioEditorFixtureError("Connection lost after commit")
      }
      return result
    },
  }
  const first = new EditorSession(project, adapter)
  first.edit((d) => ({ ...d, title: "Committed before response loss" }))
  await first.save()
  expect(first.getSnapshot().status).toBe("failed")
  const recovered = new EditorSession(stored, adapter)
  recovered.recover(first.recovery())
  recovered.edit((d) => ({ ...d, title: "Later local edit" }))
  await recovered.save()
  expect(recovered.getSnapshot()).toMatchObject({
    status: "unsaved",
    revision: 2,
  })
  expect(stored.document.title).toBe("Committed before response loss")
  await recovered.save()
  expect(stored.document.title).toBe("Later local edit")
  expect(stored.revision).toBe(3)
})

it("keeps one save in flight while undo and redo change the working document", async () => {
  let calls = 0
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const session = new EditorSession(project, {
    read: async () => project,
    apply: async () => {
      calls++
      await pending
      return { projectId: project.projectId, revision: 2, outcome: "ACCEPTED" }
    },
  })
  session.edit((d) => ({ ...d, title: "First change" }))
  const saving = session.save()
  session.undo()
  session.redo()
  session.undo()
  const duplicate = session.save()
  expect(calls).toBe(1)
  expect(session.getSnapshot().status).toBe("saving")
  release?.()
  await Promise.all([saving, duplicate])
  expect(session.getSnapshot()).toMatchObject({
    revision: 2,
    status: "unsaved",
    document: { title: "Untitled" },
  })
})
