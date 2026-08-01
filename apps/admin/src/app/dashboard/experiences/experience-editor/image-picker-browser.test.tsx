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
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    "asset-1",
  )
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open picker
      </button>
      <button type="button" onClick={() => setSelectedAssetId("asset-2")}>
        Use second image
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
            {
              id: "asset-2",
              displayName: "Second public art",
              altText: null,
              mimeType: "image/webp",
              byteSize: "10 KB",
              previewUrl: "/api/media-assets/asset-2/preview",
              updated: "today",
              folderId: null,
              pathLabel: "Library",
            },
          ],
        }}
        query=""
        selectedFolderId={null}
        selectedAssetId={selectedAssetId}
        canClearImage={Boolean(selectedAssetId)}
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

  it("resets the draft selection from changed props each time it opens", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => root.render(<PickerHarness />))
    const controls = Array.from(container.querySelectorAll("button"))
    const opener = controls.find((item) => item.textContent === "Open picker")!
    const useSecond = controls.find(
      (item) => item.textContent === "Use second image",
    )!

    try {
      act(() => opener.click())
      await act(
        async () => await new Promise((resolve) => setTimeout(resolve, 1)),
      )
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })
      act(() => useSecond.click())
      act(() => opener.click())
      await act(
        async () => await new Promise((resolve) => setTimeout(resolve, 1)),
      )

      const assetButtons = Array.from(container.querySelectorAll("button"))
      const first = assetButtons.find((item) =>
        item.textContent?.includes("Public art"),
      )!
      const second = assetButtons.find((item) =>
        item.textContent?.includes("Second public art"),
      )!
      expect(first.getAttribute("aria-pressed")).toBe("false")
      expect(second.getAttribute("aria-pressed")).toBe("true")
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
