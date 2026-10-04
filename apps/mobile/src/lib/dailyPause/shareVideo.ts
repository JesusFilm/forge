// "Share this video" (R20, R42, KTD15). The share sheet gets a copy of the
// bundled video in the cache, under a name that the receiver can read. Later
// shares reuse the copy, and no step needs the network.
import { File, Paths } from "expo-file-system"
import { shareAsync } from "expo-sharing"

import type { Devotional } from "./devotionals"

/** Android's chooser reads the MIME type; iOS reads the UTI. */
const VIDEO_MIME_TYPE = "video/mp4"
const VIDEO_UTI = "public.mpeg-4"

function sharedVideoName(devotional: Devotional): string {
  return `Daily Bible Pause – ${devotional.name}.mp4`
}

/** Resolves when the sheet closes, for a share and a cancel alike. Rejects
 *  when the copy or the sheet fails. */
export async function shareDevotionalVideo(
  devotional: Devotional,
  videoUri: string,
): Promise<void> {
  const video = new File(videoUri)
  const copy = new File(Paths.cache, sharedVideoName(devotional))
  // An update can ship a new video, and a kill can cut a copy short.
  if (!copy.exists || copy.size !== video.size) {
    await video.copy(copy, { overwrite: true })
  }
  await shareAsync(copy.uri, { mimeType: VIDEO_MIME_TYPE, UTI: VIDEO_UTI })
}
