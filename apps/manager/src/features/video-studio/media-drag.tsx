"use client"
import { createContext, useContext, useState, type ReactNode } from "react"
import type { MediaLocation } from "./library-insertion"

export type MediaDrag = {
  name: string
  kind: "video" | "audio" | "image" | "text"
  durationInFrames: number
  thumbnail?: string
  insert: (location: MediaLocation) => void | Promise<void>
}
const mediaType = "application/x-forge-studio-media"
const Context = createContext<{
  media: MediaDrag | null
  labels: Record<string, string>
  remember: (id: string, name: string) => void
  begin: (event: React.DragEvent<HTMLElement>, media: MediaDrag) => void
  clear: () => void
} | null>(null)

export function MediaDragProvider({ children }: { children: ReactNode }) {
  const [media, setMedia] = useState<MediaDrag | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  function begin(event: React.DragEvent<HTMLElement>, value: MediaDrag) {
    event.dataTransfer.effectAllowed = "copy"
    event.dataTransfer.setData(mediaType, "insert")
    // The native drag image uses the same clip component styles as the timeline.
    const ghost = document.createElement("div")
    ghost.className = "nle-media-ghost"
    const editor = event.currentTarget.closest(".nle-editor")
    const area = editor?.querySelector<HTMLElement>("[data-media-px]")
    const px = Number(area?.dataset.mediaPx) || 1
    ghost.style.width = `${Math.max(24, Math.min(800, value.durationInFrames * px))}px`
    const addClip = (audio: boolean) => {
      const clip = document.createElement("div")
      clip.className = `nle-clip nle-clip-${audio ? "audio" : value.kind}`
      if (!audio && value.thumbnail) {
        const strip = document.createElement("div")
        strip.className = "nle-filmstrip"
        for (let index = 0; index < 8; index++) {
          const image = document.createElement("img")
          image.src = value.thumbnail
          image.alt = ""
          strip.append(image)
        }
        clip.append(strip)
      }
      const name = document.createElement("span")
      name.className = "nle-clip-label"
      name.textContent =
        value.name + (audio && value.kind === "video" ? " · Linked audio" : "")
      clip.append(name)
      ghost.append(clip)
    }
    if (value.kind !== "audio") addClip(false)
    if (value.kind === "audio" || value.kind === "video") addClip(true)
    document.body.append(ghost)
    event.dataTransfer.setDragImage(ghost, 10, 10)
    setTimeout(() => ghost.remove(), 0)
    setMedia(value)
  }
  return (
    <Context.Provider
      value={{
        media,
        labels,
        remember: (id, name) =>
          setLabels((labels) => ({ ...labels, [id]: name })),
        begin,
        clear: () => setMedia(null),
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useMediaDrag() {
  return useContext(Context)
}

export function MediaDropClip({
  media,
  audio,
  left,
  width,
}: {
  media: MediaDrag
  audio?: boolean
  left: number
  width: number
}) {
  return (
    <div
      className={`nle-clip nle-clip-${audio ? "audio" : media.kind} nle-media-drop-clip`}
      style={{ left, width }}
      aria-hidden="true"
    >
      {!audio && media.thumbnail && (
        <div className="nle-filmstrip">
          {Array.from({ length: 8 }, (_, i) => (
            // Thumbnail URLs originate from the authenticated library presentation.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={media.thumbnail} alt="" draggable={false} />
          ))}
        </div>
      )}
      <span className="nle-clip-label">
        {media.name}
        {audio && media.kind === "video" ? " · Linked audio" : ""}
      </span>
    </div>
  )
}
