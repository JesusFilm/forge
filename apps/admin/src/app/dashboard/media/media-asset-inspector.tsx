"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import {
  Download,
  File as FileIcon,
  FileText,
  Globe2,
  Image as ImageIcon,
  Trash2,
  Video,
  X,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import { ConfirmModal } from "@/components/confirm-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import {
  MediaLocalizationModal,
  type MediaAssetLocaleRow,
} from "./media-localization-modal"

type DeleteAssetActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type LocaleActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type UsageItem = {
  resourceType: "EXPERIENCE_LOCALE" | "VIDEO_LOCALE"
  resourceLocaleId: string
  locale: string
  title: string | null
  editUrl: string
  recoverable: boolean
  fieldPath: string
}

type MediaAssetInspectorProps = {
  asset: {
    id: string
    kind: "IMAGE" | "VIDEO" | "PDF" | "FILE"
    displayName: string
    folderLabel: string
    originalFilename: string | null
    supplementalLabel: string
    backend: string
    updatedAtIso: string
    updatedAtLabel: string
    width: number | null
    height: number | null
    blurDataUrl: string | null
    imageEnrichmentStatus:
      | "WAITING"
      | "PROCESSING"
      | "COMPLETE"
      | "FAILED"
      | "SKIPPED"
    imageEnrichmentErrorMessage: string | null
    previewUrl: string | null
    downloadUrl: string | null
  }
  closeHref: Route
  locales: MediaAssetLocaleRow[]
  usage: UsageItem[]
  canEditMetadata: boolean
  canDeleteAsset: boolean
  onUpdateLocale: (formData: FormData) => Promise<LocaleActionResult>
  onRetryEnrichment: (formData: FormData) => Promise<LocaleActionResult>
  onDeleteAsset: (formData: FormData) => Promise<DeleteAssetActionResult>
}

