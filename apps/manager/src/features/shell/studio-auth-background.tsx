"use client"

import Image from "next/image"
import { useState, type CSSProperties } from "react"
import { Blurhash } from "react-blurhash"
import type { StudioAuthBackgroundImage } from "@/features/shell/studio-auth-background-data"

function StudioAuthBackgroundTile({
  className,
  image,
  priority = false,
  sizes,
}: {
  className: string
  image: StudioAuthBackgroundImage
  priority?: boolean
  sizes: string
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div
      aria-hidden="true"
      className={`${className}${loaded ? " is-loaded" : ""}`}
      style={{ "--studio-auth-image-color": image.color } as CSSProperties}
    >
      <div className="studio-auth-background-tile-color" />
      {image.blurHash ? (
        <Blurhash
          className="studio-auth-background-tile-blurhash"
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
        className="studio-auth-background-tile-image"
        fill
        priority={priority}
        sizes={sizes}
        src={image.src}
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
    <div
      aria-hidden="true"
      className="studio-auth-background"
      style={
        {
          "--studio-auth-primary-color": image.color,
        } as CSSProperties
      }
    >
      <StudioAuthBackgroundTile
        className="studio-auth-background-tile studio-auth-background-tile--primary"
        image={image}
        priority
        sizes="100vw"
      />
    </div>
  )
}
