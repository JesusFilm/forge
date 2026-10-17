import {
  watchAudienceFrame,
  type WatchAudienceResolution,
} from "@/lib/watch-audience-config"
import { WatchNextSteps, type WatchNextStepsProps } from "./WatchNextSteps"

export type WatchAudienceBlockProps = Omit<WatchNextStepsProps, "config"> & {
  /** The published configuration both Watch surfaces share. */
  audience?: WatchAudienceResolution
}

/**
 * The one audience frame for home and video, fed by the published
 * configuration. A rejected or unavailable authored configuration renders
 * nothing (never the baked-in questions); the key ties the frame to its
 * configuration so a changed definition remounts it and drops stale answers.
 */
export function WatchAudienceBlock({
  audience,
  ...props
}: WatchAudienceBlockProps) {
  const frame = watchAudienceFrame(audience)
  if (!frame) return null
  return (
    <WatchNextSteps key={frame.identity} config={frame.config} {...props} />
  )
}
