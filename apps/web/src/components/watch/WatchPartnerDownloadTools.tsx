"use client"

import { useEffect, useId, useRef, useState, type MouseEvent } from "react"

import {
  buildCollectionDownloadOptions,
  buildCollectionDownloadQueue,
  type CollectionDownloadOptions,
  type CollectionDownloadQueueItem,
} from "@/components/watch/collection-download-options"
import {
  runCollectionDownloadQueue,
  type CollectionDownloadProgress,
} from "@/components/watch/collection-download-queue"
import type { DownloadTier } from "@/components/watch/download-options"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { watchAccountAuthUrl } from "@/components/watch/use-watch-account-session"
import { languageCodeFor } from "@/lib/language-code"
import { TERMS_OF_USE_CANONICAL_URL } from "@/lib/terms-of-use"
import { loadWatchCollectionDownloads } from "@/lib/watch-collection-download-actions"
import { loadWatchPartnerDownloadCollection } from "@/lib/watch-partner-download-actions"
import { loadGlobalWatchLanguageOptions } from "@/lib/watch-interaction-loader"
import type { GlobalLanguageOption } from "@/lib/watch-language-switcher"

export type WatchPartnerDownloadToolsProps = {
  /** The audio language the visitor is on now; the first language chosen. */
  languageSlug: string
  /** UI locale, used only to localize titles. */
  locale: string
  /** The collection to start on. Defaults to the first curated collection. */
  collectionSlug?: string
  /**
   * Identity of the signed-in account. Changing it discards everything and
   * stops anything running, so one account's choices never carry to another.
   */
  accountId?: string
}

// Curated choices only: the titles, counts and availability shown after
// "Prepare" always come from Admin.
const COLLECTIONS = [
  { slug: "walking-with-jesus-africa", label: "Walking with Jesus (Africa)" },
  { slug: "conversation-starters", label: "Conversation Starters" },
  {
    slug: "7-days-with-jesus-walk-with-jesus",
    label: "7 Days with Jesus: Walk with Jesus",
  },
  { slug: "storyclubs", label: "StoryClubs" },
  { slug: "do-you-ever-wonder", label: "Do You Ever Wonder?" },
  { slug: "rivka", label: "Rivka" },
  { slug: "file-zero", label: "File Zero" },
  { slug: "retelling-the-good-story", label: "Retelling the Good Story" },
] as const

const TIER_LABEL: Record<DownloadTier, string> = {
  highest: "Highest quality",
  high: "High quality",
  low: "Low quality",
}

type Group = {
  languageSlug: string
  name: string
  status: "ready" | "unavailable" | "failed"
  collectionTitle: string | null
  episodeCount: number
  options: CollectionDownloadOptions | null
}

type PendingItem = { item: CollectionDownloadQueueItem; reason: string }

type Run = {
  total: number
  initiated: CollectionDownloadQueueItem[]
  pending: PendingItem[]
  active: CollectionDownloadQueueItem | null
  running: boolean
  canceled: boolean
  authRequired: boolean
}

type Catalog =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; options: GlobalLanguageOption[] }

const ACTION_CLASS =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-white/40 px-5 py-2 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/40 disabled:hover:bg-transparent disabled:hover:text-white"
const FIELD_CLASS =
  "min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-stone-900 px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:opacity-50"

// Queue ids are `<language>:<video>` so the same video in two languages never
// collides in the completed/retry bookkeeping.
const queueId = (languageSlug: string, videoId: string) =>
  `${languageSlug}:${videoId}`
const languageOfQueueId = (id: string) => id.slice(0, id.indexOf(":"))

export function WatchPartnerDownloadTools(
  props: WatchPartnerDownloadToolsProps,
) {
  return <Tools key={props.accountId ?? ""} {...props} />
}

