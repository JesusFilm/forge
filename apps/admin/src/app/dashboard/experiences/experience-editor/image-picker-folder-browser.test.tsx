// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ImagePickerFolderBrowser } from "./image-picker-folder-browser"

function renderFolderBrowser(
  props: Partial<Parameters<typeof ImagePickerFolderBrowser>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const onSelectFolder = props.onSelectFolder ?? vi.fn()

  act(() => {
    root.render(
      <ImagePickerFolderBrowser
        rootLabel="Library"
        rootImageCount={1}
        folders={[
          {
            id: "folder-parent",
            label: "Campaigns",
            count: 0,
            directAssetCount: 0,
            childFolderCount: 1,
            parentId: null,
            depth: 0,
            pathLabel: "Library / Campaigns",
          },
          {
            id: "folder-child",
            label: "Easter",
            count: 2,
            directAssetCount: 2,
            childFolderCount: 0,
            parentId: "folder-parent",
            depth: 1,
            pathLabel: "Library / Campaigns / Easter",
          },
        ]}
        selectedFolderId={null}
        onSelectFolder={onSelectFolder}
        {...props}
      />,
    )
  })

  return {
    container,
    onSelectFolder,
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe("ImagePickerFolderBrowser", () => {
  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  it("renders root and nested folders without management controls", () => {
    const view = renderFolderBrowser()

    try {
      expect(view.container.textContent).toContain("Library")
      expect(view.container.textContent).toContain("Campaigns")
      expect(view.container.textContent).toContain("Easter")
      expect(view.container.textContent).not.toMatch(
        /create|rename|move|reorder|delete/i,
      )
    } finally {
      view.cleanup()
    }
  })

  it("selects root and child folders without navigation", () => {
    const view = renderFolderBrowser()

    try {
      const buttons = Array.from(view.container.querySelectorAll("button"))
      act(() => buttons[0]?.click())
      act(() => buttons[2]?.click())

      expect(view.onSelectFolder).toHaveBeenNthCalledWith(1, null)
      expect(view.onSelectFolder).toHaveBeenNthCalledWith(2, "folder-child")
    } finally {
      view.cleanup()
    }
  })

  it("renders the root option when there are no folders", () => {
    const view = renderFolderBrowser({ folders: [] })

    try {
      expect(view.container.textContent).toContain("Library")
      expect(view.container.querySelectorAll("button")).toHaveLength(1)
    } finally {
      view.cleanup()
    }
  })
})
