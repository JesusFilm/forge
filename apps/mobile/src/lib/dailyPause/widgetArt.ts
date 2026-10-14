// Puts each devotional's widget background where the iOS widget can read it.
// The extension reads files only from the App Group it shares with the app.
import { Asset } from "expo-asset"
import { Directory, File, Paths } from "expo-file-system"

import { withTimeout } from "../withTimeout"
import { DEVOTIONALS, type DevotionalId } from "./devotionals"

/** app.json's `expo-widgets` `groupIdentifier`; a test holds them equal. */
export const WIDGET_ART_APP_GROUP = "group.org.jesusfilm.forgewatch"
const FOLDER = "daily-pause-widget"
/** A bundled image that has not resolved by now is left out for this pass. */
const RESOLVE_DEADLINE_MS = 5_000

/** A file the widget can read, per devotional. A day with none draws the
 *  widget's plain ground. */
export type WidgetArt = Partial<Record<DevotionalId, string>>

export type WidgetArtFolder = {
  uri: (name: string) => string
  names: () => string[]
  /** Leaves the whole file under `name`, or no file under it. */
  copyIn: (from: string, name: string) => Promise<void>
  remove: (name: string) => void
}

export type WidgetArtPort = {
  /** The bundled image on disk, with a hash of its content. */
  resolve: (id: DevotionalId) => Promise<{ uri: string; hash: string } | null>
  /** The shared folder, or null where the app has no App Group. */
  folder: () => WidgetArtFolder | null
}

/** The devotional of a staged name, `<id>-<hash>.jpg`, or null. */
function stagedId(name: string): string | null {
  return /^(.+)-[^-]+\.jpg$/.exec(name)?.[1] ?? null
}

/** Never rejects. Each image goes in under its content hash, so a changed
 *  image is a new file and never hides behind an old copy. */
export async function stageWidgetArt(port: WidgetArtPort): Promise<WidgetArt> {
  let folder: WidgetArtFolder | null = null
  try {
    folder = port.folder()
  } catch {
    folder = null
  }
  if (!folder) return {}

  const art: WidgetArt = {}
  const keep = new Set<string>()
  for (const id of Object.keys(DEVOTIONALS) as DevotionalId[]) {
    try {
      const source = await port.resolve(id)
      if (source) {
        const name = `${id}-${source.hash}.jpg`
        if (!folder.names().includes(name)) {
          await folder.copyIn(source.uri, name)
        }
        keep.add(name)
        art[id] = folder.uri(name)
        continue
      }
    } catch {
      // The last good copy serves, below.
    }
    // A pass that cannot stage the art keeps an earlier pass's copy. With
    // none, that devotional's days draw the plain ground.
    try {
      const earlier = folder.names().find((name) => stagedId(name) === id)
      if (earlier) {
        keep.add(earlier)
        art[id] = folder.uri(earlier)
      }
    } catch {
      // The plain ground.
    }
  }
  try {
    for (const name of folder.names()) {
      if (!keep.has(name)) folder.remove(name)
    }
  } catch {
    // An old copy left behind costs only its bytes.
  }
  return art
}

/** The app's own port: bundled assets and the App Group container. */
export function appWidgetArtPort(): WidgetArtPort {
  return {
    resolve: async (id) => {
      const asset = Asset.fromModule(DEVOTIONALS[id].widgetArt)
      await withTimeout(asset.downloadAsync(), RESOLVE_DEADLINE_MS)
      return asset.localUri && asset.hash
        ? { uri: asset.localUri, hash: asset.hash }
        : null
    },
    folder: () => {
      const group = Paths.appleSharedContainers?.[WIDGET_ART_APP_GROUP]
      if (!group) return null
      const dir = new Directory(group, FOLDER)
      if (!dir.exists) dir.create({ intermediates: true })
      return {
        uri: (name) => new File(dir, name).uri,
        names: () =>
          dir
            .list()
            .filter((entry): entry is File => entry instanceof File)
            .map((file) => file.name),
        // A copy is not atomic, and a later pass trusts the final name. So
        // the copy goes to a part file, and a rename in one folder is atomic.
        copyIn: async (from, name) => {
          const part = new File(dir, `${name}.part`)
          if (part.exists) part.delete()
          await new File(from).copy(part)
          part.rename(name)
        },
        remove: (name) => new File(dir, name).delete(),
      }
    },
  }
}
