import { makeFakePlayer } from "../../test-utils/expoVideoMock"
import { RECOVERY_SEEK_WINDOW_MS, recoverPlayback } from "../recoverPlayback"

const URL = "https://stream.mux.com/abc.m3u8"

describe("recoverPlayback", () => {
  it("re-applies the source so the errored player can play again", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 0)
    player.__settleReplace()
    await done

    expect(player.replaceAsync).toHaveBeenCalledWith(URL)
  })

  // Order matters: play() before the seek starts the viewer at zero and then
  // jumps. VideoPlayer's own resume does seek-then-play inside sourceLoad.
  it("seeks before it resumes, not after", async () => {
    const player = makeFakePlayer()
    player.status = "error"
    const order: string[] = []
    const original = player.play.getMockImplementation()
    player.play.mockImplementation(() => {
      order.push(`play@${player.currentTime}`)
      original?.()
    })

    const done = recoverPlayback(player, URL, 249.7)
    player.__settleReplace()
    await done

    expect(order).toEqual(["play@249.7"])
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  })

  it("restores the position the viewer had reached, then resumes", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 249.7)
    player.__settleReplace()
    await done

    expect(player.currentTime).toBe(249.7)
    expect(player.play).toHaveBeenCalled()
  })

  // Mirrors the adapter's own swap path, which falls back to the synchronous
  // replace() when replaceAsync rejects.
  it("falls back to the synchronous replace when replaceAsync rejects", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 10)
    player.__settleReplace(new Error("network down"))
    await done

    expect(player.replace).toHaveBeenCalledWith(URL, true)
    expect(player.play).toHaveBeenCalled()
  })

  // Without an outcome the recovery is invisible: neither a manual check on a
  // device nor production telemetry can tell a working button from a dead one.
  it("reports that it recovered", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 10)
    player.__settleReplace()

    await expect(done).resolves.toBe("recovered")
  })

  it("reports failure when every recovery route fails", async () => {
    const player = makeFakePlayer()
    player.status = "error"
    player.replace.mockImplementation(() => {
      throw new Error("released")
    })

    const done = recoverPlayback(player, URL, 10)
    player.__settleReplace(new Error("network down"))

    await expect(done).resolves.toBe("failed")
  })

  // The caller is a press handler. A rejection escaping it is an unhandled
  // rejection, and the viewer still gets no feedback.
  it("never rejects, even when every recovery route fails", async () => {
    const player = makeFakePlayer()
    player.status = "error"
    player.replace.mockImplementation(() => {
      throw new Error("released")
    })

    const done = recoverPlayback(player, URL, 10)
    player.__settleReplace(new Error("network down"))

    await expect(done).resolves.toBe("failed")
  })

  it("restores the position on the synchronous fallback too", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 120)
    player.__settleReplace(new Error("network down"))
    await done

    expect(player.currentTime).toBe(120)
  })

  // The outcome is the only signal the viewer's failure ever produces, so a
  // resume that never started must not be logged as a success.
  it("reports failure when the source lands but playback cannot start", async () => {
    const player = makeFakePlayer()
    player.status = "error"
    player.play.mockImplementation(() => {
      throw new Error("released")
    })

    const done = recoverPlayback(player, URL, 10)
    player.__settleReplace()

    await expect(done).resolves.toBe("failed")
  })

  // Mirrors the adapter's swap resume: never start audio the viewer cannot see.
  it("re-applies the source but does not play when the guard declines", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 10, () => false)
    player.__settleReplace()

    await expect(done).resolves.toBe("recovered")
    expect(player.replaceAsync).toHaveBeenCalledWith(URL)
    expect(player.play).not.toHaveBeenCalled()
  })

  // The app runs ONE shared player whose source swaps underneath. A load that
  // belongs to a different video must not be mistaken for this recovery's,
  // or the incoming video jumps to the outgoing one's position.
  it("ignores a load that belongs to a different source", async () => {
    const player = makeFakePlayer()
    player.status = "error"
    const OTHER = "https://stream.mux.com/someone-else.m3u8"

    const done = recoverPlayback(player, URL, 249.7)

    // Another surface's video lands first on the shared player.
    player.currentTime = 12
    player.__emit("sourceLoad", { videoSource: OTHER })

    expect(player.currentTime).toBe(12)
    expect(player.play).not.toHaveBeenCalled()

    // Ours arrives afterwards and is honoured.
    player.__settleReplace()
    await done

    expect(player.currentTime).toBe(249.7)
  })

  // A source can be SET and never load. The player outlives every route, so a
  // listener left waiting would take the NEXT video's load and jump it to a
  // position belonging to a video the viewer has already left.
  it("stops waiting for the load after the seek window, and reports failure", async () => {
    jest.useFakeTimers()
    try {
      const player = makeFakePlayer()
      player.status = "error"

      const done = recoverPlayback(player, URL, 249.7)
      player.__settleReplace(undefined, { withholdLoad: true })
      jest.advanceTimersByTime(RECOVERY_SEEK_WINDOW_MS)

      await expect(done).resolves.toBe("failed")

      // The load finally arrives, far too late. Nothing may act on it.
      player.currentTime = 5
      player.__emit("sourceLoad", { videoSource: URL })

      expect(player.currentTime).toBe(5)
      expect(player.play).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  // The player outlives every route, so a load that never arrives would leave
  // this listener attached for the life of the app.
  it("drops the pending seek listener once it has fired", async () => {
    const player = makeFakePlayer()
    player.status = "error"

    const done = recoverPlayback(player, URL, 30)
    player.__settleReplace()
    await done

    player.currentTime = 5
    player.__emit("sourceLoad", undefined)

    expect(player.currentTime).toBe(5)
  })
})
