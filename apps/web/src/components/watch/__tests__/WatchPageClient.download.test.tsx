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
  loadWatchLanguageOptionsMock,
  redirectToAuthMock,
} = vi.hoisted(() => ({
  checkDownloadSessionMock: vi.fn(),
  downloadModalProps: [] as unknown[],
  languageModalProps: [] as unknown[],
  loadWatchLanguageOptionsMock: vi.fn(),
  redirectToAuthMock: vi.fn(),
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
  }: {
    downloadError?: string | null
    downloadPending?: boolean
    languageSlug?: string
    modalCallbacks: { openDownload: () => void; openLanguage: () => void }
  }) => (
    <div
      data-testid="watch-section-renderer"
      data-language-slug={languageSlug ?? ""}
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
      {downloadError ? (
        <p data-testid="watch-download-error" role="alert">
          {downloadError}
        </p>
      ) : null}
    </div>
  ),
}))

vi.mock("@/components/watch/download-session-client", () => ({
  checkDownloadSession: checkDownloadSessionMock,
  redirectToAuth: redirectToAuthMock,
}))

vi.mock("@/lib/watch-language-actions", () => ({
  loadWatchLanguageOptions: loadWatchLanguageOptionsMock,
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
  loadWatchLanguageOptionsMock.mockReset()
  redirectToAuthMock.mockReset()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

function renderWatchPage() {
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
    documentId: "video-1",
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
      />,
    )
  })
}

describe("WatchPageClient download boundary", () => {
  it("passes opaque download ids to DownloadModal without raw CDN URLs", () => {
    renderWatchPage()

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

    expect(loadWatchLanguageOptionsMock).toHaveBeenCalledWith({
      videoSlug: "jesus",
    })
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