export function MediaAssetInspector({
  asset,
  closeHref,
  locales,
  usage,
  canEditMetadata,
  canDeleteAsset,
  onUpdateLocale,
  onRetryEnrichment,
  onDeleteAsset,
}: MediaAssetInspectorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isDeletePending, startDeleteTransition] = useTransition()
  const { toasts, pushToast, dismissToast } = useToastStack()
  const [error, setError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [localizationOpen, setLocalizationOpen] = useState(false)
  const [metadataLocale, setMetadataLocale] = useState("en")
  const [metadataDirty, setMetadataDirty] = useState(false)
  const lastSubmittedMetadata = useRef<string | null>(null)

  const activeLocale =
    locales.find((locale) => locale.locale === metadataLocale) ??
    locales.find((locale) => locale.locale === "en") ??
    locales[0] ??
    null
  const metadataStatus = activeLocale?.status ?? asset.imageEnrichmentStatus

  function saveLocalizedMetadata(
    formData: FormData,
    options = { toast: true },
  ) {
    startTransition(async () => {
      const result = await onUpdateLocale(formData)
      if (!result.ok) {
        setError(result.message)
        pushToast(result.message, "error")
        return
      }

      setError(null)
      setMetadataDirty(false)
      if (options.toast) {
        pushToast("Metadata saved.", "success")
      }
      router.refresh()
    })
  }

  function autosaveLocalizedMetadata(form: HTMLFormElement | null) {
    if (!form || !canEditMetadata || !metadataDirty || isPending) {
      return
    }

    const formData = new FormData(form)
    const snapshot = JSON.stringify({
      locale: formData.get("locale"),
      displayName: formData.get("displayName"),
      altText: formData.get("altText"),
    })

    if (snapshot === lastSubmittedMetadata.current) {
      return
    }

    lastSubmittedMetadata.current = snapshot
    saveLocalizedMetadata(formData, { toast: false })
  }

  const imageAlt = activeLocale?.altText?.trim() || asset.displayName
  const displayNameLabel =
    activeLocale?.displayName?.trim() || asset.displayName

  const localeOptions =
    locales.length > 0
      ? locales
      : [
          {
            id: "en",
            locale: "en",
            displayName: null,
            altText: null,
            displayNameSource: null,
            altTextSource: null,
            displayNameLocked: false,
            altTextLocked: false,
            status: "WAITING" as const,
            errorMessage: null,
            updatedAtLabel: "n/a",
          },
        ]

  function deleteAsset() {
    if (!canDeleteAsset || usage.length > 0 || isDeletePending) {
      return
    }

    const formData = new FormData()
    formData.set("id", asset.id)

    startDeleteTransition(async () => {
      const result = await onDeleteAsset(formData)

      if (!result.ok) {
        pushToast(result.message, "error")
        setDeleteDialogOpen(false)
        return
      }

      setDeleteDialogOpen(false)
      pushToast("Asset deleted.", "success")
      router.push(closeHref)
      router.refresh()
    })
  }

  return (
    <aside className="relative flex min-h-0 flex-col border-l border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
      <div className="hairline-strong-b flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {asset.displayName}
          </div>
          {asset.supplementalLabel ? (
            <div className="mono-meta mt-1 truncate text-[var(--color-text-muted)]">
              {asset.supplementalLabel}
            </div>
          ) : null}
        </div>
        <Link
          href={closeHref}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
          aria-label="Close asset inspector"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div>
          {asset.kind === "IMAGE" && asset.previewUrl ? (
            <div className="w-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.previewUrl}
                alt={imageAlt}
                width={asset.width ?? undefined}
                height={asset.height ?? undefined}
                className="block h-auto max-h-40 w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)]">
              {asset.kind === "PDF" ? (
                <FileText
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              ) : asset.kind === "VIDEO" ? (
                <Video
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              ) : asset.kind === "FILE" ? (
                <FileIcon
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              ) : (
                <ImageIcon
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              )}
            </div>
          )}
        </div>

        {asset.downloadUrl ? (
          <a
            href={asset.downloadUrl}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-bg)]"
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
            Download
          </a>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            autosaveLocalizedMetadata(event.currentTarget)
          }}
          className="grid gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                Metadata
              </div>
              <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
                {metadataStatus.toLowerCase()}
              </div>
            </div>
            <select
              value={metadataLocale}
              onChange={(event) => setMetadataLocale(event.target.value)}
              className="h-8 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 font-mono text-[12px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)]"
            >
              {localeOptions.map((locale) => (
                <option key={locale.locale} value={locale.locale}>
                  {locale.locale}
                </option>
              ))}
            </select>
          </div>
          <input type="hidden" name="mediaAssetId" value={asset.id} />
          <input type="hidden" name="locale" value={metadataLocale} />
          <label className="grid gap-1.5">
            <span className="label-text">Display name</span>
            <input
              key={`${activeLocale?.id ?? "new"}:displayName`}
              name="displayName"
              defaultValue={activeLocale?.displayName ?? displayNameLabel}
              disabled={!canEditMetadata || isPending}
              onBlur={(event) =>
                autosaveLocalizedMetadata(event.currentTarget.form)
              }
              onChange={() => setMetadataDirty(true)}
              className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {asset.kind === "IMAGE" ? (
            <label className="grid gap-1.5">
              <span className="label-text">Alt text</span>
              <textarea
                key={`${activeLocale?.id ?? "new"}:altText`}
                name="altText"
                defaultValue={activeLocale?.altText ?? ""}
                disabled={!canEditMetadata || isPending}
                rows={3}
                onBlur={(event) =>
                  autosaveLocalizedMetadata(event.currentTarget.form)
                }
                onChange={() => setMetadataDirty(true)}
                className="min-h-20 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 py-2 text-[13px] leading-5 outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          ) : null}

          {error ? (
            <div className="text-[12px] text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {canEditMetadata ? (
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="mono-meta text-[var(--color-text-muted)]">
                {isPending ? "saving" : metadataDirty ? "unsaved" : "saved"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLocalizationOpen(true)}
                  className="inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Globe2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  All locales
                </button>
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[var(--color-text-muted)]">
              Your account cannot edit media metadata.
            </div>
          )}
        </form>

        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5 text-[12px]">
            <div className="label-text">Kind</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {asset.kind}
            </div>
            <div className="label-text">Folder</div>
            <div
              className="truncate text-[var(--color-text-secondary)]"
              title={asset.folderLabel}
            >
              {asset.folderLabel}
            </div>
            <div className="label-text">Backend</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {asset.backend}
            </div>
            <div className="label-text">Original</div>
            <div
              className="truncate text-[var(--color-text-secondary)]"
              title={asset.originalFilename ?? ""}
            >
              {asset.originalFilename ?? "n/a"}
            </div>
            <div className="label-text">Updated</div>
            <div
              className="truncate text-[var(--color-text-secondary)]"
              title={asset.updatedAtIso}
            >
              {asset.updatedAtLabel}
            </div>
          </div>
        </div>

        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <div className="hairline-strong-b px-3 py-2">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
              Where used
            </div>
            <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
              {usage.length} references
            </div>
          </div>
          <div className="divide-y divide-[var(--color-hairline)]">
            {usage.map((item) => (
              <Link
                key={`${item.resourceType}:${item.resourceLocaleId}:${item.fieldPath}`}
                href={item.editUrl as Route}
                className="grid gap-1 px-3 py-3 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
              >
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  {item.title ?? item.resourceLocaleId}
                </div>
                <div className="mono-meta text-[var(--color-text-muted)]">
                  {item.resourceType === "VIDEO_LOCALE"
                    ? "Video"
                    : "Experience"}
                  {item.recoverable ? " (recoverable)" : ""} / {item.locale} /{" "}
                  {item.fieldPath}
                </div>
              </Link>
            ))}
            {usage.length === 0 ? (
              <div className="px-3 py-6 text-[12px] text-[var(--color-text-muted)]">
                This asset is not currently referenced by any experience or
                video locale field.
              </div>
            ) : null}
          </div>
        </div>

        {canDeleteAsset ? (
          <div className="mt-auto grid gap-2 rounded-sm border border-[color-mix(in_srgb,var(--color-danger)_42%,var(--color-hairline))] bg-[color-mix(in_srgb,var(--color-danger)_7%,var(--color-surface))] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-danger)]">
                  Danger zone
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                  {usage.length > 0
                    ? "Clear references before deleting this asset."
                    : "Unused assets can be permanently deleted."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={usage.length > 0 || isDeletePending}
                className={cx(
                  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 text-[13px] font-medium transition-all duration-[120ms] ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-danger)] focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-55",
                  "border-[color-mix(in_srgb,var(--color-danger)_55%,var(--color-hairline))] bg-[var(--color-surface)] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,var(--color-surface))]",
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
        title="Delete This Asset?"
        description={`This will permanently delete ${asset.displayName}. This cannot be undone.`}
        confirmLabel="Delete Asset"
        pending={isDeletePending}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={deleteAsset}
      />
      <MediaLocalizationModal
        open={localizationOpen}
        assetId={asset.id}
        assetName={asset.displayName}
        previewUrl={asset.previewUrl}
        locales={locales}
        canEdit={canEditMetadata}
        onClose={() => setLocalizationOpen(false)}
        onUpdateLocale={onUpdateLocale}
        onRetryEnrichment={onRetryEnrichment}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </aside>
  )
}
