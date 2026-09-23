/**
 * feat-517 KTD1: the Home model and the recommendations insert index must land
 * in ONE state write, so no rendered frame can pair a new model with the
 * previous model's authored position. A probe component records every render's
 * pair, for the network paint and for the cold-launch snapshot paint.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests"). Only the hook's module-scope dependencies are mocked; the adapter,
 * the model builder and the snapshot parser all run for real.
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
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}))
jest.mock("../../lib/apolloClient", () => ({ getApolloClient: jest.fn() }))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../lib/watchHome/heroStreamCooldown", () => ({
  clearAllHeroStreamCooldowns: jest.fn(),
}))
// Sentinel documents: the real module pulls the whole typed client in, and the
// hook only needs to tell its two queries apart.
jest.mock("../../lib/queries", () => ({
  GET_WATCH_HOME_VIDEOS: { name: "videos" },
  GET_WATCH_SETTING: { name: "setting" },
}))

import { act, createElement } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { useWatchHome } from "../useWatchHome"
import { getApolloClient } from "../../lib/apolloClient"
import { GET_WATCH_HOME_VIDEOS } from "../../lib/queries"
import type {
  WatchHomeModel,
  WatchHomeVideoInput,
} from "../../lib/watchHome/model"
import { serializeHomeSnapshotFromVideosJson } from "../../lib/watchHomePersistence"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const storage = AsyncStorage as unknown as {
  getItem: jest.Mock
  setItem: jest.Mock
  removeItem: jest.Mock
}
const mockGetApolloClient = getApolloClient as jest.Mock
// The jest mock above replaces the typed document with a sentinel, so compare
// as unknown: the real type and the sentinel have no overlap.
const videosDocument = GET_WATCH_HOME_VIDEOS as unknown

/**
 * `WatchHomeModel` must never carry the index (KTD1). This resolves to `never`
 * the moment the field is added, so the assignment below stops compiling.
 */
type ModelHasNoIndex = "recommendationsInsertIndex" extends keyof WatchHomeModel
  ? never
  : true

const video: WatchHomeVideoInput = {
  documentId: "d-jesus",
  coreId: "1_jf-0-0",
  slug: "jesus",
  label: "FEATURE_FILM",
  images: [{ mobileCinematicHigh: "https://cdn/jesus.jpg" }],
  locales: [{ title: "JESUS" }],
}

// Items carry no coreId, so the hook finds nothing divergent and runs no
// top-up fetch. The recommendations block sits between the two shelves.
function collection(sectionKey: string): Record<string, unknown> {
  return {
    __typename: "MediaCollectionBlock",
    sectionKey,
    title: sectionKey,
    mediaCollectionVariant: "carousel",
    items: [
      {
        videoId: `v-${sectionKey}`,
        videoSlug: sectionKey,
        titleOverride: sectionKey,
      },
    ],
  }
}
const blocks = [
  collection("first"),
  { __typename: "HomepageRecommendationsBlock" },
  collection("second"),
]

type Frame = { model: WatchHomeModel | null; index: number | null }

let frames: Frame[] = []

function Probe(): null {
  const { model, recommendationsInsertIndex } = useWatchHome()
  frames.push({ model, index: recommendationsInsertIndex })
  return null
}

/**
 * One microtask per `act` scope. React collapses every update made inside a
 * single scope into one commit, so a wider flush would hide the torn frame this
 * suite exists to detect: stepping makes each turn its own commit.
 */
