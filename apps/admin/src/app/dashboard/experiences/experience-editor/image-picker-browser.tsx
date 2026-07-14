"use client"

import { ImageIcon, Search, UploadCloud, X } from "lucide-react"
import { useState } from "react"
import { cx } from "@/components/admin-ui"
import type {
  MediaLibraryBrowserData,
  MediaLibraryBrowserImage,
} from "@/app/dashboard/media/media-library-browser-data"
import { MediaAssetDropTarget } from "@/app/dashboard/media/media-asset-drop-target"
import type { UploadActionResult } from "@/app/dashboard/media/media-actions"
import { ImagePickerFolderBrowser } from "./image-picker-folder-browser"

type ImagePickerBrowserProps = {
  open: boolean
  mediaLibrary: MediaLibraryBrowserData
  query: string
  selectedFolderId: string | null
  selectedAssetId: string | null
  canClearImage: boolean
  canUpload: boolean
  uploadAction: (formData: FormData) => Promise<UploadActionResult>
  onQueryChange: (query: string) => void
  onSelectFolder: (folderId: string | null) => void
  onSelectImage: (asset: MediaLibraryBrowserImage) => void
  onClearImage: () => void
  onClose: () => void
}

export function ImagePickerBrowser({
  open,
  mediaLibrary,
  query,
  selectedFolderId,
  selectedAssetId,
  canClearImage,
  canUpload,
  uploadAction,
  onQueryChange,
  onSelectFolder,
  onSelectImage,
  onClearImage,
  onClose,
}: ImagePickerBrowserProps) {
  const [draftSelectedAssetId, setDraftSelectedAssetId] = useState<
    string | null
  >(selectedAssetId)
  const normalizedQuery = query.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0
  const rootImageCount = mediaLibrary.images.filter(
    (asset) => asset.folderId === null,
  ).length
  const selectedFolder = selectedFolderId
    ? mediaLibrary.folders.find((folder) => folder.id === selectedFolderId)
    : null
  const selectedFolderLabel =
    selectedFolder?.pathLabel ?? mediaLibrary.rootLabel
  const visibleImages = mediaLibrary.images.filter((asset) => {
    if (isSearching) {
      const haystack =
        `${asset.displayName} ${asset.altText ?? ""} ${asset.mimeType} ${asset.id} ${asset.pathLabel}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    }

    return asset.folderId === selectedFolderId
  })
  const emptyState = imagePickerEmptyState({
    isSearching,
    hasImages: mediaLibrary.images.length > 0,
    selectedFolderLabel,
    canUpload,
  })
  const draftSelectedAsset =
    mediaLibrary.images.find((asset) => asset.id === draftSelectedAssetId) ??
    null

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-center justify-center px-4 transition-all duration-180 ease-out sm:px-6",
        open
          ? "pointer-events-auto bg-[rgba(4,6,10,0.78)] backdrop-blur-[8px]"
          : "pointer-events-none bg-[rgba(4,6,10,0)] backdrop-blur-0",
      )}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        onClose()
      }}
      role="presentation"
      aria-hidden={!open}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-library-title"
        className={cx(
          "flex h-[min(84dvh,800px)] max-h-[calc(100dvh-2rem)] w-[min(1040px,calc(100vw-2rem))] flex-col overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] shadow-[0_32px_120px_rgba(0,0,0,0.58)] transition-[opacity,transform] duration-180 ease-out",
          open
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-[0.98] opacity-0",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] p-5">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              Media Library
            </div>
            <h2
              id="image-library-title"
              className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
            >
              Choose an image
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
            aria-label="Close image library"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <ImagePickerFolderBrowser
            rootLabel={mediaLibrary.rootLabel}
            rootImageCount={rootImageCount}
            folders={mediaLibrary.folders}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
          />

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="grid gap-3 border-b border-[var(--color-hairline)] p-4">
              <label className="grid gap-1.5">
                <span className="label-text">Search</span>
                <div className="flex h-10 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
                  <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
                  <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    className="w-full border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                    placeholder="Search all image assets"
                  />
                </div>
              </label>
              <div className="flex h-5 items-center text-[12px] text-[var(--color-text-muted)]">
                {isSearching
                  ? `Searching all folders for "${query.trim()}"`
                  : (selectedFolder?.pathLabel ?? mediaLibrary.rootLabel)}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <MediaAssetDropTarget
                canUpload={canUpload}
                uploadAction={uploadAction}
                selectedFolderId={selectedFolderId}
                selectedFolderLabel={selectedFolderLabel}
                acceptedMimePrefix="image/"
                contentClassName="h-full min-h-0"
              >
                <div className="h-full overflow-x-hidden overflow-y-auto [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
                  {visibleImages.length === 0 ? (
                    <ImagePickerEmptyState
                      title={emptyState.title}
                      description={emptyState.description}
                    />
                  ) : (
                    <div className="grid gap-3 p-4 pb-6 md:grid-cols-2 xl:grid-cols-3">
                      {visibleImages.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          disabled={!asset.previewUrl}
                          onClick={() => setDraftSelectedAssetId(asset.id)}
                          className={cx(
                            "group grid cursor-pointer overflow-hidden rounded-sm border bg-[var(--color-surface-raised)] text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-50",
                            draftSelectedAssetId === asset.id
                              ? "border-[var(--color-brand)] ring-2 ring-[color-mix(in_oklab,var(--color-brand)_42%,transparent)]"
                              : "border-[var(--color-hairline)]",
                          )}
                          aria-pressed={draftSelectedAssetId === asset.id}
                        >
                          <div className="aspect-video bg-[var(--color-bg)]">
                            {asset.previewUrl ? (
                              <div
                                className="h-full w-full bg-cover bg-center transition-transform duration-[180ms] ease-out group-hover:scale-[1.02]"
                                style={{
                                  backgroundImage: `url("${asset.previewUrl}")`,
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <ImageIcon
                                  className="h-8 w-8 text-[var(--color-text-muted)]"
                                  strokeWidth={1.5}
                                />
                              </div>
                            )}
                          </div>
                          <div className="grid gap-1 p-3">
                            <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                              {asset.displayName}
                            </div>
                            <div className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                              {isSearching ? asset.pathLabel : asset.mimeType}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
                              <span>{asset.byteSize}</span>
                              <span>{asset.updated}</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </MediaAssetDropTarget>
            </div>
          </section>
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--color-hairline)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 truncate text-[12px] text-[var(--color-text-muted)]">
            {draftSelectedAsset
              ? `Selected: ${draftSelectedAsset.displayName}`
              : "Select an image to attach."}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
            {canClearImage ? (
              <button
                type="button"
                onClick={onClearImage}
                className="col-span-2 inline-flex h-10 min-w-28 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-danger)] sm:col-span-1"
              >
                Remove image
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 min-w-24 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draftSelectedAsset}
              onClick={() => {
                if (!draftSelectedAsset) return
                onSelectImage(draftSelectedAsset)
              }}
              className="inline-flex h-10 min-w-24 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-brand)] bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:brightness-110 disabled:cursor-not-allowed disabled:border-[var(--color-hairline)] disabled:bg-[var(--color-surface-raised)] disabled:text-[var(--color-text-disabled)]"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function imagePickerEmptyState({
  isSearching,
  hasImages,
  selectedFolderLabel,
  canUpload,
}: {
  isSearching: boolean
  hasImages: boolean
  selectedFolderLabel: string
  canUpload: boolean
}) {
  if (!hasImages) {
    return {
      title: "No ready image assets yet",
      description: canUpload
        ? "Upload images in this picker or in the Media Library, then use them in experience blocks."
        : "No ready images are available to attach to experience blocks yet.",
    }
  }

  if (isSearching) {
    return {
      title: "No image assets match this search",
      description:
        "Search checks every folder in the image library. Try another name, alt text, MIME type, path, or asset ID.",
    }
  }

  return {
    title: `${selectedFolderLabel} has no images`,
    description: canUpload
      ? "Choose another folder or drop image files here to upload into this folder."
      : "Choose another folder or ask an editor with media permissions to upload images.",
  }
}

function ImagePickerEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[320px] items-center justify-center px-6 py-10">
      <div className="grid max-w-md justify-items-center gap-3 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
          <UploadCloud className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {title}
        </div>
        <div className="max-w-sm text-[13px] leading-6 text-[var(--color-text-muted)]">
          {description}
        </div>
      </div>
    </div>
  )
}
