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
} = vi.hoisted(() => ({
  checkDownloadSessionMock: vi.fn(),
  downloadModalProps: [] as unknown[],
  languageModalProps: [] as unknown[],
  loadWatchInteractionMock: vi.fn(async () => undefined),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({ searchOpen: false }),
}))

vi.mock("@/components/watch/SubtitleTranscript", () => ({
  SubtitleTranscript: () => null,
}))

vi.mock("@/components/watch/WatchEventRecorder", () => ({
  WatchEventRecorder: () => null,
}))

vi.mock("@/components/watch/WatchSectionRenderer", () => ({
  WatchSectionRenderer: ({
    downloadError,
    downloadHref,
    downloadPending,
    languageSlug,
    modalCallbacks,
    shareHref,
    subtitleVttSrc,
  }: {
    downloadError?: string | null
    downloadHref?: string
    downloadPending?: boolean
    languageSlug?: string
    modalCallbacks: { openDownload: () => void; openLanguage: () => void }
    shareHref?: string
    subtitleVttSrc?: string | null
  }) => (
    <div
      data-testid="watch-section-renderer"
      data-download-href={downloadHref ?? ""}
      data-language-slug={languageSlug ?? ""}
      data-share-href={shareHref ?? ""}
      data-subtitle-vtt-src={subtitleVttSrc ?? ""}
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
  DOWNLOAD_RETURN_INTENT_PARAM: "download",
  checkDownloadSession: checkDownloadSessionMock,
  redirectToAuth: redirectToAuthMock,
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  getCachedWatchLanguageOptions: () => null,
  loadWatchInteraction: loadWatchInteractionMock,
  loadWatchLanguageOptionsForVideo: loadWatchLanguageOptionsMock,
}))

import { WatchPageClient } from "@/components/watch/WatchPageClient"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    "/watch/jesus-is-brought-to-pilate.html/english.html",
  )
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  document.cookie = "forge_watch_subs=; path=/watch; max-age=0"
  downloadModalProps.length = 0
  languageModalProps.length = 0
  checkDownloadSessionMock.mockReset()
  loadWatchInteractionMock.mockClear()
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

