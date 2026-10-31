"use client"
import { useEffect, useRef, useState } from "react"
import type { StudioAssetReference } from "@forge/studio-contracts"

let active = 0
const queue: (() => void)[] = []
async function imageRequest(
  signal: AbortSignal,
  reference: StudioAssetReference,
) {
  if (active >= 2) await new Promise<void>((resolve) => queue.push(resolve))
  else active++
  try {
    signal.throwIfAborted()
    const response = await fetch("/api/shorts/library-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reference),
      signal,
    })
    if (!response.ok) throw new Error("Thumbnail unavailable")
    const durationMs = Number(response.headers.get("x-studio-duration-ms"))
    return { blob: await response.blob(), durationMs }
  } finally {
    const next = queue.shift()
    if (next) next()
    else active--
  }
}

/** Fetch only visible retained thumbnails, two at a time; release blobs on tab exit. */
export function LibraryImage({
  reference,
  active,
  onDuration,
}: {
  reference: StudioAssetReference
  active: boolean
  onDuration?: (durationMs: number) => void
}) {
  const durationHandler = useRef(onDuration)
  useEffect(() => {
    durationHandler.current = onDuration
  }, [onDuration])
  const host = useRef<HTMLSpanElement>(null)
  const [url, setUrl] = useState<string>()
  const { assetId, versionId, digest } = reference
  useEffect(() => {
    if (!active || !host.current) return
    const controller = new AbortController()
    let local: string | undefined
    let started = false
    const load = () => {
      if (started) return
      started = true
      void imageRequest(controller.signal, { assetId, versionId, digest })
        .then(({ blob, durationMs }) => {
          if (controller.signal.aborted) return
          if (Number.isFinite(durationMs) && durationMs > 0)
            durationHandler.current?.(durationMs)
          local = URL.createObjectURL(blob)
          setUrl(local)
        })
        .catch(() => {})
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        load()
      }
    })
    observer.observe(host.current)
    return () => {
      controller.abort()
      observer.disconnect()
      if (local) URL.revokeObjectURL(local)
      setUrl(undefined)
    }
  }, [active, assetId, versionId, digest])
  return (
    <span ref={host} className="nle-library-image">
      {url && (
        // Retained bytes are authorized by the image endpoint, not a public URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          draggable={false}
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
    </span>
  )
}
