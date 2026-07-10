"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"

import { cn } from "@/lib/utils"

type MuxHoverPreviewProps = {
  previewUrl: string | null
  className?: string
  imageClassName?: string
  onPreviewLoadedChange?: (loaded: boolean) => void
  sizes: string
  testId?: string
}

export function MuxHoverPreview({
  previewUrl,
  className,
  imageClassName,
  onPreviewLoadedChange,
  sizes,
  testId = "mux-hover-preview",
}: MuxHoverPreviewProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [activated, setActivated] = useState(false)
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null)
  const loaded = previewUrl != null && loadedPreviewUrl === previewUrl

  useEffect(() => {
    onPreviewLoadedChange?.(loaded)
  }, [loaded, onPreviewLoadedChange])

  useEffect(() => {
    if (!previewUrl || activated) return
    const preview = ref.current
    const activationTarget = preview?.closest<HTMLElement>(
      "a, button, [tabindex], [data-testid='series-episode-card'], [data-testid='sibling-carousel-item']",
    )
    if (!activationTarget) return

    const activate = () => setActivated(true)
    activationTarget.addEventListener("focus", activate)
    activationTarget.addEventListener("pointerenter", activate)
    return () => {
      activationTarget.removeEventListener("focus", activate)
      activationTarget.removeEventListener("pointerenter", activate)
    }
  }, [activated, previewUrl])

  if (!previewUrl) return null

  return (
    <div
      ref={ref}
      data-testid={testId}
      data-active={activated ? "true" : "false"}
      data-loaded={loaded ? "true" : "false"}
      className={cn(
        "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100",
        className,
      )}
      onPointerEnter={() => setActivated(true)}
    >
      {activated ? (
        <Image
          src={previewUrl}
          alt=""
          fill
          sizes={sizes}
          unoptimized
          aria-hidden="true"
          className={cn(
            "object-cover opacity-0 transition-opacity duration-300",
            loaded && "opacity-100",
            imageClassName,
          )}
          onLoad={() => setLoadedPreviewUrl(previewUrl)}
        />
      ) : null}
    </div>
  )
}