function renderWatchPage({
  languageSlug = "english",
  subtitles = [],
}: {
  languageSlug?: string
  subtitles?: unknown[]
} = {}) {
  const variant = {
    documentId: "5fc705b9-1b3b-4a58-abef-755b98457de6",
    duration: 7674,
    downloads: [
      {
        documentId: "47420a5c-0ae1-465e-bcc9-98056566d087",
        height: 360,
        quality: "fhd",
        size: "1048576",
        url: "https://stream.mux.com/raw-client-leak.mp4",
      },
    ],
    language: {
      bcp47: "en",
      iso3: "eng",
      slug: languageSlug,
      name: languageSlug === "english" ? "English" : languageSlug,
    },
    muxVideo: { playbackId: "playback-1" },
  }
  const video = {
    documentId: "video-1",
    slug: "jesus-is-brought-to-pilate",
    title: "Jesus Is Brought to Pilate",
    snippet: null,
    description: null,
    images: [],
    variants: [variant],
    subtitles,
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
  it("does not mount modal chunks before the user asks for them", () => {
    renderWatchPage()

    expect(downloadModalProps).toHaveLength(0)
    expect(languageModalProps).toHaveLength(0)
    expect(loadWatchInteractionMock).not.toHaveBeenCalled()
    const renderer = document.querySelector(
      '[data-testid="watch-section-renderer"]',
    )
    expect(renderer?.getAttribute("data-download-href")).toContain(
      "/watch/api/download?",
    )
    expect(renderer?.getAttribute("data-download-href")).toContain(
      "downloadId=47420a5c-0ae1-465e-bcc9-98056566d087",
    )
    expect(renderer?.getAttribute("data-download-href")).toContain(
      "variantId=5fc705b9-1b3b-4a58-abef-755b98457de6",
    )
    expect(renderer?.getAttribute("data-download-href")).toContain(
      "videoSlug=jesus-is-brought-to-pilate",
    )
    expect(renderer?.getAttribute("data-download-href")).not.toContain(
      "stream.mux.com",
    )
    expect(renderer?.getAttribute("data-download-href")).toContain(
      `filename=${encodeURIComponent(
        "Jesus-Is-Brought-to-Pilate_English_eng_360p.mp4",
      )}`,
    )
    expect(renderer?.getAttribute("data-share-href")).toContain(
      "https://www.facebook.com/sharer/sharer.php",
    )
    expect(renderer?.getAttribute("data-share-href")).toContain("jesus")
  })

  it("passes opaque download ids to DownloadModal without raw CDN URLs", async () => {
    checkDownloadSessionMock.mockResolvedValueOnce({
      ok: true,
      authenticated: true,
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
      languageCode: string
      languageName: string
      languageSlug: string
      variantId: string
      videoSlug: string
    }
    expect(latestProps.variantId).toBe("5fc705b9-1b3b-4a58-abef-755b98457de6")
    expect(latestProps.videoSlug).toBe("jesus-is-brought-to-pilate")
    expect(latestProps.languageCode).toBe("eng")
    expect(latestProps.languageName).toBe("English")
    expect(latestProps.languageSlug).toBe("english")
    expect(latestProps.downloads).toEqual([
      {
        documentId: "47420a5c-0ae1-465e-bcc9-98056566d087",
        height: 360,
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

  it("opens the download modal with a sign-in prompt instead of redirecting immediately", async () => {
    const loginUrl =
      "http://localhost:3000/watch/api/auth/login?returnTo=%2Fwatch%2Fjesus"
    checkDownloadSessionMock.mockResolvedValueOnce({
      ok: true,
      authenticated: false,
      loginUrl,
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
      document
        .querySelector('[data-testid="watch-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("download")
    expect(redirectToAuthMock).not.toHaveBeenCalled()
    expect(downloadModalProps.at(-1)).toEqual(
      expect.objectContaining({
        open: true,
        authRequiredLoginUrl: loginUrl,
      }),
    )

    const latestProps = downloadModalProps.at(-1) as {
      onClose: () => void
    }
    act(() => {
      latestProps.onClose()
    })

    expect(
      document
        .querySelector('[data-testid="watch-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("none")
    expect(downloadModalProps.at(-1)).toEqual(
      expect.objectContaining({
        open: false,
        authRequiredLoginUrl: loginUrl,
      }),
    )
  })

  it("reopens the download modal after returning from sign-in", async () => {
    window.history.replaceState(
      {},
      "",
      "/watch/jesus-is-brought-to-pilate.html/english.html?download=1&t=12",
    )
    renderWatchPage()

    await vi.waitFor(() => {
      expect(
        document
          .querySelector('[data-testid="watch-page-client"]')
          ?.getAttribute("data-modal-state"),
      ).toBe("download")
    })
    expect(downloadModalProps.at(-1)).toEqual(
      expect.objectContaining({
        open: true,
        authRequiredLoginUrl: null,
      }),
    )
    expect(window.location.search).toBe("?t=12")
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

    expect(loadWatchLanguageOptionsMock).toHaveBeenCalledWith(
      "jesus-is-brought-to-pilate",
    )
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

  it("keeps legacy translated subtitle preferences from auto-enabling", async () => {
    document.cookie =
      "forge_watch_subs=arabic-modern-standard; path=/watch; max-age=31536000"
    loadWatchLanguageOptionsMock.mockResolvedValueOnce([])
    renderWatchPage({
      languageSlug: "english",
      subtitles: [
        {
          documentId: "sub-ar",
          language: {
            slug: "arabic-modern-standard",
            name: "Arabic, Modern Standard",
            nativeName: "اللغة العربية",
            bcp47: "ar",
          },
          vttSrc: "https://cdn.test/arabic.vtt",
          primary: false,
          aiGenerated: false,
        },
      ],
    })

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-language-button"]',
        )
        ?.click()
    })

    const latestProps = languageModalProps.at(-1) as {
      subtitles: unknown[]
      currentSubtitleEnabled: boolean
      currentSubtitleSlug: string | null
    }
    expect(latestProps.subtitles).toHaveLength(1)
    expect(latestProps.currentSubtitleEnabled).toBe(false)
    expect(latestProps.currentSubtitleSlug).toBeNull()
  })

  it("restores explicit translated subtitle preferences", async () => {
    document.cookie = `forge_watch_subs=${encodeURIComponent(
      "v2:spanish",
    )}; path=/watch; max-age=31536000`
    loadWatchLanguageOptionsMock.mockResolvedValueOnce([])
    renderWatchPage({
      languageSlug: "english",
      subtitles: [
        {
          documentId: "sub-es",
          language: {
            slug: "spanish",
            name: "Spanish",
            nativeName: "Espanol",
            bcp47: "es",
          },
          vttSrc: "https://cdn.test/spanish.vtt",
          primary: false,
          aiGenerated: false,
        },
      ],
    })

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-language-button"]',
        )
        ?.click()
    })

    const latestProps = languageModalProps.at(-1) as {
      subtitles: unknown[]
      currentSubtitleEnabled: boolean
      currentSubtitleSlug: string | null
    }
    expect(latestProps.subtitles).toHaveLength(1)
    expect(latestProps.currentSubtitleEnabled).toBe(true)
    expect(latestProps.currentSubtitleSlug).toBe("spanish")
  })

  it("passes selected subtitle VTTs through the same-origin media proxy", () => {
    document.cookie = `forge_watch_subs=${encodeURIComponent(
      "v2:spanish",
    )}; path=/watch; max-age=31536000`
    renderWatchPage({
      languageSlug: "english",
      subtitles: [
        {
          documentId: "sub-es",
          language: {
            slug: "spanish",
            name: "Spanish",
            nativeName: "Espanol",
            bcp47: "es",
          },
          vttSrc: "https://cdn.test/spanish.vtt",
          primary: false,
          aiGenerated: false,
        },
      ],
    })

    const renderer = document.querySelector(
      '[data-testid="watch-section-renderer"]',
    )
    expect(renderer?.getAttribute("data-subtitle-vtt-src")).toBe(
      "/watch/api/download?url=https%3A%2F%2Fcdn.test%2Fspanish.vtt&disposition=inline",
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
        authenticated: true,
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