function Tools({
  languageSlug,
  locale,
  collectionSlug,
}: WatchPartnerDownloadToolsProps) {
  const id = useId()
  const [collection, setCollection] = useState(
    collectionSlug ?? COLLECTIONS[0].slug,
  )
  const [languages, setLanguages] = useState<string[]>([languageSlug])
  const [catalog, setCatalog] = useState<Catalog>({ status: "idle" })
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [tiers, setTiers] = useState<Record<string, DownloadTier>>({})
  const [preparing, setPreparing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [terms, setTerms] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  // Bumped to invalidate every in-flight lookup and queue: a late answer from
  // before a change, a stop, or an unmount is discarded.
  const versionRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      versionRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [])

  const catalogOptions = catalog.status === "ready" ? catalog.options : []
  const nameOf = (slug: string) =>
    catalogOptions.find((option) => option.slug === slug)?.englishName ?? slug
  const running = run?.running === true
  const busy = preparing || starting || running

  function chooseLanguages() {
    setCatalog({ status: "loading" })
    loadGlobalWatchLanguageOptions().then(
      (options) => setCatalog({ status: "ready", options }),
      () => setCatalog({ status: "error" }),
    )
  }

  function resetPrepared() {
    versionRef.current += 1
    setGroups(null)
    setRun(null)
    setAuthRequired(false)
    setTerms(false)
  }

  async function resolveGroups(
    slugs: string[],
    version: number,
  ): Promise<Group[] | "auth-required" | null> {
    const resolved: Group[] = []
    for (const slug of slugs) {
      const [meta, downloads] = await Promise.all([
        loadWatchPartnerDownloadCollection({
          collectionSlug: collection,
          languageSlug: slug,
          locale,
        }).catch(() => ({ ok: false as const, reason: "failed" as const })),
        loadWatchCollectionDownloads({
          collectionSlug: collection,
          languageSlug: slug,
        }).catch(() => ({
          ok: false as const,
          reason: "unavailable" as const,
        })),
      ])
      if (version !== versionRef.current) return null
      if (!downloads.ok && downloads.reason === "auth-required") {
        return "auth-required"
      }
      const base = {
        languageSlug: slug,
        name: nameOf(slug),
        collectionTitle: null,
        episodeCount: 0,
        options: null,
      }
      if (!meta.ok) {
        resolved.push({
          ...base,
          status: meta.reason === "failed" ? "failed" : "unavailable",
        })
      } else if (!downloads.ok) {
        resolved.push({
          ...base,
          status: downloads.reason === "unavailable" ? "failed" : "unavailable",
        })
      } else {
        const options = buildCollectionDownloadOptions(
          meta.collection.episodes,
          downloads.dubs,
        )
        resolved.push({
          ...base,
          collectionTitle: meta.collection.title,
          episodeCount: meta.collection.episodes.length,
          options,
          status: options.candidates.length > 0 ? "ready" : "unavailable",
        })
      }
    }
    return resolved
  }

  async function prepare() {
    if (busy || languages.length === 0) return
    const version = ++versionRef.current
    setPreparing(true)
    setAuthRequired(false)
    setRun(null)
    setTerms(false)
    const resolved = await resolveGroups(languages, version)
    if (resolved === null) return
    setPreparing(false)
    if (resolved === "auth-required") {
      setGroups(null)
      setAuthRequired(true)
      return
    }
    setGroups(resolved)
  }

  function tierFor(group: Group): DownloadTier | null {
    const common = group.options?.commonTiers ?? []
    const chosen = tiers[group.languageSlug]
    return chosen && common.includes(chosen) ? chosen : (common[0] ?? null)
  }

  function buildItems(group: Group): CollectionDownloadQueueItem[] {
    const tier = tierFor(group)
    if (!group.options || !tier) return []
    const option = catalogOptions.find((o) => o.slug === group.languageSlug)
    return buildCollectionDownloadQueue({
      candidates: group.options.candidates,
      tier,
      languageCode: languageCodeFor({
        bcp47: option?.bcp47,
        slug: group.languageSlug,
      }),
      languageName: group.name,
      languageSlug: group.languageSlug,
    }).map((item) => ({
      ...item,
      id: queueId(group.languageSlug, item.id),
    }))
  }

  async function start(retry: boolean) {
    if (busy || !groups) return
    const version = ++versionRef.current
    const previous = retry ? run : null
    const pendingIds = new Set(previous?.pending.map((p) => p.item.id) ?? [])
    const slugs = groups
      .filter((group) =>
        previous
          ? previous.pending.some(
              (p) => languageOfQueueId(p.item.id) === group.languageSlug,
            )
          : group.status === "ready",
      )
      .map((group) => group.languageSlug)
    setStarting(true)
    setAuthRequired(false)
    // Capabilities are short-lived and availability can change, so every start
    // and retry reads both again, as the collection download dialog does.
    const fresh = await resolveGroups(slugs, version)
    if (fresh === null) return
    if (fresh === "auth-required") {
      setStarting(false)
      setAuthRequired(true)
      return
    }
    const refreshed = groups.map(
      (group) =>
        fresh.find((g) => g.languageSlug === group.languageSlug) ?? group,
    )
    setGroups(refreshed)
    const queueItems = fresh.flatMap(buildItems)
    const items = previous
      ? queueItems.filter((item) => pendingIds.has(item.id))
      : queueItems
    const attemptedIds = new Set(items.map((item) => item.id))
    const unavailable: PendingItem[] =
      previous?.pending
        .filter((p) => !attemptedIds.has(p.item.id))
        .map((p) => ({ item: p.item, reason: "unavailable" })) ?? []
    const initiatedBefore = previous?.initiated ?? []
    const total = previous?.total ?? items.length
    if (items.length === 0) {
      setStarting(false)
      setRun({
        total,
        initiated: initiatedBefore,
        pending: unavailable,
        active: null,
        running: false,
        canceled: false,
        authRequired: false,
      })
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    const report = (progress: CollectionDownloadProgress, running: boolean) =>
      setRun({
        total,
        initiated: [...initiatedBefore, ...progress.completed],
        pending: [...unavailable, ...progress.failed],
        active: progress.active,
        running,
        canceled: false,
        authRequired: false,
      })
    setStarting(false)
    report({ active: items[0], completed: [], failed: [], total }, true)
    const result = await runCollectionDownloadQueue({
      items,
      signal: controller.signal,
      onProgress: (progress) => {
        if (version === versionRef.current) report(progress, true)
      },
    })
    if (controllerRef.current === controller) controllerRef.current = null
    if (version !== versionRef.current) return
    setRun({
      total,
      initiated: [...initiatedBefore, ...result.completed],
      pending: [...unavailable, ...result.failed],
      active: null,
      running: false,
      canceled: result.canceled,
      authRequired: result.authRequired,
    })
  }

  function stop() {
    // Ignores a lookup still in flight and stops the queue before the next file.
    controllerRef.current?.abort()
    if (!controllerRef.current) {
      versionRef.current += 1
      setStarting(false)
      setPreparing(false)
    }
  }

  const readyGroups = groups?.filter((group) => group.status === "ready") ?? []
  const readyFileCount = readyGroups.reduce(
    (sum, group) => sum + buildItems(group).length,
    0,
  )
  const comboboxOptions: LanguageComboboxOption[] = catalogOptions
    .filter((option) => !languages.includes(option.slug))
    .map((option) => ({
      slug: option.slug,
      name: option.englishName,
      nameLang: "en",
      nativeName: option.nativeName,
      nativeNameLang: option.nativeNameLang,
      bcp47: option.bcp47,
      searchAliasSlug: option.aliasOwnerSlug,
    }))
  const collections: Array<{ slug: string; label: string }> = [...COLLECTIONS]
  if (!collections.some((c) => c.slug === collection)) {
    collections.push({ slug: collection, label: "Current collection" })
  }

  const loginHref = (event?: MouseEvent<HTMLAnchorElement>) => {
    const href = watchAccountAuthUrl("login")
    if (event) event.currentTarget.href = href
    return href
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      data-testid="watch-partner-download-tools"
      lang="en"
      dir="ltr"
      className="w-full min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-white md:p-8"
    >
      <h3
        id={`${id}-heading`}
        className="text-xl leading-tight font-semibold text-balance sm:text-2xl"
      >
        Download a collection in more than one language
      </h3>
      <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-white/70">
        Pick a collection and the languages you need. Nothing is looked up until
        you choose Prepare.
      </p>

      <div className="mt-6 grid min-w-0 gap-5">
        <div className="grid gap-2">
          <label htmlFor={`${id}-collection`} className="text-sm font-semibold">
            Collection
          </label>
          <select
            id={`${id}-collection`}
            value={collection}
            disabled={busy}
            onChange={(event) => {
              setCollection(event.target.value)
              resetPrepared()
            }}
            className={FIELD_CLASS}
          >
            {collections.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-semibold">Languages</span>
          <ul
            aria-label="Chosen languages"
            className="flex min-w-0 flex-wrap gap-2"
          >
            {languages.map((slug) => (
              <li
                key={slug}
                data-language-slug={slug}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/[0.06] py-1 pr-1 pl-4 text-sm"
              >
                <span>{nameOf(slug)}</span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${nameOf(slug)}`}
                  onClick={() => {
                    setLanguages((current) => current.filter((s) => s !== slug))
                    resetPrepared()
                  }}
                  className="grid size-9 cursor-pointer place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
          {catalog.status === "idle" ? (
            <div>
              <button
                type="button"
                data-testid="watch-partner-choose-languages"
                onClick={chooseLanguages}
                className={ACTION_CLASS}
              >
                Choose languages
              </button>
            </div>
          ) : null}
          {catalog.status === "loading" ? (
            <p role="status" className="text-sm text-white/70">
              Loading languages…
            </p>
          ) : null}
          {catalog.status === "error" ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-sm text-amber-100">
                Languages couldn’t be loaded right now.
              </p>
              <button
                type="button"
                onClick={chooseLanguages}
                className={ACTION_CLASS}
              >
                Try again
              </button>
            </div>
          ) : null}
          {catalog.status === "ready" ? (
            <div className="max-w-md" data-testid="watch-partner-add-language">
              <LanguageCombobox
                options={comboboxOptions}
                value=""
                placeholder="Add a language"
                disabled={busy}
                onChange={(slug) => {
                  setLanguages((current) =>
                    current.includes(slug) ? current : [...current, slug],
                  )
                  resetPrepared()
                }}
                compact
              />
            </div>
          ) : null}
        </div>

        <div>
          <button
            type="button"
            data-testid="watch-partner-prepare"
            disabled={busy || languages.length === 0}
            onClick={() => void prepare()}
            className={ACTION_CLASS}
          >
            {preparing ? "Checking downloads…" : "Prepare downloads"}
          </button>
        </div>
      </div>

      {authRequired || run?.authRequired ? (
        <div
          role="alert"
          data-testid="watch-partner-download-auth"
          className="mt-6 rounded-xl border border-amber-300/40 bg-amber-200/10 p-4"
        >
          <p className="text-sm leading-relaxed text-amber-50">
            Downloads need you to be signed in. Sign in, then come back and
            continue.
          </p>
          <a
            data-testid="watch-partner-download-sign-in"
            href={loginHref()}
            onClick={loginHref}
            className={`${ACTION_CLASS} mt-3`}
          >
            Sign in
          </a>
        </div>
      ) : null}

      {groups ? (
        <ul
          aria-label="Downloads by language"
          data-testid="watch-partner-download-groups"
          className="mt-6 grid gap-3"
        >
          {groups.map((group) => (
            <GroupRow
              key={group.languageSlug}
              group={group}
              tier={tierFor(group)}
              disabled={busy}
              onTier={(tier) =>
                setTiers((current) => ({
                  ...current,
                  [group.languageSlug]: tier,
                }))
              }
            />
          ))}
        </ul>
      ) : null}

      {groups && readyGroups.length > 0 && !run ? (
        <div className="mt-6 grid gap-4">
          <p className="max-w-[60ch] text-sm leading-relaxed text-white/70">
            Your browser may ask to allow multiple downloads from this site.
            Choose Allow, or later files may be blocked. We can only ask your
            browser to start each file; it decides where they go and we can’t
            see whether they were saved.
          </p>
          <label className="flex max-w-[60ch] cursor-pointer items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              data-testid="watch-partner-download-terms"
              checked={terms}
              disabled={busy}
              onChange={(event) => setTerms(event.target.checked)}
              className="mt-1 size-4 shrink-0"
            />
            <span>
              I agree to the{" "}
              <a
                href={TERMS_OF_USE_CANONICAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Terms of Use
              </a>
              .
            </span>
          </label>
          <div>
            <button
              type="button"
              data-testid="watch-partner-download-start"
              disabled={busy || !terms || readyFileCount === 0}
              onClick={() => void start(false)}
              className={ACTION_CLASS}
            >
              {starting
                ? "Checking downloads…"
                : `Ask my browser to download ${readyFileCount} ${
                    readyFileCount === 1 ? "file" : "files"
                  }`}
            </button>
          </div>
        </div>
      ) : null}

      {starting ? (
        <div className="mt-4">
          <button
            type="button"
            data-testid="watch-partner-download-stop"
            onClick={stop}
            className={ACTION_CLASS}
          >
            Stop
          </button>
        </div>
      ) : null}

      {run ? (
        <div
          data-testid="watch-partner-download-status"
          role="status"
          aria-live="polite"
          className="mt-6 grid gap-3 text-sm leading-relaxed"
        >
          {run.running ? (
            <>
              <p>
                Asking your browser to start file {run.initiated.length + 1} of{" "}
                {run.total}
                {run.active ? (
                  <>
                    :{" "}
                    <span lang="" dir="auto">
                      {run.active.title}
                    </span>
                  </>
                ) : (
                  ""
                )}
                . Started so far: {run.initiated.length}.
              </p>
              <div>
                <button
                  type="button"
                  data-testid="watch-partner-download-stop"
                  onClick={stop}
                  className={ACTION_CLASS}
                >
                  Stop
                </button>
              </div>
            </>
          ) : (
            <>
              <p data-testid="watch-partner-download-summary">
                {run.canceled ? "Stopped. " : ""}
                Your browser was asked to start {run.initiated.length} of{" "}
                {run.total} {run.total === 1 ? "file" : "files"}.
                {run.pending.length === 0
                  ? " Check your browser’s downloads to see what was saved."
                  : ` ${run.pending.length} ${
                      run.pending.length === 1 ? "was" : "were"
                    } not started.`}
              </p>
              {run.pending.length > 0 ? (
                <>
                  <ul
                    data-testid="watch-partner-download-pending"
                    className="list-disc pl-5 text-white/80"
                  >
                    {run.pending.map(({ item }) => (
                      <li key={item.id} data-queue-id={item.id}>
                        {nameOf(languageOfQueueId(item.id))}:{" "}
                        <span lang="" dir="auto">
                          {item.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <button
                      type="button"
                      data-testid="watch-partner-download-retry"
                      disabled={busy}
                      onClick={() => void start(true)}
                      className={ACTION_CLASS}
                    >
                      Start the {run.pending.length} not started
                    </button>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

function GroupRow({
  group,
  tier,
  disabled,
  onTier,
}: {
  group: Group
  tier: DownloadTier | null
  disabled: boolean
  onTier: (tier: DownloadTier) => void
}) {
  const id = useId()
  const candidates = group.options?.candidates.length ?? 0
  const tiers = group.options?.commonTiers ?? []
  return (
    <li
      data-language-slug={group.languageSlug}
      data-group-status={group.status}
      className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="font-semibold">{group.name}</p>
      {group.status === "ready" ? (
        <>
          <p className="mt-1 text-sm text-white/75">
            {group.collectionTitle}: {candidates} of {group.episodeCount}{" "}
            {group.episodeCount === 1 ? "film has" : "films have"} a download in
            this language
            {candidates < group.episodeCount
              ? "; the others are skipped."
              : "."}
          </p>
          {tiers.length > 1 && tier ? (
            <div className="mt-3 grid max-w-xs gap-1">
              <label htmlFor={id} className="text-sm font-semibold">
                Quality for {group.name}
              </label>
              <select
                id={id}
                value={tier}
                disabled={disabled}
                onChange={(event) => onTier(event.target.value as DownloadTier)}
                className={FIELD_CLASS}
              >
                {tiers.map((option) => (
                  <option key={option} value={option}>
                    {TIER_LABEL[option]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}
      {group.status === "unavailable" ? (
        <p className="mt-1 text-sm text-white/75">
          No downloads are available in {group.name} for this collection, so
          nothing will be downloaded for it.
        </p>
      ) : null}
      {group.status === "failed" ? (
        <p className="mt-1 text-sm text-amber-100">
          We couldn’t check {group.name} right now. Choose Prepare to try again.
        </p>
      ) : null}
    </li>
  )
}
