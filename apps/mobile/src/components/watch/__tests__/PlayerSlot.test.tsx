/**
 * The surface-side half of the hoist (U6): what a screen publishes, and what
 * its unmount decides.
 *
 * The StrictMode case is not decoration. This component's mount effect CLEANS
 * UP by detaching its slot, which is the same signal a committed back press
 * sends — under dev StrictMode's setup/cleanup/setup cycle a slot that did not
 * re-attach would leave the screen with no player and no way to notice.
 *
 * NOT covered here, deliberately: the measure itself. jest-expo's `View` is a
 * class mock whose `measureInWindow` never calls back, so a green measure
 * assertion would only be testing an injected fake. The rect that reaches the
 * host is device evidence (the simulator smoke owed after U7).
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

jest.mock("expo-image", () => ({ Image: () => null }))

import { StrictMode, act, type ReactElement } from "react"

import { PlayerSlot } from "../PlayerSlot"
import { getPlaybackRequestStore } from "../../../lib/miniPlayer/playbackRequest"
import { getMiniPlayerStore } from "../../../lib/miniPlayer/store"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const requestStore = getPlaybackRequestStore()
const sessionStore = getMiniPlayerStore()

const URL_A = "https://stream.mux.com/assetAAA111.m3u8"

const SESSION_A = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  title: "Video A",
  posterUrl: null,
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

const POSTER = "https://images.example/a.jpg"

function slot(props: { session?: typeof SESSION_A | null } = {}): ReactElement {
  return (
    <PlayerSlot
      streamingUrl={URL_A}
      posterUrl={POSTER}
      autostart
      progressIdentity={{ videoId: "video-a", languageSlug: "english" }}
      session={props.session === undefined ? SESSION_A : props.session}
    />
  )
}

let mounted: TestInstance | null = null

async function render(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  mounted = renderer
  return renderer
}

/**
 * The poster is the slot's own visible state, and it is shown exactly when the
 * root player is drawing SOMEWHERE ELSE — which the slot decides by comparing
 * the store's owning slot against the id its mount effect wrote.
 */
function posters(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.recyclingKey === "player-slot-poster",
  )
}

beforeEach(() => {
  requestStore.reset()
  sessionStore.end("abandoned")
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  requestStore.reset()
  sessionStore.end("abandoned")
})

describe("PlayerSlot", () => {
  it("publishes what the root player should own, and creates none itself", async () => {
    const renderer = await render(slot())

    const snapshot = requestStore.getSnapshot()
    expect(snapshot.request).toMatchObject({
      streamingUrl: URL_A,
      autostart: true,
      progressVideoId: "video-a",
      progressLanguageSlug: "english",
      session: SESSION_A,
    })
    expect(snapshot.slotId).not.toBeNull()
    // No video surface of its own — the host draws into the rect measured here.
    expect(
      renderer.root.findAll((node) => node.props.nativeControls === false),
    ).toHaveLength(0)
    // Owning the request, so nothing of its own covers the host's video view.
    expect(posters(renderer)).toHaveLength(0)
  })

  it("shows its poster while the root player is drawing somewhere else", async () => {
    const renderer = await render(slot())
    expect(posters(renderer)).toHaveLength(0)

    // A newer surface takes the player — the series screen's trailer opening
    // beneath a watch screen, or any later slot.
    await act(async () => {
      requestStore.attachSlot({
        ...(requestStore.getSnapshot().request as NonNullable<
          ReturnType<typeof requestStore.getSnapshot>["request"]
        >),
        streamingUrl: "https://stream.mux.com/assetBBB222.m3u8",
      })
    })

    expect(posters(renderer).length).toBeGreaterThan(0)
  })

  it("drops the request when the screen goes with no playback behind it", async () => {
    const renderer = await render(slot())
    expect(requestStore.getSnapshot().request).not.toBeNull()

    await act(async () => {
      renderer.unmount()
    })
    mounted = null

    expect(requestStore.getSnapshot().request).toBeNull()
    expect(sessionStore.getSnapshot().session).toBeNull()
  })

  it("survives StrictMode's mount, unmount, remount cycle with one live slot", async () => {
    const attach = jest.spyOn(requestStore, "attachSlot")
    await render(<StrictMode>{slot()}</StrictMode>)

    // Anti-vacuous: without a doubled effect cycle there is nothing to survive.
    expect(attach).toHaveBeenCalledTimes(2)
    const liveId = attach.mock.results[1].value as number
    const renderer = mounted as TestInstance
    expect(requestStore.getSnapshot().request?.streamingUrl).toBe(URL_A)
    expect(requestStore.getSnapshot().slotId).toBe(liveId)
    // The second setup restored the slot id the cleanup cleared: a screen left
    // holding the DETACHED id reads as "someone else is drawing" and covers the
    // host's video view with its poster. Same predicate gates the measure.
    expect(posters(renderer)).toHaveLength(0)
    attach.mockRestore()
  })
})
