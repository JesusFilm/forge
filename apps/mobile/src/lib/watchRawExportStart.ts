import type { WatchDownload, WatchSubtitle } from "./normalizeVideo"
import { RAW_EXPORT_ENABLED } from "./rawExportConstants"
import type { RawExportInput } from "./rawExportAdapter"
import { sizeBytesOf } from "./rawExportRun"
import type { RawExportStartOutcome } from "./rawExportStart"

/**
 * The per-video sheet's raw branch, minus the native seam. The route owns the
 * adapter, the router and the ref; this module owns the two decisions that
 * decide whether an export happens at all, so both are unit-tested.
 */

/** Everything the route knows before the viewer picks a folder. */
export type WatchRawExportRequest = Omit<RawExportInput, "folder">

export type WatchRawExportRequestInput = {
  videoSlug: string
  title: string | null
  rendition: WatchDownload
  wifiOnly: boolean
  /** The track raw mode hides, inherited from the watch session. */
  subtitle: WatchSubtitle | null
  /** The run id's timestamp, injected so a test can pin the whole payload. */
  startedAt: number
}

/**
 * The export request, or null when this sheet must start nothing: R33's switch
 * is off, or the rendition names no URL. Both refusals happen BEFORE the
 * picker, because a folder prompt the app cannot act on is a lie.
 */
export function buildWatchRawExportRequest(
  input: WatchRawExportRequestInput,
): WatchRawExportRequest | null {
  if (!RAW_EXPORT_ENABLED || !input.rendition.url) return null
  return {
    videoSlug: input.videoSlug,
    runId: `${input.videoSlug}:${input.startedAt}`,
    title: input.title,
    rendition: {
      documentId: input.rendition.documentId,
      qualityLabel: input.rendition.quality,
      url: input.rendition.url,
      sizeBytes: sizeBytesOf(input.rendition.size),
    },
    wifiOnly: input.wifiOnly,
    // R23: the core receives the hidden track so it can PROVE the track changes
    // neither the transferred file nor the computed size.
    subtitleHiddenByRawMode: input.subtitle
      ? {
          languageSlug: input.subtitle.languageSlug,
          url: input.subtitle.vttSrc,
        }
      : null,
  }
}

/** The route's in-flight latch. A `useRef<boolean>` satisfies it. */
export type WatchRawExportLatch = { current: boolean }

export type WatchRawExportOutcome =
  | RawExportStartOutcome
  | "unavailable"
  | "busy"

/**
 * Run the pick-then-dismiss-then-start sequence at most once at a time.
 *
 * The confirm button stays enabled while the picker is open, so two taps opened
 * two pickers: two grants popped the stack twice, and the second export hit the
 * session mutex and reported nothing. The latch is what one tap holds.
 *
 * A started run KEEPS the latch, because the sheet dismisses over a few hundred
 * milliseconds and the button is live for all of them. Every other exit
 * releases it, so a viewer who dismisses the picker can confirm again, and a
 * throw cannot wedge the sheet.
 */
export async function startWatchRawExport(
  latch: WatchRawExportLatch,
  request: WatchRawExportRequest | null,
  run: (request: WatchRawExportRequest) => Promise<RawExportStartOutcome>,
): Promise<WatchRawExportOutcome> {
  if (!request) return "unavailable"
  if (latch.current) return "busy"
  latch.current = true
  let started = false
  try {
    const outcome = await run(request)
    started = outcome === "started"
    return outcome
  } finally {
    if (!started) latch.current = false
  }
}
