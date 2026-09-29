/**
 * U7 (R4): stored offline titles follow the UI language once the text
 * companion answers. The write is the lifecycle's field-level patch, so a
 * download state write that lands meanwhile is kept.
 */
import type { AdminLanguageForms } from "../i18n/adminLanguage"
import type { OfflineTitlePatch } from "./downloadLifecycle"
import type { OfflineDownloadRecord } from "./offlineManifest"
import { GET_VIDEO_TEXT } from "./queries"
import {
  pickVideoText,
  readTitle,
  videoTextVariables,
  type VideoTextSource,
} from "./videoText"

/** The locale of a record from before U7: the app showed English only. */
export const LEGACY_TITLE_LOCALE = "en"

/** Records per pass. `videoBySlug` is rate-limited per caller, so a long
 *  library refreshes over several passes. */
export const OFFLINE_TITLE_REFRESH_MAX_RECORDS = 20

/** Text requests in flight at once. */
export const OFFLINE_TITLE_REFRESH_CONCURRENCY = 3

export function titleLocaleOf(record: OfflineDownloadRecord): string {
  return record.titleLocale ?? LEGACY_TITLE_LOCALE
}

/** The records whose titles are in another locale than the UI's. */
export function recordsNeedingTitles(
  records: readonly OfflineDownloadRecord[],
  catalogTag: string,
): OfflineDownloadRecord[] {
  return records.filter(
    (record) =>
      record.state !== "canceled" && titleLocaleOf(record) !== catalogTag,
  )
}

export type OfflineTitleRefreshDeps = {
  records: () => readonly OfflineDownloadRecord[]
  /** The UI's forms now: the list shows no captured screen text. */
  forms: () => AdminLanguageForms
  epoch: () => number
  /** One slug's text rows; null when Admin has no such video. Rejects when
   *  the request fails. */
  fetchText: (
    slug: string,
    forms: AdminLanguageForms,
  ) => Promise<VideoTextSource | null>
  patch: (videoSlug: string, fields: OfflineTitlePatch) => Promise<void>
}

type Answer = { ok: true; text: VideoTextSource | null } | { ok: false }

async function fetchAll(
  slugs: readonly string[],
  forms: AdminLanguageForms,
  fetchText: OfflineTitleRefreshDeps["fetchText"],
): Promise<Map<string, Answer>> {
  const answers = new Map<string, Answer>()
  let next = 0
  const worker = async () => {
    while (next < slugs.length) {
      const slug = slugs[next]!
      next += 1
      try {
        answers.set(slug, { ok: true, text: await fetchText(slug, forms) })
      } catch {
        answers.set(slug, { ok: false })
      }
    }
  }
  const workers = Math.min(OFFLINE_TITLE_REFRESH_CONCURRENCY, slugs.length)
  await Promise.all(Array.from({ length: workers }, worker))
  return answers
}

/** The title in the UI language, else English (R10); null keeps the stored one. */
function titleIn(answer: Answer | undefined, forms: AdminLanguageForms) {
  if (answer == null || !answer.ok) return undefined
  return pickVideoText(answer.text, forms, readTitle)?.text ?? null
}

/** One pass. A failed request writes nothing, so the next pass tries again. */
export async function refreshOfflineTitles(
  deps: OfflineTitleRefreshDeps,
): Promise<void> {
  const forms = deps.forms()
  const epochAtStart = deps.epoch()
  const stale = recordsNeedingTitles(deps.records(), forms.catalogTag).slice(
    0,
    OFFLINE_TITLE_REFRESH_MAX_RECORDS,
  )
  if (stale.length === 0) return
  const slugs = [
    ...new Set(
      stale.flatMap((record) =>
        record.seriesSlug
          ? [record.videoSlug, record.seriesSlug]
          : [record.videoSlug],
      ),
    ),
  ]
  const answers = await fetchAll(slugs, forms, deps.fetchText)
  // Text for the language the pass started in is now the wrong language.
  if (deps.epoch() !== epochAtStart) return
  for (const record of stale) {
    const title = titleIn(answers.get(record.videoSlug), forms)
    if (title === undefined) continue
    const seriesTitle = record.seriesSlug
      ? titleIn(answers.get(record.seriesSlug), forms)
      : null
    if (seriesTitle === undefined) continue
    await deps.patch(record.videoSlug, {
      ...(title ? { title } : {}),
      ...(seriesTitle ? { seriesTitle } : {}),
      titleLocale: forms.catalogTag,
    })
  }
}

/** Single flight: a request during a pass runs one more pass after it. */
export function createOfflineTitleRefresher(deps: OfflineTitleRefreshDeps) {
  let running = false
  let again = false
  async function loop(): Promise<void> {
    try {
      do {
        again = false
        await refreshOfflineTitles(deps).catch(() => undefined)
      } while (again)
    } finally {
      running = false
    }
  }
  return {
    request(): void {
      if (running) {
        again = true
        return
      }
      running = true
      void loop()
    },
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
/** The text companion, the watch screen's own document (KTD10). */
export async function fetchOfflineTitleText(
  slug: string,
  forms: AdminLanguageForms,
): Promise<VideoTextSource | null> {
  // Lazy, so this module and its tests stay free of the Apollo client.
  const { getApolloClient } =
    require("./apolloClient") as typeof import("./apolloClient")
  const result = await getApolloClient().query({
    query: GET_VIDEO_TEXT,
    variables: { slug, ...videoTextVariables(forms) },
    fetchPolicy: "cache-first",
  })
  if (result.error) throw result.error
  return result.data?.videoBySlug ?? null
}
/* eslint-enable @typescript-eslint/no-require-imports */
