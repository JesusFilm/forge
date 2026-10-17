import {
  WatchAudienceBlock,
  type WatchAudienceBlockProps,
} from "@/components/watch/WatchAudienceBlock"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { watchAudienceFrame } from "@/lib/watch-audience-config"

/**
 * Home uses the same questions, role preference and action resolution as
 * video, from the same published configuration. A rejected or unavailable
 * authored configuration omits the band, container included.
 */
export function WatchHomeRoleBand(props: WatchAudienceBlockProps) {
  if (!watchAudienceFrame(props.audience)) return null
  return (
    <div
      data-testid="watch-home-role-band"
      className={WATCH_PAGE_CONTENT_CLASSES}
    >
      <WatchAudienceBlock {...props} />
    </div>
  )
}
