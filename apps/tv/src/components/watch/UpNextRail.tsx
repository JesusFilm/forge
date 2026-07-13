// Up Next rail — siblings under the same parent; a card opens THAT video's details
// (R15), it does NOT play; renders nothing without siblings. Rail scaffold + card
// come from the shared rails/ modules.

import { useCallback } from "react"
import { useRouter } from "expo-router"

import type { WatchSibling } from "../../lib/normalizeVideo"
import { ThumbCard } from "../rails/ThumbCard"
import { ThumbRail } from "../rails/ThumbRail"

const keyExtractor = (item: WatchSibling) => `upnext-${item.documentId}`

export function UpNextRail({ siblings }: { siblings: WatchSibling[] }) {
  const router = useRouter()

  const renderCard = useCallback(
    (sibling: WatchSibling) => (
      // The mockup's accent eyebrow is a meaningful per-episode label ("Day 1");
      // JFP siblings only carry the content-type label (e.g. "SERIES"), which
      // would repeat identically on every card — so no eyebrow, just the title.
      <ThumbCard
        title={sibling.title ?? sibling.slug}
        posterUrl={sibling.posterUrl}
        previewPlaybackId={sibling.muxPlaybackId}
        recyclingKey={`upnext-${sibling.documentId}`}
        ddActionName="upnext-episode"
        accessibilityHint="Opens this video"
        onPress={() =>
          router.push(`/watch/${encodeURIComponent(sibling.slug)}`)
        }
      />
    ),
    [router],
  )

  return (
    <ThumbRail
      heading="Up Next"
      countLabel={`${siblings.length} videos`}
      data={siblings}
      keyExtractor={keyExtractor}
      renderCard={renderCard}
    />
  )
}
