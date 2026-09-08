import type { CollectionDownloadQueueItem } from "@/components/watch/collection-download-options"
import {
  WATCH_DOWNLOAD_AUTH_REQUIRED,
  WATCH_DOWNLOAD_ERROR_HEADER,
} from "@/lib/watch-download-contract"

export type CollectionDownloadProgress = {
  active: CollectionDownloadQueueItem | null
  completed: CollectionDownloadQueueItem[]
  failed: Array<{ item: CollectionDownloadQueueItem; reason: string }>
  total: number
}

export type CollectionDownloadDirectory = {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<WritableStream<Uint8Array>>
  }>
  removeEntry?(name: string): Promise<void>
}

export type CollectionDownloadQueueResult = CollectionDownloadProgress & {
  authRequired: boolean
  canceled: boolean
  deliveryMode: "browser" | "directory"
}

export function failedCollectionDownloadItems(
  result: Pick<CollectionDownloadQueueResult, "failed">,
): CollectionDownloadQueueItem[] {
  return result.failed.map(({ item }) => item)
}

class CollectionDownloadPreparationError extends Error {
  constructor(
    message: string,
    readonly authRequired = false,
  ) {
    super(message)
  }
}

class CollectionDownloadTransportError extends Error {}

async function defaultPrepareDownload(
  item: CollectionDownloadQueueItem,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(item.url, {
    method: "HEAD",
    credentials: "same-origin",
    redirect: "manual",
    signal,
  })
  if (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  ) {
    return
  }
  if (
    response.status === 401 &&
    response.headers.get(WATCH_DOWNLOAD_ERROR_HEADER) ===
      WATCH_DOWNLOAD_AUTH_REQUIRED
  ) {
    throw new CollectionDownloadPreparationError(
      WATCH_DOWNLOAD_AUTH_REQUIRED,
      true,
    )
  }
  throw new CollectionDownloadPreparationError(
    `download-unavailable-${response.status || "network"}`,
  )
}

async function downloadToDirectory(
  item: CollectionDownloadQueueItem,
  directory: CollectionDownloadDirectory,
  signal: AbortSignal,
): Promise<CollectionDownloadQueueItem> {
  let response: Response
  try {
    response = await fetch(item.url, {
      credentials: "same-origin",
      signal,
    })
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error
    }
    throw new CollectionDownloadTransportError("download-response-unreadable")
  }
  if (
    response.status === 401 &&
    response.headers.get(WATCH_DOWNLOAD_ERROR_HEADER) ===
      WATCH_DOWNLOAD_AUTH_REQUIRED
  ) {
    throw new CollectionDownloadPreparationError(
      WATCH_DOWNLOAD_AUTH_REQUIRED,
      true,
    )
  }
  if (!response.ok) {
    throw new CollectionDownloadPreparationError(`http-${response.status}`)
  }
  if (!response.body) {
    throw new CollectionDownloadTransportError("download-response-unreadable")
  }

  const filename = await resolveAvailableFilename(directory, item.filename)
  const file = await directory.getFileHandle(filename, { create: true })
  const writable = await file.createWritable()
  try {
    await response.body.pipeTo(writable, { signal })
  } catch (error) {
    await writable.abort().catch(() => undefined)
    await directory.removeEntry?.(filename).catch(() => undefined)
    throw error
  }
  return filename === item.filename ? item : { ...item, filename }
}

function suffixedFilename(filename: string, attempt: number): string {
  const dotIndex = filename.lastIndexOf(".")
  const basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : ""
  return `${basename} (${attempt})${extension}`
}

async function resolveAvailableFilename(
  directory: CollectionDownloadDirectory,
  requestedFilename: string,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const filename =
      attempt === 0
        ? requestedFilename
        : suffixedFilename(requestedFilename, attempt)
    try {
      await directory.getFileHandle(filename, { create: false })
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return filename
      }
      throw error
    }
  }
}

function defaultTriggerDownload(item: CollectionDownloadQueueItem): void {
  const anchor = document.createElement("a")
  anchor.href = item.url
  anchor.download = item.filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function defaultDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return signal.aborted
      ? Promise.reject(new DOMException("Aborted", "AbortError"))
      : Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(cleanupAndResolve, ms)

    function cleanup() {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", cleanupAndReject)
    }

    function cleanupAndResolve() {
      cleanup()
      resolve()
    }

    function cleanupAndReject() {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }

    signal.addEventListener("abort", cleanupAndReject, { once: true })
  })
}

export async function runCollectionDownloadQueue(input: {
  items: CollectionDownloadQueueItem[]
  signal: AbortSignal
  directory?: CollectionDownloadDirectory | null
  delayMs?: number
  delay?: (ms: number, signal: AbortSignal) => Promise<void>
  prepareDownload?: (
    item: CollectionDownloadQueueItem,
    signal: AbortSignal,
  ) => Promise<void>
  triggerDownload?: (item: CollectionDownloadQueueItem) => void
  onProgress?: (progress: CollectionDownloadProgress) => void
}): Promise<CollectionDownloadQueueResult> {
  const completed: CollectionDownloadQueueItem[] = []
  const failed: Array<{ item: CollectionDownloadQueueItem; reason: string }> =
    []
  const delay = input.delay ?? defaultDelay
  const delayMs = input.delayMs ?? 750
  const prepareDownload = input.prepareDownload ?? defaultPrepareDownload
  const triggerDownload = input.triggerDownload ?? defaultTriggerDownload
  let canceled = false
  let authRequired = false
  let directory = input.directory ?? null
  let deliveryMode: CollectionDownloadQueueResult["deliveryMode"] = directory
    ? "directory"
    : "browser"

  const report = (active: CollectionDownloadQueueItem | null) =>
    input.onProgress?.({
      active,
      completed: [...completed],
      failed: [...failed],
      total: input.items.length,
    })

  for (const [itemIndex, item] of input.items.entries()) {
    if (input.signal.aborted) {
      canceled = true
      failed.push(
        ...input.items.slice(itemIndex).map((remainingItem) => ({
          item: remainingItem,
          reason: "canceled",
        })),
      )
      break
    }

    report(item)
    let browserHandoffCompleted = false
    try {
      if (directory) {
        try {
          completed.push(
            await downloadToDirectory(item, directory, input.signal),
          )
        } catch (error) {
          if (!(error instanceof CollectionDownloadTransportError)) throw error
          directory = null
          deliveryMode = "browser"
          await prepareDownload(item, input.signal)
          triggerDownload(item)
          browserHandoffCompleted = true
          completed.push(item)
          await delay(delayMs, input.signal)
        }
      } else {
        await prepareDownload(item, input.signal)
        triggerDownload(item)
        browserHandoffCompleted = true
        completed.push(item)
        await delay(delayMs, input.signal)
      }
    } catch (error) {
      if (
        input.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        canceled = true
        failed.push(
          ...input.items
            .slice(itemIndex + (browserHandoffCompleted ? 1 : 0))
            .map((remainingItem) => ({
              item: remainingItem,
              reason: "canceled",
            })),
        )
        break
      }
      if (
        error instanceof CollectionDownloadPreparationError &&
        error.authRequired
      ) {
        authRequired = true
        failed.push(
          ...input.items.slice(itemIndex).map((remainingItem) => ({
            item: remainingItem,
            reason: WATCH_DOWNLOAD_AUTH_REQUIRED,
          })),
        )
        break
      }
      failed.push({
        item,
        reason: error instanceof Error ? error.message : "download-failed",
      })
    }
  }

  report(null)
  return {
    active: null,
    authRequired,
    canceled,
    completed,
    deliveryMode,
    failed,
    total: input.items.length,
  }
}
