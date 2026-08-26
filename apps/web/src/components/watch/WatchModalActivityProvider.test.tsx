/** @vitest-environment jsdom */

import { act, StrictMode, useLayoutEffect, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  WatchModalActivityProvider,
  usePauseForWatchModal,
  useWatchModalActivity,
  useWatchModalReservation,
  type WatchPausableMedia,
} from "./WatchModalActivityProvider"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function makeMedia({ paused = false, rejectPlay = false } = {}) {
  const events = new EventTarget()
  const media: WatchPausableMedia & {
    pause: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
  } = {
    paused,
    pause: vi.fn(() => {
      media.paused = true
    }),
    play: vi.fn(() => {
      media.paused = false
      events.dispatchEvent(new Event("play"))
      return rejectPlay
        ? Promise.reject(new Error("play blocked"))
        : Promise.resolve()
    }),
    addEventListener: (type, listener) =>
      events.addEventListener(type, listener),
    removeEventListener: (type, listener) =>
      events.removeEventListener(type, listener),
  }
  return media
}

function ModalOwner({
  active,
  releaseDelayMs,
}: {
  active: boolean
  source: string
  releaseDelayMs?: number
}) {
  useWatchModalActivity(active, { releaseDelayMs })
  return null
}

function MediaOwner({
  media,
  playbackIdentity = media,
}: {
  media: WatchPausableMedia | null
  playbackIdentity?: unknown
}) {
  usePauseForWatchModal(media, playbackIdentity)
  return null
}

function ReservationOwner({
  name,
  onResult,
}: {
  name: string
  onResult: (name: string, acquired: boolean) => void
}) {
  const reservation = useWatchModalReservation()
  useLayoutEffect(() => {
    onResult(name, reservation.tryAcquire())
    return reservation.release
  }, [name, onResult, reservation])
  return null
}

function render(children: ReactNode) {
  act(() => {
    root.render(
      <WatchModalActivityProvider>{children}</WatchModalActivityProvider>,
    )
  })
}

