/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  checkDownloadSessionMock,
  downloadModalProps,
  languageModalProps,
  loadWatchInteractionMock,
  loadWatchLanguageOptionsMock,
  redirectToAuthMock,
  scheduleWatchInteractionWarmupMock,
  watchSectionRendererProps,
} = vi.hoisted(() => ({
  checkDownloadSessionMock: vi.fn(),
  downloadModalProps: [] as unknown[],
  languageModalProps: [] as unknown[],
  loadWatchInteractionMock: vi.fn(async () => undefined),
  loadWatchLanguageOptionsMock: vi.fn(),
  redirectToAuthMock: vi.fn(),
  scheduleWatchInteractionWarmupMock: vi.fn(() => vi.fn()),
  watchSectionRendererProps: [] as unknown[],
}))

vi.mock("next/dynamic", () => {
  let callIndex = 0
  return {
    default: () => {
      const index = callIndex++
      if (index === 0) {
        return (props: unknown) => {
          downloadModalProps.push(props)
          return null
        }
      }
      if (index === 1) {
        return (props: unknown) => {
          languageModalProps.push(props)
          return null
        }
      }
      return () => null
    },
  }
})

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string): string =>
      namespace === "DownloadButton" && key === "sessionError"
        ? "Download is temporarily unavailable. Please try again."
        : key,
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({ searchOpen: false }),
}))

vi.mock("@/components/watch/SubtitleTranscript", () => ({
  SubtitleTranscript: () => null,
}))

vi.mock("@/components/watch/WatchSectionRenderer", () => ({
  WatchSectionRenderer: ({
    downloadError,
    downloadPending,
    languageSlug,
    modalCallbacks,
    pendingChapterPreview,
    onChapterPreviewPending,
  }: {
    downloadError?: string | null
    downloadPending?: boolean
    languageSlug?: string
    modalCallbacks: { openDownload: () => void; openLanguage: () => void }
    pendingChapterPreview?: { title: string | null } | null
    onChapterPreviewPending?: (preview: {
      href: string
      languageSlug: string
      sourceVideoDocumentId: string
      targetVideoDocumentId: string
      title: string | null
      posterUrl: string | null
    }) => void
  }) => {
    watchSectionRendererProps.push({
      pendingChapterPreview,
      languageSlug,
    })
    return (
      <div
        data-testid="watch-section-renderer"
        data-language-slug={languageSlug ?? ""}
        data-pending-title={pendingChapterPreview?.title ?? ""}
      >
        <button
          data-testid="watch-download-button"
          disabled={downloadPending}
          type="button"
          onClick={modalCallbacks.openDownload}
        >
          Download
        </button>
        <button
          data-testid="watch-language-button"
          type="button"
          onClick={modalCallbacks.openLanguage}
        >
          Language
        </button>
        <button
          data-testid="watch-pending-chapter-button"
          type="button"
          onClick={() =>
            onChapterPreviewPending?.({
              href: "/child-2-slug.html/english.html",
              languageSlug: "english",
              sourceVideoDocumentId: "video-1",
              targetVideoDocumentId: "child-2",
              title: "Child 2",
              posterUrl: "https://cdn.test/child-2.jpg",
            })
          }
        >
          Pending chapter
        </button>
        {downloadError ? (
          <p data-testid="watch-download-error" role="alert">
            {downloadError}
          </p>
        ) : null}
      </div>
    )
  },
}))

vi.mock("@/components/watch/download-session-client", () => ({
  checkDownloadSession: checkDownloadSessionMock,
  redirectToAuth: redirectToAuthMock,
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  getCachedWatchLanguageOptions: () => null,
  loadWatchInteraction: loadWatchInteractionMock,
  loadWatchLanguageOptionsForVideo: loadWatchLanguageOptionsMock,
  scheduleWatchInteractionWarmup: scheduleWatchInteractionWarmupMock,
}))

import { WatchPageClient } from "@/components/watch/WatchPageClient"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  downloadModalProps.length = 0
  languageModalProps.length = 0
  checkDownloadSessionMock.mockReset()
  loadWatchInteractionMock.mockClear()
  loadWatchLanguageOptionsMock.mockReset()
  redirectToAuthMock.mockReset()
  scheduleWatchInteractionWarmupMock.mockClear()
  watchSectionRendererProps.length = 0
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

function renderWatchPage(
  overrides: {
    videoDocumentId?: string
    languageSlug?: string
  } = {},
) {
  const variant = {
    documentId: "variant-1",
    duration: 7674,
    downloads: [
      {
        documentId: "download-1",
        quality: "fhd",
        size: "1048576",
        url: "https://stream.mux.com/raw-client-leak.mp4",
      },
    ],
    language: { slug: "english", name: "English" },
    muxVideo: { playbackId: "playback-1" },
  }
  const video = {
    documentId: overrides.videoDocumentId ?? "video-1",
    slug: "jesus",
    title: "JESUS",
    snippet: null,
    description: null,
    images: [],
    variants: [variant],
    subtitles: [],
  }

  act(() => {
    root.render(
      <WatchPageClient
        mergedBlocks={[]}
        variant={variant as never}
        video={video as never}
        languageSlug={overrides.languageSlug}
      />,
    )
  })
}

