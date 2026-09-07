import NextImage, { type ImageProps } from "next/image"
import { isStudioPlaybackUrl } from "@/lib/studio-playback"

/** Studio images must reach current Admin authorization on each request;
 * Next's persistent optimizer is intentionally bypassed for these resources. */
export default function MediaImage(props: ImageProps) {
  return (
    <NextImage
      {...props}
      unoptimized={isStudioPlaybackUrl(props.src) || props.unoptimized}
    />
  )
}
export type { ImageLoaderProps } from "next/image"
