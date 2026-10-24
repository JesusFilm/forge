"use client"

import { useState } from "react"
import { Upload, X } from "lucide-react"
import {
  MAX_MEDIA_UPLOAD_BYTES,
  mediaUploadTooLargeMessage,
} from "@/app/dashboard/media/media-upload-limits"

export type UploadActionResult = {
  ok: boolean
  error?:
    | "forbidden"
    | "missing-file"
    | "too-large"
    | "unsupported-file"
    | "unknown"
}

export function MediaActions({
  canUpload,
  uploadAction,
  selectedFolderId,
  selectedFolderLabel,
}: {
  canUpload: boolean
  uploadAction: (formData: FormData) => Promise<UploadActionResult>
  selectedFolderId: string | null
  selectedFolderLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canUpload) {
            setError("")
            setOpen(true)
            return
          }
          setError("Your account cannot upload media assets.")
        }}
        className="inline-flex h-8 items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
      >
        <Upload className="h-4 w-4" strokeWidth={1.5} />
        Upload
      </button>
      {error ? (
        <p className="text-[12px] text-[var(--color-danger)]">{error}</p>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-lg rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <div className="hairline-strong-b flex items-center justify-between px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold">
                  Upload media asset
                </h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                  Images, PDFs, files, and local video placeholders are stored
                  through the media backend.
                </p>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                  Destination: {selectedFolderLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-sm border border-[var(--color-hairline)] p-1.5 text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                aria-label="Close upload dialog"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <form
              action={async (formData) => {
                setError("")
                const file = formData.get("file")
                if (
                  file instanceof File &&
                  file.size > MAX_MEDIA_UPLOAD_BYTES
                ) {
                  setError(mediaUploadTooLargeMessage(file.name))
                  return
                }
                const result = await uploadAction(formData)
                if (result.ok) {
                  setOpen(false)
                  return
                }

                setError(
                  result.error === "forbidden"
                    ? "Your account cannot upload media assets."
                    : result.error === "missing-file"
                      ? "Choose a file before uploading."
                      : result.error === "too-large"
                        ? mediaUploadTooLargeMessage()
                        : result.error === "unsupported-file"
                          ? "Choose an image file before uploading."
                          : "Upload failed. Check the file and try again.",
                )
              }}
              className="grid gap-4 p-4"
            >
              {selectedFolderId ? (
                <input type="hidden" name="folderId" value={selectedFolderId} />
              ) : null}
              <label className="grid gap-1.5">
                <span className="label-text">File</span>
                <input
                  type="file"
                  name="file"
                  required
                  className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 py-2 text-[13px] outline-none file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--color-surface-raised)] file:px-3 file:py-1.5 file:text-[12px] file:text-[var(--color-text-primary)]"
                />
              </label>
              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex h-8 items-center rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
                >
                  Upload asset
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
