import {
  WatchNextSteps,
  type WatchNextStepsProps,
} from "@/components/watch/WatchNextSteps"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

/** Home uses the same questions, role preference and action resolution as video. */
export function WatchHomeRoleBand(props: WatchNextStepsProps) {
  return (
    <div
      data-testid="watch-home-role-band"
      className={WATCH_PAGE_CONTENT_CLASSES}
    >
      <WatchNextSteps {...props} />
    </div>
  )
}
