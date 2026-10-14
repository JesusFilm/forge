import { Directory, File, Paths } from "expo-file-system"

import { DEVOTIONALS, type DevotionalId } from "../devotionals"
import {
  WIDGET_ART_APP_GROUP,
  appWidgetArtPort,
  stageWidgetArt,
  type WidgetArtFolder,
  type WidgetArtPort,
} from "../widgetArt"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync: (path: string, encoding: string) => string
}>("node:fs")
const path = jest.requireActual<{ join: (...parts: string[]) => string }>(
  "node:path",
)

// A bundled image resolves to its file in the in-memory bundle folder. The
// table is read at call time: devotionals.ts imports this module too.
jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: (module: unknown) => {
      const all = jest.requireActual("../devotionals").DEVOTIONALS as Record<
        string,
        { widgetArt: unknown }
      >
      const id = Object.keys(all).find((key) => all[key]!.widgetArt === module)
      return {
        downloadAsync: async () => {},
        localUri: `file:///mock/bundle/${id}-widget.jpg`,
        hash: `${id}hash`,
      }
    },
  },
}))

/** A shared folder in memory that records each copy. */
function memoryFolder(seed: string[] = []) {
  const files = new Map<string, string>(seed.map((name) => [name, "old"]))
  const copies: string[] = []
  const folder: WidgetArtFolder = {
    uri: (name) => `file:///group/daily-pause-widget/${name}`,
    names: () => [...files.keys()],
    copyIn: async (from, name) => {
      copies.push(name)
      files.set(name, from)
    },
    remove: (name) => {
      files.delete(name)
    },
  }
  return { folder, files, copies }
}

function port(
  folder: WidgetArtFolder | null,
  overrides: Partial<WidgetArtPort> = {},
): WidgetArtPort {
  return {
    folder: () => folder,
    resolve: async (id) => ({
      uri: `file:///bundle/${id}-widget.jpg`,
      hash: `${id}hash`,
    }),
    ...overrides,
  }
}