describe("WatchModalActivityProvider", () => {
  it("grants only one exclusive reservation in the same commit", () => {
    const results: Array<[string, boolean]> = []
    const onResult = (name: string, acquired: boolean) => {
      results.push([name, acquired])
    }

    render(
      <>
        <ReservationOwner name="introduction-a" onResult={onResult} />
        <ReservationOwner name="introduction-b" onResult={onResult} />
      </>,
    )

    expect(results).toEqual([
      ["introduction-a", true],
      ["introduction-b", false],
    ])
  })
  it("pauses playing media and resumes only after the final owner releases", async () => {
    const media = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="search" releaseDelayMs={0} />
        <ModalOwner active={false} source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="search" releaseDelayMs={0} />
        <ModalOwner active source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )

    expect(media.pause).toHaveBeenCalledOnce()
    render(
      <>
        <ModalOwner active={false} source="search" releaseDelayMs={0} />
        <ModalOwner active source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    expect(media.play).not.toHaveBeenCalled()

    render(
      <>
        <ModalOwner active={false} source="search" releaseDelayMs={0} />
        <ModalOwner active={false} source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    await act(async () => Promise.resolve())
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("does not pause or resume media that was already paused", () => {
    const media = makeMedia({ paused: true })
    render(
      <>
        <ModalOwner active source="search" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="search" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )

    expect(media.pause).not.toHaveBeenCalled()
    expect(media.play).not.toHaveBeenCalled()
  })

  it("pauses late media without inventing resume entitlement", () => {
    const media = makeMedia()
    render(
      <>
        <ModalOwner active source="quiz" releaseDelayMs={0} />
        <MediaOwner media={null} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="quiz" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    expect(media.pause).toHaveBeenCalledOnce()

    render(
      <>
        <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    expect(media.play).not.toHaveBeenCalled()
  })

  it("does not resume a replaced media identity", () => {
    const original = makeMedia()
    const replacement = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="share" releaseDelayMs={0} />
        <MediaOwner media={original} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={original} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={replacement} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="share" releaseDelayMs={0} />
        <MediaOwner media={replacement} />
      </>,
    )

    expect(original.play).not.toHaveBeenCalled()
    expect(replacement.play).not.toHaveBeenCalled()
  })

  it("does not resume a new source loaded into the same media element", () => {
    const media = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="share" releaseDelayMs={0} />
        <MediaOwner media={media} playbackIdentity="source-a" />
      </>,
    )
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={media} playbackIdentity="source-a" />
      </>,
    )
    media.paused = false
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={media} playbackIdentity="source-b" />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="share" releaseDelayMs={0} />
        <MediaOwner media={media} playbackIdentity="source-b" />
      </>,
    )

    expect(media.play).not.toHaveBeenCalled()
  })

  it("does not grant entitlement to media replaced in the modal-open commit", () => {
    const original = makeMedia()
    const replacement = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="search" releaseDelayMs={0} />
        <MediaOwner media={original} playbackIdentity="source-a" />
      </>,
    )
    render(
      <>
        <ModalOwner active source="search" releaseDelayMs={0} />
        <MediaOwner media={replacement} playbackIdentity="source-b" />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="search" releaseDelayMs={0} />
        <MediaOwner media={replacement} playbackIdentity="source-b" />
      </>,
    )

    expect(replacement.pause).toHaveBeenCalledOnce()
    expect(replacement.play).not.toHaveBeenCalled()
  })

  it("revokes resume entitlement when the original media leaves and returns", () => {
    const original = makeMedia()
    const replacement = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="share" releaseDelayMs={0} />
        <MediaOwner media={original} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={original} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={replacement} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="share" releaseDelayMs={0} />
        <MediaOwner media={original} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="share" releaseDelayMs={0} />
        <MediaOwner media={original} />
      </>,
    )

    expect(original.play).not.toHaveBeenCalled()
  })

  it("keeps duplicate source labels isolated by owner token", () => {
    const media = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
        <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="quiz" releaseDelayMs={0} />
        <ModalOwner active source="quiz" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
        <ModalOwner active source="quiz" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    expect(media.play).not.toHaveBeenCalled()
    render(
      <>
        <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
        <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("re-pauses play attempts while activity remains open", () => {
    const media = makeMedia({ paused: true })
    render(
      <>
        <ModalOwner active source="feedback" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )

    act(() => {
      void media.play()
    })
    expect(media.pause).toHaveBeenCalledOnce()
    expect(media.paused).toBe(true)
  })

  it("keeps activity through the shared close delay", async () => {
    const media = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="question" />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="question" />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="question" />
        <MediaOwner media={media} />
      </>,
    )

    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS - 1))
    expect(media.play).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("cancels a pending release when the owner reopens", async () => {
    const media = makeMedia()
    render(
      <>
        <ModalOwner active={false} source="question" />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="question" />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="question" />
        <MediaOwner media={media} />
      </>,
    )
    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS - 1))
    render(
      <>
        <ModalOwner active source="question" />
        <MediaOwner media={media} />
      </>,
    )
    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS))
    expect(media.play).not.toHaveBeenCalled()

    render(
      <>
        <ModalOwner active={false} source="question" />
        <MediaOwner media={media} />
      </>,
    )
    await act(async () => {
      vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS)
      await Promise.resolve()
    })
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("keeps token ownership balanced under StrictMode effect replay", async () => {
    const media = makeMedia()
    act(() => {
      root.render(
        <StrictMode>
          <WatchModalActivityProvider>
            <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
            <MediaOwner media={media} />
          </WatchModalActivityProvider>
        </StrictMode>,
      )
    })
    act(() => {
      root.render(
        <StrictMode>
          <WatchModalActivityProvider>
            <ModalOwner active source="quiz" releaseDelayMs={0} />
            <MediaOwner media={media} />
          </WatchModalActivityProvider>
        </StrictMode>,
      )
    })
    act(() => {
      root.render(
        <StrictMode>
          <WatchModalActivityProvider>
            <ModalOwner active={false} source="quiz" releaseDelayMs={0} />
            <MediaOwner media={media} />
          </WatchModalActivityProvider>
        </StrictMode>,
      )
    })
    await act(async () => Promise.resolve())

    expect(media.paused).toBe(false)
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("swallows a rejected resume", async () => {
    const media = makeMedia({ rejectPlay: true })
    render(
      <>
        <ModalOwner active={false} source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    render(
      <>
        <ModalOwner active={false} source="language" releaseDelayMs={0} />
        <MediaOwner media={media} />
      </>,
    )
    await act(async () => Promise.resolve())

    expect(media.play).toHaveBeenCalledOnce()
  })
})
