"use client"

import type { ReactNode } from "react"
import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { cx } from "@/components/admin-ui"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import type { UploadActionResult } from "@/app/dashboard/media/media-actions"
import {
  MAX_MEDIA_UPLOAD_BYTES,
  mediaUploadTooLargeMessage,
} from "@/app/dashboard/media/media-upload-limits"

type MediaAssetDropTargetProps = {
  canUpload: boolean
  uploadAction: (formData: FormData) => Promise<UploadActionResult>
  selectedFolderId: string | null
  selectedFolderLabel: string
  acceptedMimePrefix?: string
  children: ReactNode
}

function hasFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false
  }

  return Array.from(dataTransfer.types).includes("Files")
}

export function MediaAssetDropTarget({
  canUpload,
  uploadAction,
  selectedFolderId,
  selectedFolderLabel,
  acceptedMimePrefix,
  children,
}: MediaAssetDropTargetProps) {
  const router = useRouter()
  const dragDepthRef = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const { toasts, pushToast, dismissToast } = useToastStack()

  function resetDragState() {
    dragDepthRef.current = 0
    setDragActive(false)
  }

  async function handleDrop(files: File[]) {
    if (!canUpload) {
      pushToast("Your account cannot upload media assets.", "error")
      return
    }

    const validFiles = files.filter(
      (file) =>
        file.size > 0 &&
        (!acceptedMimePrefix || file.type.startsWith(acceptedMimePrefix)),
    )
    if (validFiles.length === 0) {
      pushToast(
        acceptedMimePrefix === "image/"
          ? "Choose at least one image file to upload."
          : "Choose at least one file to upload.",
        "error",
      )
      return
    }
    const tooLargeFiles = validFiles.filter(
      (file) => file.size > MAX_MEDIA_UPLOAD_BYTES,
    )
    if (tooLargeFiles.length > 0) {
      pushToast(mediaUploadTooLargeMessage(tooLargeFiles[0]?.name), "error")
      return
    }

    setUploadingCount(validFiles.length)

    let successCount = 0
    let forbidden = false
    let failed = false

    for (const file of validFiles) {
      const formData = new FormData()
      formData.set("file", file)
      if (selectedFolderId) {
        formData.set("folderId", selectedFolderId)
      }

      const result = await uploadAction(formData)
      if (result.ok) {
        successCount += 1
        continue
      }

      if (result.error === "forbidden") {
        forbidden = true
      } else if (result.error === "too-large") {
        pushToast(mediaUploadTooLargeMessage(file.name), "error")
      } else {
        failed = true
      }
    }

    setUploadingCount(0)

    if (successCount > 0) {
      router.refresh()
      pushToast(
        successCount === 1
          ? `Uploaded 1 file to ${selectedFolderLabel}.`
          : `Uploaded ${successCount} files to ${selectedFolderLabel}.`,
        "success",
      )
    }

    if (forbidden) {
      pushToast("Your account cannot upload media assets.", "error")
    } else if (failed) {
      pushToast(
        acceptedMimePrefix === "image/"
          ? "Some images could not be uploaded. Try again."
          : "Some files could not be uploaded. Try again.",
        "error",
      )
    }
  }

  return (
    <div
      onDragEnter={(event) => {
        if (!hasFiles(event.dataTransfer)) {
          return
        }

        event.preventDefault()
        dragDepthRef.current += 1
        setDragActive(true)
      }}
      onDragOver={(event) => {
        if (!hasFiles(event.dataTransfer)) {
          return
        }

        event.preventDefault()
        event.dataTransfer.dropEffect = canUpload ? "copy" : "none"
        if (!dragActive) {
          setDragActive(true)
        }
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event.dataTransfer)) {
          return
        }

        event.preventDefault()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) {
          setDragActive(false)
        }
      }}
      onDrop={(event) => {
        if (!hasFiles(event.dataTransfer)) {
          return
        }

        event.preventDefault()
        const files = Array.from(event.dataTransfer.files)
        resetDragState()
        void handleDrop(files)
      }}
      className="relative min-h-0 flex-1"
    >
      <div className="min-h-full">{children}</div>

      {(dragActive || uploadingCount > 0) && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-sm">
          <div
            className={cx(
              "absolute inset-0 rounded-sm border border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_8%,transparent)] shadow-[inset_0_0_0_1px_var(--color-brand)] transition-all duration-[120ms] ease-out",
              uploadingCount > 0 &&
                "bg-[color-mix(in_srgb,var(--color-brand)_12%,transparent)]",
            )}
          />
          <div className="absolute inset-4 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-sm border border-[var(--color-hairline)] bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] px-4 py-3 text-[13px] text-[var(--color-text-primary)] shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
              <Upload
                className={cx("h-4 w-4", uploadingCount > 0 && "animate-pulse")}
                strokeWidth={1.5}
              />
              <span>
                {uploadingCount > 0
                  ? uploadingCount === 1
                    ? `Uploading 1 file to ${selectedFolderLabel}...`
                    : `Uploading ${uploadingCount} files to ${selectedFolderLabel}...`
                  : `Drop files to upload to ${selectedFolderLabel}`}
              </span>
            </div>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
