// "Share this video" (U11, KTD15, R20, R42). The suite runs the real `File`
// and `Paths` on jest-expo's in-memory file system. Only the share sheet is
// modelled, and it records the file that it receives.
import { File, Paths } from "expo-file-system"

import { DEVOTIONALS, type DevotionalId } from "../devotionals"
import { shareDevotionalVideo } from "../shareVideo"

type SheetOptions = { mimeType?: string; UTI?: string }
type Received = { uri: string; text: string | null; options?: SheetOptions }

const mockShareAsync = jest.fn<Promise<void>, [string, SheetOptions?]>()
jest.mock("expo-sharing", () => ({
  shareAsync: (uri: string, options?: SheetOptions) =>
    mockShareAsync(uri, options),
}))

let received: Received[] = []

beforeEach(() => {
  received = []
  mockShareAsync.mockReset()
  mockShareAsync.mockImplementation(async (uri, options) => {
    const file = new File(uri)
    received.push({
      uri,
      text: file.exists ? file.textSync() : null,
      options,
    })
  })
  for (const directory of [Paths.cache, Paths.bundle]) {
    for (const entry of directory.list()) entry.delete()
  }
})

/** The bundled video as the asset system gives it: a local file. */
function bundledVideo(id: DevotionalId, text = `${id} video bytes`): File {
  const file = new File(Paths.bundle, `${id}.mp4`)
  file.write(text)
  return file
}

it.each([
  ["pharisee", "Daily Bible Pause – Pharisee.mp4"],
  ["lamp", "Daily Bible Pause – Lamp.mp4"],
] as const)(
  "copies the %s video to the cache as %s, then shares that file as a video",
  async (id, name) => {
    const video = bundledVideo(id)

    await shareDevotionalVideo(DEVOTIONALS[id], video.uri)

    expect(received).toHaveLength(1)
    const [shared] = received
    expect(shared?.uri).toBe(new File(Paths.cache, name).uri)
    expect(decodeURIComponent(shared?.uri.split("/").pop() ?? "")).toBe(name)
    // The sheet found the whole video at that name when it opened.
    expect(shared?.text).toBe(`${id} video bytes`)
    expect(shared?.options).toMatchObject({
      mimeType: "video/mp4",
      UTI: "public.mpeg-4",
    })
  },
)

it("reuses the cache copy for a later share", async () => {
  const video = bundledVideo("pharisee")
  await shareDevotionalVideo(DEVOTIONALS.pharisee, video.uri)
  const copy = new File(Paths.cache, "Daily Bible Pause – Pharisee.mp4")
  const firstWrite = copy.modificationTime

  await shareDevotionalVideo(DEVOTIONALS.pharisee, video.uri)

  expect(received.map((entry) => entry.uri)).toEqual([copy.uri, copy.uri])
  expect(copy.modificationTime).toBe(firstWrite)
})

it("makes the copy again when its size differs from the bundled video", async () => {
  const video = bundledVideo("lamp", "the whole lamp video")
  new File(Paths.cache, "Daily Bible Pause – Lamp.mp4").write("the who")

  await shareDevotionalVideo(DEVOTIONALS.lamp, video.uri)

  expect(received.map((entry) => entry.text)).toEqual(["the whole lamp video"])
})