async function step(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderProbe(): Promise<TestInstance> {
  let renderer: TestInstance | undefined
  await act(() => {
    renderer = TestRenderer.create(createElement(Probe))
  })
  await step()
  return renderer as TestInstance
}

/** The first frame that painted a model, and every frame before it. */
function firstPaint(): { at: number; frame: Frame } {
  const at = frames.findIndex((frame) => frame.model != null)
  expect(at).toBeGreaterThanOrEqual(0)
  return { at, frame: frames[at] }
}

beforeEach(() => {
  frames = []
  jest.clearAllMocks()
  storage.getItem.mockResolvedValue(null)
  storage.setItem.mockResolvedValue(undefined)
})

describe("useWatchHome — the model and the insert index land in one state write (KTD1)", () => {
  it("never exposes the index inside WatchHomeModel", () => {
    const modelHasNoIndex: ModelHasNoIndex = true
    expect(modelHasNoIndex).toBe(true)
  })

  it("paints the network model and its index in the same render", async () => {
    mockGetApolloClient.mockReturnValue({
      query: jest.fn((args: { query: unknown }) =>
        args.query === videosDocument
          ? Promise.resolve({ data: { watchHomeVideos: [video] } })
          : Promise.resolve({
              data: { watchSetting: { homepageExperience: { blocks } } },
            }),
      ),
    })

    const renderer = await renderProbe()
    const { at, frame } = firstPaint()

    // The authored position arrives WITH the model, not a render later.
    expect(frame.index).toBe(1)
    expect(frame.model?.sections.map((section) => section.id)).toEqual([
      "first",
      "second",
    ])
    // No earlier frame leaked an index without a model.
    for (const earlier of frames.slice(0, at)) {
      expect(earlier.index).toBeNull()
    }
    // No later frame pairs a model with a different index.
    for (const later of frames.slice(at)) {
      expect(later.index).toBe(1)
    }
    expect(Object.keys(frame.model ?? {})).not.toContain(
      "recommendationsInsertIndex",
    )
    await unmount(renderer)
  })

  it("paints the snapshot model and its index in the same render", async () => {
    storage.getItem.mockResolvedValue(
      serializeHomeSnapshotFromVideosJson(
        JSON.stringify([video]),
        new Date(),
        JSON.stringify(blocks),
        "[]",
      ),
    )
    // The required videos fetch fails, so only the snapshot paints.
    mockGetApolloClient.mockReturnValue({
      query: jest.fn(() => Promise.reject(new Error("offline"))),
    })

    const renderer = await renderProbe()
    const { at, frame } = firstPaint()

    expect(frame.index).toBe(1)
    expect(frame.model?.sections.map((section) => section.id)).toEqual([
      "first",
      "second",
    ])
    for (const earlier of frames.slice(0, at)) {
      expect(earlier.index).toBeNull()
    }
    for (const later of frames.slice(at)) {
      expect(later.index).toBe(1)
    }
    await unmount(renderer)
  })

  /**
   * The render assertions above catch a torn frame, which is what an index
   * derived one commit later produces. They CANNOT catch a second state slot
   * written in the same tick: React batches those two writes into one commit,
   * so the rendered pairs are identical. This source check covers that shape.
   */
  it("holds the painted body in one state slot, written with both fields", () => {
    const nodeRequire = require as unknown as NodeRequireLike
    const fs = nodeRequire("fs") as {
      readFileSync: (path: string, encoding: string) => string
    }
    const source = fs.readFileSync(
      nodeRequire.resolve("../useWatchHome"),
      "utf8",
    )

    expect(source.match(/useState<WatchHomeBody>\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/setRecommendationsInsertIndex/)
    const writes = source.match(/setBody\(\{[^}]*\}\)/g) ?? []
    // The network paint and the snapshot paint are the two production writes.
    expect(writes).toHaveLength(2)
    for (const write of writes) {
      expect(write).toContain("model:")
      expect(write).toContain("recommendationsInsertIndex")
    }
  })

  it("reports a null index beside the model when no block is published", async () => {
    mockGetApolloClient.mockReturnValue({
      query: jest.fn((args: { query: unknown }) =>
        args.query === videosDocument
          ? Promise.resolve({ data: { watchHomeVideos: [video] } })
          : Promise.resolve({
              data: {
                watchSetting: {
                  homepageExperience: {
                    blocks: [collection("first"), collection("second")],
                  },
                },
              },
            }),
      ),
    })

    const renderer = await renderProbe()
    const { frame } = firstPaint()

    expect(frame.model?.sections).toHaveLength(2)
    expect(frame.index).toBeNull()
    await unmount(renderer)
  })
})
