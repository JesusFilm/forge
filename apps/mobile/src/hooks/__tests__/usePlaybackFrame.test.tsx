// The route-side reads of the root playback host (U6, feat-551 U13). The probe
// renders under StrictMode: both hooks subscribe to one module store, and the
// double effect cycle must leave one live subscription.
import { StrictMode, act } from "react"

import { getPlaybackRequestStore } from "../../lib/miniPlayer/playbackRequest"
import type { PlaybackRequest } from "../../lib/miniPlayer/playbackRequest"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  useFloatingWindowFrame,
  usePlaybackFrameVisible,
} from "../usePlaybackFrame"

const store = getPlaybackRequestStore()
const RECT = { x: 0, y: 62, width: 440, height: 248 }
const FRAME = { x: 243, y: 130, width: 185, height: 104 }

const REQUEST: PlaybackRequest = {
  streamingUrl: "https://stream.mux.com/assetAAA111.m3u8",
  posterUrl: null,
  subtitleVttSrc: null,
  fullscreen: false,
  autostart: true,
  resumeAtSeconds: null,
  progressVideoId: "video-a",
  progressVideoSlug: null,
  progressLanguageSlug: "english",
  onToggleFullscreen: null,
  castActive: false,
  cast: null,
  progressFeedRef: null,
  session: {
    videoId: "video-a",
    videoSlug: "video-a-slug",
    title: "Video A",
    titleFromRecord: true,
    posterUrl: null,
    languageSlug: "english",
    originPattern: "watch/[slug]",
  },
}

const visible: boolean[] = []
const frames: Array<ReturnType<typeof useFloatingWindowFrame>> = []

function Probe() {
  visible.push(usePlaybackFrameVisible())
  frames.push(useFloatingWindowFrame())
  return null
}

let mounted: TestInstance | null = null

async function render() {
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
}

beforeEach(() => {
  store.reset()
  getMiniPlayerStore().end("abandoned")
  visible.length = 0
  frames.length = 0
})

afterEach(async () => {
  await act(async () => {
    mounted?.unmount()
  })
  mounted = null
  store.reset()
  getMiniPlayerStore().end("abandoned")
})

describe("usePlaybackFrameVisible", () => {
  it("is true only while the host draws into an uncovered, measured slot", async () => {
    await render()
    expect(visible[visible.length - 1]).toBe(false)

    let id = 0
    await act(async () => {
      id = store.attachSlot(REQUEST)
      store.setSlotRect(id, RECT)
    })
    expect(visible[visible.length - 1]).toBe(true)

    // feat-551 KTD10: a reader covers the slot. Admission refuses here (no
    // playback facts), and the screen draws its own back button either way.
    await act(async () => {
      store.coverSlot(id)
    })
    expect(store.getSnapshot().cover).toBe("refused")
    expect(visible[visible.length - 1]).toBe(false)

    await act(async () => {
      store.uncoverSlot(id)
    })
    expect(visible[visible.length - 1]).toBe(true)
  })
})

describe("useFloatingWindowFrame", () => {
  it("reads the frame the host publishes, and ignores unrelated commits", async () => {
    await render()
    expect(frames[frames.length - 1]).toBeNull()

    await act(async () => {
      store.setWindowFrame(FRAME)
    })
    expect(frames[frames.length - 1]).toEqual(FRAME)

    // A playing-flag commit changes the snapshot, not the frame: same object.
    const before = frames[frames.length - 1]
    await act(async () => {
      store.setPlaying(true)
    })
    expect(frames[frames.length - 1]).toBe(before)

    await act(async () => {
      store.setWindowFrame(null)
    })
    expect(frames[frames.length - 1]).toBeNull()
  })
})
