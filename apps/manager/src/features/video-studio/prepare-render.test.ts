import { afterEach, expect, it, vi } from "vitest"
import { studioProjectSchema } from "@forge/studio-contracts"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { EditorSession } from "./editor-session"
import { prepareRender } from "./prepare-render"
const project = studioProjectSchema.parse({
  projectId: "project",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Before",
    language: "english",
    runtimeVersion: STUDIO_RUNTIME_VERSION,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 150,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
})
function fixture() {
  const apply = vi.fn(async () => ({
    projectId: "project",
    revision: 2,
    outcome: "ACCEPTED" as const,
  }))
  return {
    apply,
    session: new EditorSession(project, { read: async () => project, apply }),
  }
}
afterEach(() => vi.unstubAllGlobals())
it("does not create a revision for already prepared sources", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ document: project.document })),
  )
  const { session, apply } = fixture()
  expect(await prepareRender(session, "project")).toBe(1)
  expect(apply).not.toHaveBeenCalled()
})
it("does not save or submit an obsolete preparation when edits arrive during the wait", async () => {
  const { session, apply } = fixture()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      session.edit((doc) => ({ ...doc, title: "Human edit" }))
      return Response.json({ document: project.document })
    }),
  )
  await expect(prepareRender(session, "project")).rejects.toThrow(
    "project changed",
  )
  expect(apply).not.toHaveBeenCalled()
  expect(session.getSnapshot().document.title).toBe("Human edit")
})
it("saves materialized references and returns the new revision for render admission", async () => {
  const ref = {
    assetId: "asset",
    versionId: "descriptor",
    digest: "a".repeat(64),
  }
  const sourceProject = studioProjectSchema.parse({
    ...project,
    document: {
      ...project.document,
      tracks: [{ id: "visual", kind: "visual" }],
      items: [
        {
          id: "clip",
          kind: "video",
          trackId: "visual",
          startFrame: 0,
          durationInFrames: 150,
          volume: 0.4,
          source: {
            videoId: "video",
            dubId: "dub",
            editionId: "edition",
            language: "english",
            subtitle: {
              trackId: "track",
              editionId: "edition",
              language: "english",
              asset: ref,
            },
            preview: ref,
            export: ref,
            startMs: 5000,
            endMs: 10000,
          },
        },
      ],
    },
  })
  const prepared = structuredClone(sourceProject.document)
  const clip = prepared.items[0]
  if (clip.kind !== "video") throw new TypeError("Video fixture required")
  clip.source.preview = { ...ref, versionId: "preview" }
  clip.source.export = { ...ref, versionId: "export" }
  const apply = vi.fn(async () => ({
    projectId: "project",
    revision: 2,
    outcome: "ACCEPTED" as const,
  }))
  const session = new EditorSession(sourceProject, {
    read: async () => sourceProject,
    apply,
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ document: prepared })),
  )
  expect(await prepareRender(session, "project")).toBe(2)
  expect(apply).toHaveBeenCalledOnce()
  expect(session.getSnapshot().document).toEqual(prepared)
})
