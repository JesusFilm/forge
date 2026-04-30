"use client"

import { useId, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isAllowedDownloadOrigin } from "@/lib/download-allowlist"

export type DownloadModalDownload = {
  documentId: string
  quality: string
  size: number | null
  url: string
}

export type DownloadModalProps = {
  open: boolean
  downloads: DownloadModalDownload[]
  onClose: () => void
}

// Highest-fidelity first; unknown qualities sort to the end.
const QUALITY_PRIORITY = [
  "uhd",
  "qhd",
  "fhd",
  "highest",
  "high",
  "distroHigh",
  "sd",
  "distroSd",
  "low",
  "distroLow",
] as const

// "ministry" qualifier replaces "distribution" — JFP preferred string.
const QUALITY_LABELS: Record<string, string> = {
  uhd: "4K",
  qhd: "2K",
  fhd: "1080p HD",
  highest: "Best",
  high: "720p",
  distroHigh: "720p (ministry)",
  sd: "480p",
  distroSd: "480p (ministry)",
  low: "240p",
  distroLow: "240p (ministry)",
}

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function displayLabel(quality: string): string {
  return QUALITY_LABELS[quality] ?? quality
}

function sortByQuality(
  downloads: DownloadModalDownload[],
): DownloadModalDownload[] {
  const priority = new Map<string, number>(
    QUALITY_PRIORITY.map((q, i) => [q, i]),
  )
  const tail = QUALITY_PRIORITY.length
  return [...downloads].sort((a, b) => {
    const ai = priority.get(a.quality) ?? tail
    const bi = priority.get(b.quality) ?? tail
    return ai - bi
  })
}

export function DownloadModal({
  open,
  downloads,
  onClose,
}: DownloadModalProps) {
  const [tosAgreed, setTosAgreed] = useState(false)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const groupName = useId()

  const sorted = useMemo(() => sortByQuality(downloads), [downloads])

  const selected =
    sorted.find((d) => d.documentId === selectedDocumentId) ?? null
  const canDownload = tosAgreed && selected != null

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTosAgreed(false)
      setSelectedDocumentId(null)
      setError(null)
      onClose()
    }
  }

  function handleDownload() {
    if (!selected) return
    if (!isAllowedDownloadOrigin(selected.url)) {
      console.error(
        "[DownloadModal] Refusing to download from non-allowlisted origin",
        { url: selected.url },
      )
      setError("Download unavailable from this source")
      return
    }
    setError(null)
    // target="_blank" preserves the watch page if cross-origin downloads
    // navigate instead of attaching.
    const a = document.createElement("a")
    a.href = selected.url
    a.download = ""
    a.target = "_blank"
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="watch-download-modal" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Download</DialogTitle>
          <DialogDescription>
            Choose a quality and accept the Terms of Use to download this video.
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 ? (
          <p
            data-testid="watch-download-modal-empty"
            className="text-sm text-muted-foreground"
          >
            No downloads are available for this video.
          </p>
        ) : (
          <fieldset
            data-testid="watch-download-modal-options"
            className="flex flex-col gap-2"
          >
            <legend className="sr-only">Download quality</legend>
            {sorted.map((d) => {
              const size = formatSize(d.size)
              const checked = selectedDocumentId === d.documentId
              return (
                <label
                  key={d.documentId}
                  data-testid="watch-download-modal-option"
                  data-quality={d.quality}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 transition hover:bg-stone-700"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={groupName}
                      value={d.documentId}
                      checked={checked}
                      onChange={() => setSelectedDocumentId(d.documentId)}
                      data-testid="watch-download-modal-radio"
                    />
                    <span>{displayLabel(d.quality)}</span>
                  </span>
                  {size ? (
                    <span
                      data-testid="watch-download-modal-size"
                      className="text-stone-400"
                    >
                      {size}
                    </span>
                  ) : null}
                </label>
              )
            })}
          </fieldset>
        )}

        <div className="flex flex-col gap-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Downloaded videos are licensed for non-commercial use in ministry,
            education, and personal viewing. Redistribution for profit or
            modification of the work is not permitted.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={tosAgreed}
              onChange={(e) => setTosAgreed(e.target.checked)}
              data-testid="watch-download-modal-tos"
            />
            <span>I agree to the Terms of Use</span>
          </label>
        </div>

        {error ? (
          <p
            data-testid="watch-download-modal-error"
            role="alert"
            className="text-sm text-red-400"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            data-testid="watch-download-modal-cancel"
            className="rounded-md border border-stone-700 bg-transparent px-4 py-2 text-sm font-semibold text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload}
            data-testid="watch-download-modal-confirm"
            className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-900 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
