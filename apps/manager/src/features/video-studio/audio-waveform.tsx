"use client"
import { memo, useEffect, useRef, useState } from "react"
import type { StudioDocument } from "@forge/studio-contracts"
import { waveformKey, waveformPath, type AudioItem } from "./waveform-data"
export const AudioWaveform = memo(function AudioWaveform({
  item,
  document: doc,
  projectId,
}: {
  item: AudioItem
  document: StudioDocument
  projectId?: string
}) {
  const element = useRef<HTMLDivElement>(null)
  const latest = useRef({ doc, item })
  useEffect(() => {
    latest.current = { doc, item }
  }, [doc, item])
  const [visible, setVisible] = useState(false)
  const [result, setResult] = useState<{
    key: string
    peaks?: number[]
    error?: string
  } | null>(null)
  const key = waveformKey(item, doc.fps)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      {
        root: element.current?.closest(".nle-timeline-scroll"),
        rootMargin: "100px",
      },
    )
    observer.observe(element.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || !projectId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = () => {
      timer = setTimeout(() => {
        const current = latest.current
        void fetch("/api/shorts/waveform", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            document: current.doc,
            itemId: current.item.id,
          }),
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("Waveform unavailable")
            const value = (await response.json()) as { peaks?: unknown }
            if (
              !Array.isArray(value.peaks) ||
              value.peaks.length !== 256 ||
              !value.peaks.every(
                (p) =>
                  typeof p === "number" &&
                  Number.isFinite(p) &&
                  p >= 0 &&
                  p <= 1,
              )
            )
              throw new Error("Waveform unavailable")
            if (!controller.signal.aborted)
              setResult({ key, peaks: value.peaks })
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setResult({ key, error: "Waveform unavailable" })
          })
      }, 200)
    }
    if (window.document.readyState === "complete") load()
    else window.addEventListener("load", load, { once: true })
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener("load", load)
    }
  }, [key, visible, projectId])
  const current = result?.key === key ? result : null
  return (
    <div
      ref={element}
      className="nle-waveform"
      data-muted={item.volume === 0 || undefined}
    >
      {current?.peaks ? (
        <svg
          viewBox="0 0 256 32"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            item.volume === 0 ? "Audio waveform (muted)" : "Audio waveform"
          }
        >
          <path
            d={waveformPath(current.peaks, item.volume)}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.75"
          />
        </svg>
      ) : (
        <span>{current?.error ?? "Loading waveform…"}</span>
      )}
    </div>
  )
})
