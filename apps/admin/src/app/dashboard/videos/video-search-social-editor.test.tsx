// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./video-search-social-actions", () => ({
  discardVideoSearchSocialDraftAction: vi.fn(),
  loadVideoSearchSocialLocaleAction: vi.fn(),
  loadVideoSearchSocialMediaLibraryAction: vi.fn(),
  publishVideoSearchSocialDraftAction: vi.fn(),
  saveVideoSearchSocialAction: vi.fn(),
  searchVideoSearchSocialLocalesAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { VideoSearchSocialEditor } from "./video-search-social-editor"
import type { VideoSearchSocialLocaleData } from "./video-search-social-data"
import type {
  VideoSearchSocialDiscardResult,
  VideoSearchSocialDraftResult,
  VideoSearchSocialLoadResult,
  VideoSearchSocialSaveResult,
} from "./video-search-social-actions"

const english = {
  id: "locale-en",
  languageName: "English",
  languageCode: "en",
  languageSlug: "english",
  locale: "en",
  status: "PUBLISHED",
  title: "JESUS",
} as const
const french = {
  id: "locale-fr",
  languageName: "French",
  languageCode: "fr",
  languageSlug: "french",
  locale: "fr",
  status: "DRAFT",
  title: "JÉSUS",
} as const
const spanish = {
  id: "locale-es",
  languageName: "Spanish",
  languageCode: "es",
  languageSlug: "spanish-castilian",
  locale: "es",
  status: "PUBLISHED",
  title: "JESÃšS",
} as const

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function locale(
  overrides: Partial<VideoSearchSocialLocaleData> = {},
): VideoSearchSocialLocaleData {
  return {
    videoLocaleId: "locale-en",
    videoId: "video-1",
    slug: "jesus",
    locale: "en",
    languageName: "English",
    languageCode: "en",
    languageSlug: "english",
    status: "PUBLISHED",
    sourceTitle: "JESUS",
    sourceDescription: "Visible video description",
    searchTitle: null,
    searchDescription: null,
    socialImageAssetId: "asset-1",
    socialImage: null,
    ...overrides,
  }
}

const mediaLibrary = {
  rootLabel: "Library",
  folders: [],
  images: [
    {
      id: "asset-1",
      displayName: "JESUS social art",
      altText: "JESUS film",
      mimeType: "image/jpeg",
      byteSize: "120 KB",
      width: 1200,
      height: 630,
      previewUrl: "/api/media-assets/asset-1/preview",
      updated: "07/31/2026",
      folderId: null,
      pathLabel: "Library",
    },
  ],
}

function renderEditor(
  props: Partial<Parameters<typeof VideoSearchSocialEditor>[0]> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const searchAction =
    props.searchAction ?? vi.fn().mockResolvedValue({ ok: true, options: [] })
  const loadAction = props.loadAction ?? vi.fn()
  const saveAction = props.saveAction ?? vi.fn()

  act(() => {
    root.render(
      <VideoSearchSocialEditor
        videoId="video-1"
        canEdit
        initialOptions={[english, french]}
        initialLocale={locale()}
        mediaLibrary={mediaLibrary}
        searchAction={searchAction}
        loadAction={loadAction}
        saveAction={saveAction}
        {...props}
      />,
    )
  })

  return {
    container,
    searchAction,
    loadAction,
    saveAction,
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function button(container: HTMLElement, label: string) {
  const normalizedLabel = label.replace(/\s+/g, " ").trim()
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent?.replace(/\s+/g, " ").trim() === normalizedLabel,
  )
  if (!match) throw new Error(`Button not found: ${label}`)
  return match
}

function buttonContaining(container: HTMLElement, label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  )
  if (!match) throw new Error(`Button containing text not found: ${label}`)
  return match
}

function setControlValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value)
  control.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("VideoSearchSocialEditor", () => {
  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  it("keeps non-admin video details read-only", () => {
    const view = renderEditor({ canEdit: false })
    try {
      expect(view.container.textContent).toContain(
        "Administrator access is required",
      )
      expect(view.container.querySelector("form")).toBeNull()
    } finally {
      view.cleanup()
    }
  })

  it("shows fallback output for blank fields and guards dirty locale switches", async () => {
    const loadAction = vi.fn().mockResolvedValue({
      ok: true,
      data: locale({
        videoLocaleId: "locale-fr",
        locale: "fr",
        languageName: "French",
        languageCode: "fr",
        languageSlug: "french",
        status: "DRAFT",
        sourceTitle: "JÉSUS",
        searchTitle: null,
      }),
    })
    const view = renderEditor({ loadAction })

    try {
      expect(view.container.textContent).toContain("Effective crawler preview")
      expect(view.container.textContent).toContain("Visible video description")
      const title =
        view.container.querySelector<HTMLInputElement>("#search-title")!
      act(() => setControlValue(title, "Unsaved title"))

      act(() => buttonContaining(view.container, "French").click())
      expect(
        view.container.querySelector('[role="alertdialog"]'),
      ).not.toBeNull()
      expect(loadAction).not.toHaveBeenCalled()

      act(() => button(view.container, "Cancel").click())
      expect(view.container.textContent).toContain("English")

      act(() => buttonContaining(view.container, "French").click())
      await act(async () => button(view.container, "Discard").click())
      expect(loadAction).toHaveBeenCalledWith({ videoLocaleId: "locale-fr" })
      expect(view.container.textContent).toContain("French is ready to edit.")
    } finally {
      view.cleanup()
    }
  })

  it("clears a managed image by submitting null without its preview URL", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...locale(),
        socialImageAssetId: null,
      },
    })
    const view = renderEditor({ saveAction })

    try {
      act(() => button(view.container, "Clear").click())
      await act(async () => {
        button(view.container, "Save changes").click()
        await Promise.resolve()
      })

      expect(saveAction).toHaveBeenCalledWith({
        videoLocaleId: "locale-en",
        searchTitle: null,
        searchDescription: null,
        socialImageAssetId: null,
      })
      expect(JSON.stringify(saveAction.mock.calls[0])).not.toContain("preview")
      expect(view.container.textContent).toContain(
        "Search and Social metadata saved.",
      )
    } finally {
      view.cleanup()
    }
  })

  it("defers loading the Media Library until the picker opens", async () => {
    const loadMediaLibraryAction = vi.fn().mockResolvedValue({
      ok: true,
      data: mediaLibrary,
    })
    const view = renderEditor({
      initialLocale: locale({ socialImageAssetId: null }),
      mediaLibrary: { rootLabel: "Library", folders: [], images: [] },
      mediaLibraryInitiallyLoaded: false,
      loadMediaLibraryAction,
    })

    try {
      expect(loadMediaLibraryAction).not.toHaveBeenCalled()
      await act(async () => button(view.container, "Select").click())
      expect(loadMediaLibraryAction).toHaveBeenCalledOnce()
      expect(view.container.textContent).toContain("Choose an image")
      expect(view.container.textContent).toContain("JESUS social art")
    } finally {
      view.cleanup()
    }
  })

  it("preserves modified and non-primary anchor clicks while dirty", () => {
    const view = renderEditor()

    try {
      const title =
        view.container.querySelector<HTMLInputElement>("#search-title")!
      act(() => setControlValue(title, "Unsaved title"))

      const anchor = document.createElement("a")
      anchor.href = "/dashboard/media"
      anchor.textContent = "Open media"
      let bubbledClicks = 0
      anchor.addEventListener("click", (event) => {
        bubbledClicks += 1
        event.preventDefault()
      })
      view.container.appendChild(anchor)

      act(() => {
        anchor.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            button: 0,
          }),
        )
        anchor.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 1,
          }),
        )
      })

      expect(bubbledClicks).toBe(2)
      expect(view.container.querySelector('[role="alertdialog"]')).toBeNull()
    } finally {
      view.cleanup()
    }
  })

  it("distinguishes no results from a retryable search error", async () => {
    const searchAction = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, options: [] })
      .mockResolvedValueOnce({
        ok: false,
        code: "LOAD_FAILED",
        message: "Try again",
      })
    const view = renderEditor({ searchAction })

    try {
      await act(async () => button(view.container, "Search").click())
      expect(view.container.textContent).toContain(
        "No video locales match this search.",
      )
      await act(async () => button(view.container, "Search").click())
      expect(view.container.textContent).toContain(
        "Locales could not be loaded.",
      )
      expect(button(view.container, "Retry")).toBeTruthy()
    } finally {
      view.cleanup()
    }
  })

  it("ignores an older locale response that resolves after a newer request", async () => {
    const frenchLoad = deferred<VideoSearchSocialLoadResult>()
    const spanishLoad = deferred<VideoSearchSocialLoadResult>()
    const loadAction = vi.fn(({ videoLocaleId }: { videoLocaleId: string }) =>
      videoLocaleId === "locale-fr" ? frenchLoad.promise : spanishLoad.promise,
    )
    const view = renderEditor({
      initialOptions: [english, french, spanish],
      loadAction,
    })

    try {
      act(() => {
        buttonContaining(view.container, "French").click()
        buttonContaining(view.container, "Spanish").click()
      })
      await act(async () => {
        spanishLoad.resolve({
          ok: true,
          data: locale({
            videoLocaleId: "locale-es",
            locale: "es",
            languageName: "Spanish",
            languageCode: "es",
            languageSlug: "spanish-castilian",
          }),
        })
        await Promise.resolve()
      })
      await act(async () => {
        frenchLoad.resolve({
          ok: true,
          data: locale({
            videoLocaleId: "locale-fr",
            locale: "fr",
            languageName: "French",
            languageCode: "fr",
            languageSlug: "french",
          }),
        })
        await Promise.resolve()
      })

      expect(view.container.textContent).toContain("Spanish is ready to edit.")
      expect(view.container.textContent).not.toContain(
        "French is ready to edit.",
      )
    } finally {
      view.cleanup()
    }
  })

  it("locks cancel and discard while save-and-continue is in flight", async () => {
    const pendingSave = deferred<VideoSearchSocialSaveResult>()
    const loadAction = vi.fn().mockResolvedValue({
      ok: true,
      data: locale({
        videoLocaleId: "locale-fr",
        locale: "fr",
        languageName: "French",
        languageCode: "fr",
        languageSlug: "french",
      }),
    })
    const view = renderEditor({
      loadAction,
      saveAction: vi.fn(() => pendingSave.promise),
    })

    try {
      const title =
        view.container.querySelector<HTMLInputElement>("#search-title")!
      act(() => setControlValue(title, "Saved English title"))
      act(() => buttonContaining(view.container, "French").click())
      await act(async () => {
        button(view.container, "Save").click()
        await Promise.resolve()
      })

      expect(button(view.container, "Cancel")).toHaveProperty("disabled", true)
      expect(button(view.container, "Discard")).toHaveProperty("disabled", true)
      act(() => button(view.container, "Discard").click())
      expect(loadAction).not.toHaveBeenCalled()

      await act(async () => {
        pendingSave.resolve({
          ok: true,
          data: {
            ...locale(),
            searchTitle: "Saved English title",
          },
        })
        await Promise.resolve()
      })
      expect(loadAction).toHaveBeenCalledWith({ videoLocaleId: "locale-fr" })
    } finally {
      view.cleanup()
    }
  })

  it("shows approved SEO provenance and publishes only the selected revision", async () => {
    const publishDraftAction = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        videoLocaleId: "locale-en",
        videoId: "video-1",
        slug: "jesus",
        locale: "en",
        languageSlug: "english",
        status: "PUBLISHED",
        sourceTitle: "JESUS — Watch",
        sourceDescription: "Visible video description",
        searchTitle: "Watch JESUS",
        searchDescription: "Watch the JESUS film.",
        socialImageAssetId: "asset-1",
        seoDraft: null,
      },
    } satisfies VideoSearchSocialDraftResult)
    const discardDraftAction = vi.fn(
      async () =>
        ({
          ok: true,
          revisionId: "revision-1",
          status: "DISCARDED",
        }) satisfies VideoSearchSocialDiscardResult,
    )
    const view = renderEditor({
      initialLocale: locale({
        seoDraft: {
          state: "ready",
          revisionId: "revision-1",
          revisedByKind: "AI",
          reason: "Approved SEO proposal",
          revisedAt: "2026-08-01T12:00:00.000Z",
          stale: false,
          changedFields: ["title", "searchTitle", "searchDescription"],
          after: {
            id: "locale-en",
            videoId: "video-1",
            locale: "en",
            updatedAt: "2026-08-01T11:00:00.000Z",
            title: "JESUS — Watch",
            description: "Visible video description",
            snippet: null,
            imageAlt: null,
            searchTitle: "Watch JESUS",
            searchDescription: "Watch the JESUS film.",
            socialImageAssetId: "asset-1",
          },
        },
      }),
      publishDraftAction,
      discardDraftAction,
    })

    try {
      expect(view.container.textContent).toContain("Approved SEO draft")
      expect(view.container.textContent).toContain("AI · Approved SEO proposal")
      expect(
        view.container.querySelector<HTMLInputElement>("#search-title")?.value,
      ).toBe("Watch JESUS")

      await act(async () => button(view.container, "Publish draft").click())

      expect(publishDraftAction).toHaveBeenCalledWith({
        videoLocaleId: "locale-en",
        revisionId: "revision-1",
      })
      expect(view.container.textContent).not.toContain("Approved SEO draft")
      expect(view.container.textContent).toContain(
        "SEO draft published and queued for page revalidation.",
      )
    } finally {
      view.cleanup()
    }
  })
})
