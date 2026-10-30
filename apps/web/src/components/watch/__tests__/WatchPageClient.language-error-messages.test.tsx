/**
 * @vitest-environment jsdom
 */

// WatchPageClient.download.test.tsx mocks next-intl, so it cannot see which
// namespaces the content route projects into the nested provider. This suite
// uses the real provider and the real route projection to pin that the
// language component-download error renders translated guidance.

import { act, type ComponentType } from "react"
import { createRoot, type Root } from "react-dom/client"
import appDynamic from "next/dist/shared/lib/app-dynamic.js"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import englishMessages from "../../../../messages/en.json"
import urduMessages from "../../../../messages/ur.json"
import {
  WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES,
  loadClientMessages,
} from "@/i18n/client-messages"

vi.unmock("next-intl")

const { languageDynamicFixture, loadWatchInteractionMock } = vi.hoisted(() => ({
  languageDynamicFixture: {
    component: null as ComponentType<Record<string, unknown>> | null,
  },
  loadWatchInteractionMock: vi.fn<() => Promise<void>>(),
}))

vi.mock("next/dynamic", () => {
  let callIndex = 0
  return {
    default: () => {
      const index = callIndex++
      // Order of the three dynamic() calls in WatchPageClient: download,
      // language, share. Only the language modal is under test.
      if (index === 1) {
        return function LanguageModalTestBoundary(
          props: Record<string, unknown>,
        ) {
          const Actual = languageDynamicFixture.component
          return Actual ? <Actual {...props} /> : null
        }
      }
      return () => null
    },
  }
})

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
    modalCallbacks,
  }: {
    modalCallbacks: { openLanguage: () => void }
  }) => (
    <button
      data-testid="watch-language-button"
      type="button"
      onClick={modalCallbacks.openLanguage}
    >
      Language
    </button>
  ),
}))

vi.mock("@/components/watch/download-session-client", () => ({
  DOWNLOAD_RETURN_INTENT_PARAM: "download",
  checkDownloadSession: vi.fn(),
  redirectToAuth: vi.fn(),
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  getCachedWatchLanguageOptions: () => null,
  loadWatchInteraction: loadWatchInteractionMock,
  loadWatchLanguageOptionsForVideo: vi.fn(async () => []),
  shouldRefreshCachedWatchLanguageOptions: () => false,
}))

import { WatchPageClient } from "@/components/watch/WatchPageClient"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.history.pushState({}, "", "/watch/jesus-is-brought-to-pilate.html")
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  languageDynamicFixture.component = null
  loadWatchInteractionMock.mockReset()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

async function renderRejectedLanguageDownload(locale: "en" | "ur") {
  // The route hands this exact projection to its nested provider for every
  // non-language-home Watch shape (see the catch-all page's `namespaces`).
  const messages = await loadClientMessages(
    locale,
    WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES,
  )
  const intlErrors: unknown[] = []
  const chunkError = new Error("language component unavailable")
  // Match the deployed App Router React.lazy layer, as the download suite does.
  languageDynamicFixture.component = appDynamic(
    async (): Promise<{ default: ComponentType<Record<string, unknown>> }> => {
      throw chunkError
    },
    { ssr: false },
  )
  loadWatchInteractionMock.mockRejectedValue(chunkError)

  const variant = {
    documentId: "variant-1",
    duration: 7674,
    downloads: [],
    language: { bcp47: "en", iso3: "eng", slug: "english", name: "English" },
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
    subtitles: [],
  }
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          onError={(error) => intlErrors.push(error)}
        >
          <WatchPageClient
            mergedBlocks={[]}
            variant={variant as never}
            video={video as never}
            subtitleLanguageSlug={null}
          />
        </NextIntlClientProvider>,
      )
    })
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-language-button"]',
        )!
        .click()
    })
    await act(async () => {
      await Promise.resolve()
    })
  } finally {
    consoleError.mockRestore()
  }
  return {
    intlErrors,
    status: document.querySelector(
      '[data-testid="watch-language-component-error"]',
    ),
  }
}

describe("WatchPageClient language component-download error copy", () => {
  it.each([
    ["Urdu", "ur", urduMessages.SearchOverlay.connectionHint],
    ["English", "en", englishMessages.SearchOverlay.connectionHint],
  ] as const)(
    "renders the existing %s connection guidance, not the raw message key, through the content route's scoped messages",
    async (_, locale, expected) => {
      const { intlErrors, status } =
        await renderRejectedLanguageDownload(locale)

      expect(status).not.toBeNull()
      expect(status?.getAttribute("role")).toBe("status")
      expect(status?.textContent).toBe(expected)
      expect(status?.textContent).not.toContain("SearchOverlay")
      expect(intlErrors).toEqual([])
    },
  )
})
