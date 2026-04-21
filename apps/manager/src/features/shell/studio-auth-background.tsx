"use client"

import Image from "next/image"
import { useState } from "react"
import { Blurhash } from "react-blurhash"
import { cn } from "@/lib/utils"
import type { StudioAuthBackgroundImage } from "@/features/shell/studio-auth-background-data"

function StudioAuthBackgroundTile({
  image,
  priority = false,
}: {
  image: StudioAuthBackgroundImage
  priority?: boolean
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500",
          loaded && "opacity-0",
        )}
        style={{ backgroundColor: image.color }}
      />
      {image.blurHash ? (
        <Blurhash
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-500",
            loaded && "opacity-0",
          )}
          hash={image.blurHash}
          height={32}
          punch={1}
          resolutionX={32}
          resolutionY={32}
          width={32}
        />
      ) : null}
      <Image
        alt=""
        fill
        priority={priority}
        sizes="100vw"
        src={image.src}
        className={cn(
          "object-cover transition-opacity duration-500",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

export function StudioAuthBackground({
  image,
}: {
  image: StudioAuthBackgroundImage
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <StudioAuthBackgroundTile image={image} priority />
    </div>
  )
}
