/**
 * Behavioural coverage for the error-recovery wiring (todos/024).
 *
 * The dead-play-button bug was confirmed on a Galaxy Tab S8 and the fix has two
 * halves: rebuild the source, and resume where the viewer was. Review found the
 * second half had three independent ways to be silently inert, none of which
 * any test could see, because the wiring lived inline in VideoPlayer and was
 * unreachable. These tests drive the real hook against a fake player.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
jest.mock("../../lib/datadog", () => ({
  datadogLog: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))
// Passthrough by default: every case below drives the REAL recovery against a
// fake player. One case overrides it to reject, which is the only way to reach
// the hook's settlement handling from outside.
jest.mock("../../lib/recoverPlayback", () => {
  const actual = jest.requireActual("../../lib/recoverPlayback")
  return {
    ...actual,
    recoverPlayback: jest.fn((...args: unknown[]) =>
      (actual.recoverPlayback as (...a: unknown[]) => unknown)(...args),
    ),
  }
})

import { act } from "react"
import { AppState } from "react-native"

import { datadogLog } from "../../lib/datadog"
import { recoverPlayback } from "../../lib/recoverPlayback"
import { useErrorRecovery } from "../useErrorRecovery"
import { makeFakePlayer } from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const URL_A = "https://stream.mux.com/aaa.m3u8"
const URL_B = "https://stream.mux.com/bbb.m3u8"

type Player = ReturnType<typeof makeFakePlayer>

/**
 * Mounts the hook and exposes its recover callback.
 *
 * `position` stands in for the adapter's 1s poll, which is where the resume
 * position comes from. The hook must NOT be fed by a hand-emitted `timeUpdate`:
 * expo-video only emits that event when `timeUpdateEventInterval` is set, and
 * this app deliberately never sets it — the adapter polls instead. A test that
 * synthesises the event proves nothing about production.
 */
async function mount(
  player: Player,
  streamingUrl: string | null,
  position: { current: number } = { current: 0 },
) {
  const box: { recover: () => void } = { recover: () => {} }
  function Probe({ url }: { url: string | null }) {
    box.recover = useErrorRecovery(
      player as never,
      url,
      false,
      () => position.current,
    )
    return null
  }
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Probe url={streamingUrl} />)
  })
  return {
    box,
    rerender: async (url: string | null) => {
      await act(async () => {
        renderer.update(<Probe url={url} />)
      })
    },
    unmount: async () => {
      await act(async () => {
        renderer.unmount()
      })
    },
  }
}

describe("useErrorRecovery", () => {
  beforeEach(() => {
    ;(datadogLog.warn as jest.Mock).mockClear()
  })

  it("resumes from the last healthy position, not the zero an errored player reports", async () => {
    const player = makeFakePlayer()
    player.status = "readyToPlay"
    // The adapter's poll has seen playback reach four minutes.
    const position = { current: 249.7 }
    const h = await mount(player, URL_A, position)

    // The drop lands and the player zeroes its own clock before we look.
    player.status = "error"
    player.currentTime = 0

    await act(async () => {
      h.box.recover()
      player.__settleReplace()
    })

    expect(player.replaceAsync).toHaveBeenCalledWith(URL_A)
    expect(player.currentTime).toBe(249.7)
    await h.unmount()
  })

  // The latch stops repeat presses opening several swaps on the app's ONE
  // shared player, so releasing it only on the success path makes a rejected
  // recovery permanent: the button stays dead for the life of the player, which
  // is the exact complaint this whole path exists to answer. recoverPlayback
  // catches everything today, so this guards the SEAM, not a live defect.
  it("frees the retry latch when a recovery rejects", async () => {
    const player = makeFakePlayer()
    player.status = "error"
    const h = await mount(player, URL_A)
    ;(recoverPlayback as jest.Mock).mockRejectedValueOnce(new Error("boom"))

    await act(async () => {
      h.box.recover()
    })
    expect(player.replaceAsync).not.toHaveBeenCalled()

    // The viewer presses again. A stranded latch swallows this press.
    await act(async () => {
      h.box.recover()
    })

    expect(player.replaceAsync).toHaveBeenCalledTimes(1)
    await act(async () => {
      player.__settleReplace()
    })
    await h.unmount()
  })

  it("starts one recovery however many times the viewer presses", async () => {
    const player = makeFakePlayer()
    player.status = "readyToPlay"
    const h = await mount(player, URL_A)

    await act(async () => {
      h.box.recover()
      h.box.recover()
      h.box.recover()
    })

    expect(player.__pendingReplaceCount()).toBe(1)
    await act(async () => {
      player.__settleReplace()
    })
    expect(player.replaceAsync).toHaveBeenCalledTimes(1)
    await h.unmount()
  })

  // The position is read at PRESS time, never captured at mount. The adapter
  // clears it on a source change, and the hook must see that — a value latched
  // when the hook mounted would resume the incoming video at the outgoing
  // one's position.
  it("reads the position when the viewer presses, not when it mounted", async () => {
    const player = makeFakePlayer()
    player.status = "readyToPlay"
    const position = { current: 249.7 }
    const h = await mount(player, URL_A, position)

    await h.rerender(URL_B)
    // What the adapter does on a source change.
    position.current = 0

    await act(async () => {
      h.box.recover()
      player.__settleReplace()
    })

    expect(player.replaceAsync).toHaveBeenCalledWith(URL_B)
    expect(player.currentTime).toBe(0)
    await h.unmount()
  })

  it("does not start audio while the app is backgrounded", async () => {
    const player = makeFakePlayer()
    player.status = "readyToPlay"
    const h = await mount(player, URL_A)

    const appState = AppState as unknown as { currentState: string }
    const previous = appState.currentState
    appState.currentState = "background"
    try {
      await act(async () => {
        h.box.recover()
        player.__settleReplace()
      })
      expect(player.replaceAsync).toHaveBeenCalledWith(URL_A)
      expect(player.play).not.toHaveBeenCalled()
    } finally {
      appState.currentState = previous
    }
    await h.unmount()
  })

  it("reports the outcome so a failed recovery is never silent", async () => {
    const player = makeFakePlayer()
    player.status = "readyToPlay"
    const h = await mount(player, URL_A)

    await act(async () => {
      h.box.recover()
      player.__settleReplace()
    })

    expect(datadogLog.warn).toHaveBeenCalledWith(
      "video.error_recovery",
      expect.objectContaining({ outcome: "recovered" }),
    )
    await h.unmount()
  })

  it("does nothing when there is no source to rebuild", async () => {
    const player = makeFakePlayer()
    const h = await mount(player, null)

    await act(async () => {
      h.box.recover()
    })

    expect(player.replaceAsync).not.toHaveBeenCalled()
    await h.unmount()
  })
})
