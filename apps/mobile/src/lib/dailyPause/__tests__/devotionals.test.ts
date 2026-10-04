// The two devotionals (U4, R39, R40, KTD3). The text copies the videos' own
// words from the plan, and the part ranges come from U3's timeline. The hook
// cases wrap the element in StrictMode (RTL is not installed here).
import { StrictMode, act, createElement } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import timeline from "../devotionalTimeline.json"
import {
  DEVOTIONALS,
  useDevotionalVideo,
  type DevotionalVideoState,
} from "../devotionals"

type MockAsset = { downloadAsync: () => Promise<{ localUri: string | null }> }
const mockFromModule = jest.fn<MockAsset, [number]>()

jest.mock("expo-asset", () => ({
  Asset: { fromModule: (id: number) => mockFromModule(id) },
}))

const TEXT = {
  pharisee: {
    name: "Pharisee",
    passage: "Luke 18:9-14",
    question: "How are we commanded to pray?",
    verse:
      "I tell you, this man, rather than the Pharisee, went home justified. For everyone who exalts himself will be humbled, but the one who humbles himself will be exalted.",
    verseLabel: "LUKE 18:14 · BSB",
    prayerPrompt:
      "Bring your honest need to God right now and ask him for mercy.",
    attribution: "Adapted from a trusted classic · J.C. Ryle, 1858",
  },
  lamp: {
    name: "Lamp",
    passage: "Luke 8:16-18",
    question:
      "Where is one place this week you can let someone see what Christ has done in you?",
    verse:
      "No one, when he has lit a lamp, covers it with a container, or puts it under a bed; but puts it on a stand, that those who enter in may see the light.",
    verseLabel: "LUKE 8:16",
    prayerPrompt:
      "Ask God to show you one person who needs to see the light he's given you.",
    attribution: "Adapted from a trusted classic · J.C. Ryle",
  },
} as const

const IDS = ["pharisee", "lamp"] as const

describe("the bundled devotionals (R39, R40)", () => {
  it("holds exactly Pharisee and Lamp", () => {
    expect(Object.keys(DEVOTIONALS).sort()).toEqual([...IDS].sort())
  })

  it.each(IDS)("%s carries the video's own screen text", (id) => {
    const devotional = DEVOTIONALS[id]
    expect(devotional.id).toBe(id)
    expect({
      name: devotional.name,
      passage: devotional.passage,
      question: devotional.question,
      verse: devotional.verse,
      verseLabel: devotional.verseLabel,
      prayerPrompt: devotional.prayerPrompt,
      attribution: devotional.attribution,
    }).toEqual(TEXT[id])
  })

  it.each(IDS)("%s plays its own three parts from the timeline", (id) => {
    const { parts } = DEVOTIONALS[id]
    expect(Object.keys(parts)).toEqual(["film", "teaching", "prayer"])
    expect(parts).toEqual(timeline[id].parts)
  })

  it.each(IDS)("%s refers to its own bundled video", (id) => {
    // React Native's jest transform turns an .mp4 require into its file path.
    expect(DEVOTIONALS[id].video).toEqual({
      testUri: expect.stringMatching(
        new RegExp(`/assets/devotionals/${id}\\.mp4$`),
      ),
    })
  })
})

describe("useDevotionalVideo", () => {
  const seen: DevotionalVideoState[] = []

  function Probe() {
    seen.push(useDevotionalVideo(DEVOTIONALS.pharisee))
    return null
  }

  async function mount(): Promise<TestInstance> {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(StrictMode, null, createElement(Probe)),
      )
    })
    return renderer
  }

  afterEach(() => {
    seen.length = 0
    mockFromModule.mockReset()
  })

  it("loads, then gives the local file of the video", async () => {
    let finish: (asset: { localUri: string | null }) => void = () => {}
    mockFromModule.mockReturnValue({
      downloadAsync: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const renderer = await mount()
    expect(seen.at(-1)).toEqual({ status: "loading" })
    await act(async () => {
      finish({ localUri: "file:///bundle/pharisee.mp4" })
    })
    expect(seen.at(-1)).toEqual({
      status: "ready",
      uri: "file:///bundle/pharisee.mp4",
    })
    await unmount(renderer)
  })

  it.each<[string, () => MockAsset]>([
    [
      "the download rejects",
      () => ({ downloadAsync: () => Promise.reject(new Error("no asset")) }),
    ],
    [
      "the asset has no local file",
      () => ({ downloadAsync: async () => ({ localUri: null }) }),
    ],
    [
      "the asset lookup throws",
      () => {
        throw new Error("unknown module")
      },
    ],
  ])("gives an error state, with no throw, when %s", async (_, asset) => {
    mockFromModule.mockImplementation(asset)
    const renderer = await mount()
    expect(seen.at(-1)).toEqual({ status: "error" })
    await unmount(renderer)
  })
})
