/** @vitest-environment jsdom */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({ pinned: true, searchOpen: false }),
}))

vi.mock("@/components/watch/BetaTesterModalProvider", () => ({
  useBetaTesterModal: () => null,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogClose: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => children,
}))

import { QuizButton } from "@/components/sections/QuizButton"
import {
  WatchModalActivityProvider,
  usePauseForWatchModal,
  type WatchPausableMedia,
} from "@/components/watch/WatchModalActivityProvider"
import { WatchQuestionPanel } from "@/components/watch/WatchQuestionPanel"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("Watch modal playback registration", () => {
  function makeMedia() {
    const media: WatchPausableMedia & {
      pause: ReturnType<typeof vi.fn>
      play: ReturnType<typeof vi.fn>
    } = {
      paused: false,
      pause: vi.fn(() => {
        media.paused = true
      }),
      play: vi.fn(() => {
        media.paused = false
        return Promise.resolve()
      }),
    }
    return media
  }

  function MediaOwner({ media }: { media: WatchPausableMedia }) {
    usePauseForWatchModal(media)
    return null
  }

  function renderWithMedia(children: ReactNode, media: WatchPausableMedia) {
    act(() => {
      root.render(
        <WatchModalActivityProvider>
          {children}
          <MediaOwner media={media} />
        </WatchModalActivityProvider>,
      )
    })
  }

  it("pauses playback from the effective question modal state", () => {
    const media = makeMedia()
    renderWithMedia(<WatchQuestionPanel enabled />, media)
    expect(media.pause).not.toHaveBeenCalled()

    act(() => {
      container
        .querySelector<HTMLInputElement>(
          '[data-testid="watch-mobile-question-panel-input"]',
        )
        ?.focus()
    })

    expect(media.pause).toHaveBeenCalledOnce()
  })

  it("pauses playback as soon as the controlled quiz dialog opens", () => {
    const media = makeMedia()
    renderWithMedia(
      <QuizButton
        data={{
          id: "quiz-1",
          buttonText: "Take the quiz",
          iframeSrc: "https://example.test/quiz",
        }}
      />,
      media,
    )
    expect(media.pause).not.toHaveBeenCalled()

    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click()
    })

    expect(media.pause).toHaveBeenCalledOnce()
  })
})
