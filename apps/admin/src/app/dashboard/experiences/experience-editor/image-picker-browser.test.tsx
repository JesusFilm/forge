// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
import { ImagePickerBrowser } from "./image-picker-browser"

function PickerHarness({
  onSelect = vi.fn(),
}: {
  onSelect?: ReturnType<typeof vi.fn>
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open picker
      </button>
      <ImagePickerBrowser
        open={open}
        mediaLibrary={{
          rootLabel: "Library",
          folders: [],
          images: [
            {
              id: "asset-1",
              displayName: "Public art",
              altText: null,
              mimeType: "image/jpeg",
              byteSize: "12 KB",
              previewUrl: "/api/media-assets/asset-1/preview",
              updated: "today",
              folderId: null,
              pathLabel: "Library",
            },
          ],
        }}
        query=""
        selectedFolderId={null}
        selectedAssetId={null}
        canClearImage={false}
        canUpload={false}
        uploadAction={async () => ({ ok: false })}
        onQueryChange={() => {}}
        onSelectFolder={() => {}}
        onSelectImage={onSelect}
        onClearImage={() => {}}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

describe("ImagePickerBrowser accessibility", () => {
  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  it("focuses search, announces selection, closes on Escape, and restores focus", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => root.render(<PickerHarness />))
    const opener = container.querySelector<HTMLButtonElement>("button")!

    try {
      opener.focus()
      act(() => opener.click())
      await act(
        async () => await new Promise((resolve) => setTimeout(resolve, 1)),
      )
      const search = container.querySelector<HTMLInputElement>(
        '[aria-label="Search image assets"]',
      )!
      expect(document.activeElement).toBe(search)

      const asset = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Public art"),
      )!
      act(() => asset.click())
      expect(container.textContent).toContain("Public art selected.")

      act(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      )
      expect(container.querySelector('[aria-hidden="false"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
