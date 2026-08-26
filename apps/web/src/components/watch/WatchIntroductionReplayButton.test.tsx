/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  locale: "en",
  registerReplayTrigger: vi.fn(),
  replay: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations: () => () => "Take the Watch tour",
}))

vi.mock("@/components/watch/WatchIntroductionProvider", () => ({
  useOptionalWatchIntroduction: () => ({
    open: false,
    registerReplayTrigger: state.registerReplayTrigger,
    replay: state.replay,
  }),
}))

import { WatchIntroductionReplayButton } from "@/components/watch/WatchIntroductionReplayButton"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  state.locale = "en"
  state.registerReplayTrigger.mockReset()
  state.replay.mockReset()
  state.replay.mockReturnValue(true)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe("WatchIntroductionReplayButton", () => {
  it("registers and opens replay in an authored tour locale", () => {
    act(() => root.render(<WatchIntroductionReplayButton />))

    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.textContent).toBe("Take the Watch tour")
    expect(state.registerReplayTrigger).toHaveBeenCalledWith(button)

    act(() => button.click())
    expect(state.replay).toHaveBeenCalledWith(button)
  })

  it("hides replay while the tour catalog is pending", () => {
    state.locale = "fr"
    act(() => root.render(<WatchIntroductionReplayButton />))

    expect(container.querySelector("button")).toBeNull()
    expect(state.registerReplayTrigger).not.toHaveBeenCalled()
  })

  it("retries once after another modal releases activity", () => {
    vi.useFakeTimers()
    state.replay.mockReturnValueOnce(false).mockReturnValueOnce(true)
    act(() => root.render(<WatchIntroductionReplayButton />))
    const button = container.querySelector("button") as HTMLButtonElement

    act(() => button.click())
    expect(state.replay).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(199))
    expect(state.replay).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(state.replay).toHaveBeenCalledTimes(2)
    expect(state.replay).toHaveBeenLastCalledWith(button)
  })
})