describe("stageWidgetArt", () => {
  it("copies each devotional's art into the shared folder, named by its content", async () => {
    const { folder, files } = memoryFolder()
    const art = await stageWidgetArt(port(folder))
    expect(art).toEqual({
      pharisee: "file:///group/daily-pause-widget/pharisee-phariseehash.jpg",
      lamp: "file:///group/daily-pause-widget/lamp-lamphash.jpg",
    })
    expect(files.get("pharisee-phariseehash.jpg")).toBe(
      "file:///bundle/pharisee-widget.jpg",
    )
  })

  it("copies nothing that the folder already holds", async () => {
    const { folder, copies } = memoryFolder([
      "pharisee-phariseehash.jpg",
      "lamp-lamphash.jpg",
    ])
    await stageWidgetArt(port(folder))
    expect(copies).toEqual([])
  })

  it("removes an older copy, so the folder holds only today's art", async () => {
    const { folder, files } = memoryFolder(["pharisee-oldhash.jpg"])
    await stageWidgetArt(port(folder))
    expect([...files.keys()].sort()).toEqual([
      "lamp-lamphash.jpg",
      "pharisee-phariseehash.jpg",
    ])
  })

  it("stages nothing without the shared folder", async () => {
    expect(await stageWidgetArt(port(null))).toEqual({})
    const throwing = port(null, {
      folder: () => {
        throw new Error("no App Group")
      },
    })
    expect(await stageWidgetArt(throwing)).toEqual({})
  })

  it("leaves out only a devotional whose art fails, and keeps the rest", async () => {
    const { folder } = memoryFolder()
    const art = await stageWidgetArt(
      port(folder, {
        resolve: async (id) => {
          if (id === "lamp") throw new Error("asset failed")
          return { uri: `file:///bundle/${id}-widget.jpg`, hash: "h" }
        },
      }),
    )
    expect(Object.keys(art)).toEqual(["pharisee"])
  })

  // Code review, 2026-10-13: a pass whose resolve timed out deleted the good
  // copy, and those days drew the plain ground until a later pass.
  it("keeps an earlier pass's copy when a pass cannot stage the art", async () => {
    const { folder, files } = memoryFolder(["lamp-oldhash.jpg"])
    const art = await stageWidgetArt(
      port(folder, {
        resolve: async (id) => {
          if (id === "lamp") throw new Error("asset timed out")
          return { uri: `file:///bundle/${id}-widget.jpg`, hash: `${id}hash` }
        },
      }),
    )
    expect(art.lamp).toBe("file:///group/daily-pause-widget/lamp-oldhash.jpg")
    expect(files.has("lamp-oldhash.jpg")).toBe(true)
  })

  // expo-file-system's copy is async (SDK 57). A pass that did not wait named
  // a file before it existed, and a failed copy escaped as a rejection.
  it("waits for each copy before it names the file", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { folder, files } = memoryFolder()
    folder.copyIn = async (from, name) => {
      await gate
      files.set(name, from)
    }
    let settled = false
    const pass = stageWidgetArt(port(folder)).then((art) => {
      settled = true
      return art
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    release()
    const art = await pass
    expect(Object.keys(art).sort()).toEqual(["lamp", "pharisee"])
    expect(files.has("pharisee-phariseehash.jpg")).toBe(true)
  })

  it("names no file whose copy failed", async () => {
    const { folder } = memoryFolder()
    folder.copyIn = async (_from, name) => {
      if (name.startsWith("lamp-")) throw new Error("disk full")
    }
    const art = await stageWidgetArt(port(folder))
    expect(Object.keys(art)).toEqual(["pharisee"])
  })
})

// The app's own port over expo-file-system's in-memory jest double, which
// jest-expo hands to the File and Directory classes.
describe("the App Group port", () => {
  const GROUP_URI = "file:///mock/group"
  const FOLDER_URI = `${GROUP_URI}/daily-pause-widget`
  let groups: Record<string, Directory> = {}

  function bundled(id: DevotionalId): File {
    return new File(`file:///mock/bundle/${id}-widget.jpg`)
  }

  beforeEach(() => {
    // The double's store outlives a test, so each test starts a new group.
    const group = new Directory(GROUP_URI)
    if (group.exists) group.delete()
    group.create({ intermediates: true })
    groups = { [WIDGET_ART_APP_GROUP]: group }
    jest
      .spyOn(Paths, "appleSharedContainers", "get")
      .mockImplementation(() => groups)
    for (const id of Object.keys(DEVOTIONALS) as DevotionalId[]) {
      bundled(id).write(new Uint8Array(1000).fill(7))
    }
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function staged(): string[] {
    return new Directory(FOLDER_URI)
      .list()
      .map((entry) => entry.name)
      .sort()
  }

  it("copies each image whole under its content hash, with no part file left", async () => {
    const art = await stageWidgetArt(appWidgetArtPort())
    expect(staged()).toEqual(["lamp-lamphash.jpg", "pharisee-phariseehash.jpg"])
    expect(new File(`${FOLDER_URI}/pharisee-phariseehash.jpg`).size).toBe(1000)
    expect(art.pharisee).toBe(
      new File(`${FOLDER_URI}/pharisee-phariseehash.jpg`).uri,
    )
  })

  it("stages nothing where the app has no App Group", async () => {
    groups = {}
    expect(await stageWidgetArt(appWidgetArtPort())).toEqual({})
  })

  it("replaces a part file that a killed pass left, and never trusts it", async () => {
    new Directory(FOLDER_URI).create()
    new File(`${FOLDER_URI}/pharisee-phariseehash.jpg.part`).write(
      new Uint8Array(10),
    )
    await stageWidgetArt(appWidgetArtPort())
    expect(staged()).toEqual(["lamp-lamphash.jpg", "pharisee-phariseehash.jpg"])
    expect(new File(`${FOLDER_URI}/pharisee-phariseehash.jpg`).size).toBe(1000)
  })

  it("leaves no file under the final name when the copy fails", async () => {
    // A copy cut short leaves the bytes it wrote at its destination.
    jest
      .spyOn(File.prototype, "copy")
      .mockImplementationOnce(async (destination) => {
        ;(destination as File).write(new Uint8Array(10))
        throw new Error("killed")
      })
    const art = await stageWidgetArt(appWidgetArtPort())
    expect(art.pharisee).toBeUndefined()
    expect(staged()).toEqual(["lamp-lamphash.jpg"])
  })
})

// The widget extension reads only its App Group, which app.json names.
it("uses the App Group that the widget extension is given", () => {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../../../app.json"), "utf8"),
  ) as { expo: { plugins: unknown[] } }
  const widgets = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-widgets",
  ) as [string, { groupIdentifier: string }]
  expect(widgets[1].groupIdentifier).toBe(WIDGET_ART_APP_GROUP)
})
