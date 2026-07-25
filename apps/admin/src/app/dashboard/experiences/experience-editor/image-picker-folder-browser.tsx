"use client"

import { ChevronDown, Folder } from "lucide-react"
import { cx } from "@/components/admin-ui"
import type { MediaLibraryBrowserFolder } from "@/app/dashboard/media/media-library-browser-data"

type ImagePickerFolderBrowserProps = {
  rootLabel: string
  rootImageCount: number
  folders: MediaLibraryBrowserFolder[]
  selectedFolderId: string | null
  onSelectFolder: (folderId: string | null) => void
}

export function ImagePickerFolderBrowser({
  rootLabel,
  rootImageCount,
  folders,
  selectedFolderId,
  onSelectFolder,
}: ImagePickerFolderBrowserProps) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden border-r border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-3 text-[12px] font-medium text-[var(--color-text-primary)]">
        <Folder className="h-4 w-4" strokeWidth={1.5} />
        Folders
      </div>
      <nav
        aria-label="Image folders"
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        <FolderButton
          label={rootLabel}
          count={rootImageCount}
          depth={0}
          selected={selectedFolderId === null}
          onClick={() => onSelectFolder(null)}
        />
        {folders.map((folder) => (
          <FolderButton
            key={folder.id}
            label={folder.label}
            count={folder.directAssetCount}
            depth={folder.depth + 1}
            selected={selectedFolderId === folder.id}
            onClick={() => onSelectFolder(folder.id)}
          />
        ))}
      </nav>
    </div>
  )
}

function FolderButton({
  label,
  count,
  depth,
  selected,
  onClick,
}: {
  label: string
  count: number
  depth: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left text-[12px] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset",
        selected
          ? "bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)]",
      )}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      <ChevronDown
        className={cx(
          "h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]",
          depth === 0 && "opacity-0",
        )}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <Folder className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
        {count}
      </span>
    </button>
  )
}