describe("WatchPageClient download boundary", () => {
  it("does not mount modal chunks before the user asks for them", () => {
    renderWatchPage()

    expect(downloadModalProps).toHaveLength(0)
    expect(languageModalProps).toHaveLength(0)
    expect(scheduleWatchInteractionWarmupMock).toHaveBeenCalledWith({
      videoSlug: "jesus",
    })
  })

  it("passes opaque download ids to DownloadModal without raw CDN URLs", async () => {
    checkDownloadSessionMock.mockResolvedValueOnce({
      ok: true,
      authenticated: false,
      gateEnabled: false,
    })
    renderWatchPage()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-download-button"]',
        )
        ?.click()
    })

    const latestProps = downloadModalProps.at(-1) as {
      downloads: Array<Record<string, unknown>>
      variantId: string
      videoSlug: string
    }
    expect(latestProps.variantId).toBe("variant-1")
    expect(latestProps.videoSlug).toBe("jesus")
    expect(latestProps.downloads).toEqual([
      {
        documentId: "download-1",
        quality: "fhd",
        size: 1048576,
      },
    ])
    expect(latestProps.downloads[0]).not.toHaveProperty("url")
    expect(
      document
        .querySelector('[data-testid="watch-section-renderer"]')
        ?.getAttribute("data-language-slug"),
    ).toBe("english")
    expect(loadWatchInteractionMock).toHaveBeenCalledWith("download")
  })

  it("loads language picker rows only when the language modal opens", async () => {
    loadWatchLanguageOptionsMock.mockResolvedValueOnce([
      {
        documentId: "variant-es",
        hls: "https://stream.mux.com/es.m3u8",
        published: true,
        language: {
          coreId: "es",
          bcp47: "es",
          slug: "spanish",
          name: "Spanish",
          nativeName: "Espanol",
        },
        videoEdition: null,
      },
    ])
    renderWatchPage()

    expect(loadWatchLanguageOptionsMock).not.toHaveBeenCalled()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-language-button"]',
        )
        ?.click()
    })

    expect(loadWatchLanguageOptionsMock).toHaveBeenCalledWith("jesus")
    expect(loadWatchInteractionMock).toHaveBeenCalledWith("language")
    expect(languageModalProps.at(-1)).toEqual(
      expect.objectContaining({
        open: true,
        languageOptionsLoading: false,
        languageOptionsError: false,
        variants: [
          expect.objectContaining({
            documentId: "variant-es",
            language: expect.objectContaining({ slug: "spanish" }),
          }),
        ],
      }),
    )
  })

  it("threads pending chapter preview to the renderer and clears it after route identity changes", async () => {
    renderWatchPage()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-pending-chapter-button"]',
        )
        ?.click()
    })

    expect(
      document
        .querySelector('[data-testid="watch-section-renderer"]')
        ?.getAttribute("data-pending-title"),
    ).toBe("Child 2")

    renderWatchPage({ videoDocumentId: "child-2" })

    expect(
      document
        .querySelector('[data-testid="watch-section-renderer"]')
        ?.getAttribute("data-pending-title"),
    ).toBe("")
  })

  it("shows an inline error when the first session check cannot complete", async () => {
    checkDownloadSessionMock.mockResolvedValueOnce({
      ok: false,
      reason: "session-unavailable",
    })
    renderWatchPage()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-download-button"]',
        )
        ?.click()
    })

    expect(
      document.querySelector('[data-testid="watch-download-error"]')
        ?.textContent,
    ).toBe("Download is temporarily unavailable. Please try again.")
    expect(
      document
        .querySelector('[data-testid="watch-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("none")
    expect(redirectToAuthMock).not.toHaveBeenCalled()
  })

  it("clears a prior session error after a successful retry opens the modal", async () => {
    checkDownloadSessionMock
      .mockResolvedValueOnce({ ok: false, reason: "session-unavailable" })
      .mockResolvedValueOnce({
        ok: true,
        authenticated: false,
        gateEnabled: false,
      })
    renderWatchPage()
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="watch-download-button"]',
    )

    await act(async () => {
      button?.click()
    })
    expect(
      document.querySelector('[data-testid="watch-download-error"]'),
    ).not.toBeNull()

    await act(async () => {
      button?.click()
    })

    expect(document.querySelector('[data-testid="watch-download-error"]')).toBe(
      null,
    )
    expect(
      document
        .querySelector('[data-testid="watch-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("download")
  })
})
