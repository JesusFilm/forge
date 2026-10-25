import { describe, expect, it } from "vitest"
import {
  intersectsRootDropZone,
  isDescendantFolderTarget,
  persistRootDropTarget,
  resolveFolderDropTarget,
} from "./folder-tree-dnd"

describe("resolveFolderDropTarget", () => {
  it("prefers the explicit over target", () => {
    expect(
      resolveFolderDropTarget({
        overId: "folder-2",
        collisions: [{ id: "root" }],
      }),
    ).toBe("folder-2")
  })

  it("falls back to collisions when over is missing", () => {
    expect(
      resolveFolderDropTarget({
        overId: null,
        collisions: [{ id: "root" }],
      }),
    ).toBe("root")
  })

  it("falls back to the persisted root target when release clears the event target", () => {
    expect(
      resolveFolderDropTarget({
        overId: null,
        collisions: null,
        persistedRootTarget: "root",
      }),
    ).toBe("root")
  })

  it("prefers root when the dragged rect overlaps the root drop zone", () => {
    expect(
      resolveFolderDropTarget({
        overId: "folder-2",
        collisions: [{ id: "folder-2" }],
        activeRect: {
          top: 120,
          right: 180,
          bottom: 164,
          left: 100,
        },
        rootRect: {
          top: 140,
          right: 320,
          bottom: 320,
          left: 40,
        },
      }),
    ).toBe("root")
  })

  it("does not reuse stale non-root targets", () => {
    expect(
      resolveFolderDropTarget({
        overId: null,
        collisions: null,
        persistedRootTarget: "folder-2",
      }),
    ).toBeNull()
  })
})

describe("persistRootDropTarget", () => {
  it("persists root only when root is the resolved target", () => {
    expect(
      persistRootDropTarget({
        overId: "root",
        collisions: null,
      }),
    ).toBe("root")

    expect(
      persistRootDropTarget({
        overId: null,
        collisions: [{ id: "root" }],
      }),
    ).toBe("root")
  })

  it("clears the persisted target for non-root collisions", () => {
    expect(
      persistRootDropTarget({
        overId: "folder-2",
        collisions: [{ id: "root" }],
      }),
    ).toBeNull()
  })
})

describe("intersectsRootDropZone", () => {
  it("returns true when the dragged rect overlaps the root drop zone", () => {
    expect(
      intersectsRootDropZone({
        activeRect: {
          top: 120,
          right: 180,
          bottom: 164,
          left: 100,
        },
        rootRect: {
          top: 140,
          right: 320,
          bottom: 320,
          left: 40,
        },
      }),
    ).toBe(true)
  })

  it("returns false when the dragged rect misses the root drop zone", () => {
    expect(
      intersectsRootDropZone({
        activeRect: {
          top: 40,
          right: 120,
          bottom: 84,
          left: 60,
        },
        rootRect: {
          top: 140,
          right: 320,
          bottom: 320,
          left: 40,
        },
      }),
    ).toBe(false)
  })
})

describe("isDescendantFolderTarget", () => {
  const folders = [
    { id: "parent", depth: 0 },
    { id: "child", depth: 1 },
    { id: "grandchild", depth: 2 },
    { id: "sibling", depth: 0 },
  ]

  it("returns true for descendant targets", () => {
    expect(
      isDescendantFolderTarget({
        folders,
        folderId: "parent",
        parentId: "child",
      }),
    ).toBe(true)

    expect(
      isDescendantFolderTarget({
        folders,
        folderId: "parent",
        parentId: "grandchild",
      }),
    ).toBe(true)
  })

  it("returns true for self-targets", () => {
    expect(
      isDescendantFolderTarget({
        folders,
        folderId: "parent",
        parentId: "parent",
      }),
    ).toBe(true)
  })

  it("returns false for siblings, ancestors, and root", () => {
    expect(
      isDescendantFolderTarget({
        folders,
        folderId: "child",
        parentId: "sibling",
      }),
    ).toBe(false)

    expect(
      isDescendantFolderTarget({
        folders,
        folderId: "grandchild",
        parentId: "parent",
      }),
    ).toBe(false)

    expect(
      isDescendantFolderTarget({
        folders,
        folderId: "parent",
        parentId: null,
      }),
    ).toBe(false)
  })
})
