"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { Folder, FolderTree, Trash2, X } from "lucide-react"
import Link from "next/link"
import { cx } from "@/components/admin-ui"
import { ConfirmModal } from "@/components/confirm-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"

type DeleteFolderActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type MediaFolderInspectorProps = {
  folder: {
    id: string
    label: string
    pathLabel: string
    parentLabel: string
    directAssetCount: number
    childFolderCount: number
  }
  closeHref: Route
  afterDeleteHref: Route
  canDeleteFolder: boolean
  onDeleteFolder: (formData: FormData) => Promise<DeleteFolderActionResult>
}

export function MediaFolderInspector({
  folder,
  closeHref,
  afterDeleteHref,
  canDeleteFolder,
  onDeleteFolder,
}: MediaFolderInspectorProps) {
  const router = useRouter()
  const [isDeletePending, startDeleteTransition] = useTransition()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const { toasts, pushToast, dismissToast } = useToastStack()
  const canDeleteEmptyFolder =
    canDeleteFolder &&
    folder.directAssetCount === 0 &&
    folder.childFolderCount === 0

  useEffect(() => {
    if (!canDeleteEmptyFolder || deleteDialogOpen || isDeletePending) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest("button,input,textarea,select,a,[contenteditable=true]")
      ) {
        return
      }

      event.preventDefault()
      setDeleteDialogOpen(true)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [canDeleteEmptyFolder, deleteDialogOpen, isDeletePending])

  function deleteFolder() {
    if (!canDeleteEmptyFolder || isDeletePending) {
      return
    }

    const formData = new FormData()
    formData.set("id", folder.id)

    startDeleteTransition(async () => {
      const result = await onDeleteFolder(formData)

      if (!result.ok) {
        pushToast(result.message, "error")
        setDeleteDialogOpen(false)
        return
      }

      setDeleteDialogOpen(false)
      pushToast("Folder deleted.", "success")
      router.push(afterDeleteHref)
      router.refresh()
    })
  }

  return (
    <aside className="relative flex min-h-0 flex-col border-l border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
      <div className="hairline-strong-b flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {folder.label}
          </div>
        </div>
        <Link
          href={closeHref}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
          aria-label="Close folder inspector"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-primary)]">
            <Folder className="h-4 w-4" strokeWidth={1.5} />
            Folder details
          </div>
          <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-[12px]">
            <div className="label-text">Parent</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {folder.parentLabel}
            </div>
            <div className="label-text">Assets</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {folder.directAssetCount}
            </div>
            <div className="label-text">Child folders</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {folder.childFolderCount}
            </div>
          </div>
        </div>

        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
          <div className="flex items-start gap-3">
            <FolderTree
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
              strokeWidth={1.5}
            />
            <div className="min-w-0 text-[12px] leading-5 text-[var(--color-text-muted)]">
              Folder counts only include assets directly inside this folder.
              Assets in child folders stay with those child folders.
            </div>
          </div>
        </div>

        {canDeleteFolder ? (
          <div className="grid gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  Delete folder
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                  {canDeleteEmptyFolder
                    ? "Empty folders can be permanently deleted."
                    : "Move or delete contained assets and child folders first."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={!canDeleteEmptyFolder || isDeletePending}
                className={cx(
                  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 text-[13px] font-medium transition-all duration-[120ms] ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-danger)] focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-55",
                  "border-[var(--color-hairline)] text-[var(--color-danger)] hover:bg-[var(--color-surface-raised)]",
                )}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                {isDeletePending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmModal
        open={deleteDialogOpen}
        title="Delete This Folder?"
        description={`This will permanently delete ${folder.label}. This cannot be undone.`}
        confirmLabel="Delete Folder"
        pending={isDeletePending}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={deleteFolder}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </aside>
  )
}
