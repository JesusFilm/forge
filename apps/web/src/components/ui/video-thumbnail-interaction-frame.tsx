import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

export const VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS = "focus-visible:outline-none"

type VideoThumbnailInteractionFrameProps = ComponentPropsWithoutRef<"span"> & {
  interactive?: boolean
  visible?: boolean
}

export function VideoThumbnailInteractionFrame({
  className,
  interactive = true,
  visible = false,
  ...props
}: VideoThumbnailInteractionFrameProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-[80] rounded-[inherit] border-4 border-white opacity-0 transition-opacity duration-200",
        interactive &&
          "group-hover:opacity-100 group-focus-visible:opacity-100",
        visible && "opacity-100",
        className,
      )}
    />
  )
}
