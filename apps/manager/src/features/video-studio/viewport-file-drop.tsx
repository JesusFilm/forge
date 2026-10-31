"use client"
import { useEffect, useState } from "react"
import { Upload } from "lucide-react"

/** Capture external files before a timeline or page link can consume the drop. */
export function ViewportFileDrop({
  enabled,
  onFiles,
}: {
  enabled: boolean
  onFiles: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const files = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files")
    const reset = () => {
      depth = 0
      setOver(false)
    }
    const enter = (event: DragEvent) => {
      if (!files(event)) return
      event.preventDefault()
      depth++
      setOver(enabled)
    }
    const move = (event: DragEvent) => {
      if (!files(event)) return
      event.preventDefault()
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = enabled ? "copy" : "none"
      setOver(enabled)
    }
    const leave = (event: DragEvent) => {
      if (!files(event)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const drop = (event: DragEvent) => {
      if (!files(event)) return
      event.preventDefault()
      event.stopPropagation()
      reset()
      const dropped = Array.from(event.dataTransfer?.files ?? [])
      if (enabled && dropped.length) onFiles(dropped)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset()
    }
    window.addEventListener("dragenter", enter, true)
    window.addEventListener("dragover", move, true)
    window.addEventListener("dragleave", leave, true)
    window.addEventListener("drop", drop, true)
    window.addEventListener("dragend", reset, true)
    window.addEventListener("blur", reset)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("dragenter", enter, true)
      window.removeEventListener("dragover", move, true)
      window.removeEventListener("dragleave", leave, true)
      window.removeEventListener("drop", drop, true)
      window.removeEventListener("dragend", reset, true)
      window.removeEventListener("blur", reset)
      window.removeEventListener("keydown", key)
    }
  }, [enabled, onFiles])
  if (!over || !enabled) return null
  return (
    <div className="nle-viewport-file-drop" role="status">
      <div className="nle-viewport-file-drop-panel">
        <Upload size={40} />
        <strong>Drop to upload</strong>
        <span>Images, videos and audio</span>
      </div>
    </div>
  )
}
