"use client"

import {
  type CSSProperties,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { MediaCollection } from "@/components/sections/MediaCollection"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { loadDynamicCollectionFeedPage } from "@/lib/dynamic-collection-client"
import {
  DynamicCollectionFeedRequestError,
  WATCH_COLLECTION_FEED_PROFILES,
  mergeDynamicCollectionFeedExcludedIds,
  type DynamicCollectionFeedCacheSignatures,
  type DynamicCollectionFeedCacheScope,
  type DynamicCollectionFeedProfile,
  type DynamicCollectionFeedSection,
} from "@/lib/dynamic-collection-contract"
import type { FeaturedCollectionReferences } from "@/lib/featured-collection-references"

type DynamicMediaCollectionBlock = {
  id?: string | null
  sectionKey?: string | null
  categoryLabel?: string | null
  title?: string | null
  subtitle?: string | null
  mediaDescription?: string | null
  excludedVideoIds?: readonly string[] | null
  backgroundColor?: string | null
  showItemNumbers?: boolean | null
  thumbnailOrientation?: "vertical" | "horizontal" | null
}

type DynamicMediaCollectionProps = {
  data: DynamicMediaCollectionBlock
  locale: string
  languageSlug: string
  featuredCollections?: FeaturedCollectionReferences
  cacheScope?: DynamicCollectionFeedCacheScope
  cacheSignatures?: DynamicCollectionFeedCacheSignatures
}

const MAX_DUPLICATE_ONLY_PAGES_PER_ATTEMPT = 3
const DUPLICATE_ONLY_REARM_DELAY_MS = 250
const WINDOWING_THRESHOLD = 9
const MAX_OBSERVER_MANAGED_MOUNTS = 10
const OVERSCAN_VIEWPORTS_ABOVE = 4
const OVERSCAN_VIEWPORTS_BELOW = 2

type RowVisibility = {
  isIntersecting: boolean
  top: number
  bottom: number
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false
  for (const id of left) {
    if (!right.has(id)) return false
  }
  return true
}

function feedProfile(): DynamicCollectionFeedProfile {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return WATCH_COLLECTION_FEED_PROFILES.desktop
  }
  return window.matchMedia("(max-width: 767px)").matches ||
    window.matchMedia("(pointer: coarse)").matches
    ? WATCH_COLLECTION_FEED_PROFILES.mobile
    : WATCH_COLLECTION_FEED_PROFILES.desktop
}

function mediaCollectionData(
  block: DynamicMediaCollectionBlock,
  section: DynamicCollectionFeedSection,
) {
  return {
    __typename: "MediaCollectionBlock",
    id: `dynamic-${section.id}`,
    t: "mediaCollection",
    sectionKey: `dynamic-${section.id}`,
    title: section.title,
    subtitle: null,
    mediaDescription: section.description,
    backgroundColor: block.backgroundColor ?? null,
    categoryLabel: block.categoryLabel ?? "Collection",
    itemsSource: "manual",
    mediaCtaLink: null,
    mediaCtaLabel: null,
    mediaDefaultCollectionSlug: section.slug,
    showItemNumbers: block.showItemNumbers ?? false,
    mediaCollectionVariant: "carousel",
    thumbnailOrientation: block.thumbnailOrientation ?? "horizontal",
    footerText: null,
    imageAssetId: null,
    imageAsset: null,
    items: section.items.map((item) => ({
      videoId: item.id,
      coreId: item.coreId,
      videoSlug: item.videoSlug,
      languageSlug: item.languageSlug,
      resolvedTitle: item.title,
      titleOverride: null,
      subtitleOverride: null,
      labelOverride: item.label,
      collectionSize: null,
      imageAssetId: null,
      imageAsset: null,
      videoImage: {
        previewUrl: item.imageUrl,
        blurDataUrl: item.blurDataUrl,
        dominantColor: item.dominantColor,
      },
      videoDub: {
        language: { slug: item.languageSlug },
        muxVideo: { playbackId: item.muxPlaybackId },
      },
      linkToSectionKey: null,
    })),
  } as unknown as Parameters<typeof MediaCollection>[0]["data"]
}

export function DynamicMediaCollection({
  data,
  locale,
  languageSlug,
  featuredCollections = { ids: [], slugs: [] },
  cacheScope = "live",
  cacheSignatures,
}: DynamicMediaCollectionProps) {
  const excludedIds = useMemo(
    () =>
      mergeDynamicCollectionFeedExcludedIds(
        data.excludedVideoIds,
        featuredCollections.ids,
      ),
    [data.excludedVideoIds, featuredCollections.ids],
  )
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const requestInFlightRef = useRef(false)
  const requestAbortRef = useRef<AbortController | null>(null)
  const lifecycleRef = useRef(0)
  const sentinelEligibleRef = useRef(false)
  const statusRef = useRef<"idle" | "loading" | "error">("idle")
  const cursorRef = useRef<string | null>(null)
  const hasNextPageRef = useRef(true)
  const seenIdsRef = useRef(new Set(excludedIds))
  const seenSlugsRef = useRef(new Set(featuredCollections.slugs))
  const profileRef = useRef<DynamicCollectionFeedProfile>(feedProfile())
  const cacheSignatureRef = useRef<string | null>(null)
  const loadNextPageRef = useRef<(manualRetry?: boolean) => Promise<void>>(
    async () => undefined,
  )
  const sectionsRef = useRef<DynamicCollectionFeedSection[]>([])
  const rowNodesRef = useRef(new Map<string, HTMLDivElement>())
  const rowRefCallbacksRef = useRef(
    new Map<string, RefCallback<HTMLDivElement>>(),
  )
  const rowVisibilityRef = useRef(new Map<string, RowVisibility>())
  const rowHeightsRef = useRef(new Map<string, number>())
  const provisionalHeightIdsRef = useRef(new Set<string>())
  const rowIntersectionObserverRef = useRef<IntersectionObserver | null>(null)
  const rowResizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeObservedIdsRef = useRef(new Set<string>())
  const resizeFrameRef = useRef<number | null>(null)
  const mountedSectionIdsRef = useRef(new Set<string>())
  const focusedSectionIdsRef = useRef(new Set<string>())
  const selectedSnapsRef = useRef(new Map<string, number>())
  const retryAvailableAtRef = useRef(0)
  const [sections, setSections] = useState<DynamicCollectionFeedSection[]>([])
  sectionsRef.current = sections
  const [hasNextPage, setHasNextPage] = useState(true)
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [mountedSectionIds, setMountedSectionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [focusedSectionIds, setFocusedSectionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [viewportRevision, setViewportRevision] = useState(0)
  const [liveMessage, setLiveMessage] = useState(
    "More collections load as you scroll.",
  )
  const [retrySeconds, setRetrySeconds] = useState(0)
  const windowingActive = sections.length > WINDOWING_THRESHOLD
  const feedIdentity = `${locale}\0${languageSlug}\0${cacheScope}\0${excludedIds.join(
    "\0",
  )}\0${featuredCollections.slugs.join("\0")}\0${cacheSignatures?.mobile ?? ""}\0${cacheSignatures?.desktop ?? ""}`

  const setFeedStatus = useCallback((next: "idle" | "loading" | "error") => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const updateMountedSectionIds = useCallback((next: Set<string>) => {
    if (sameIds(mountedSectionIdsRef.current, next)) return
    mountedSectionIdsRef.current = next
    setMountedSectionIds(next)
  }, [])

  const reconcileMountedSections = useCallback(() => {
    const currentSections = sectionsRef.current
    const ids = currentSections.map((section) => section.id)
    if (ids.length <= WINDOWING_THRESHOLD) {
      updateMountedSectionIds(new Set(ids))
      return
    }

    const viewportHeight = Math.max(window.innerHeight, 1)
    const validIds = new Set(ids)
    const candidates = [...rowVisibilityRef.current]
      .flatMap(([id, observedRow]) => {
        if (!validIds.has(id) || !observedRow.isIntersecting) return []
        const liveRect = rowNodesRef.current.get(id)?.getBoundingClientRect()
        const row =
          liveRect &&
          (liveRect.height > 0 || liveRect.top !== 0 || liveRect.bottom !== 0)
            ? liveRect
            : observedRow
        const distance =
          row.bottom < 0
            ? Math.abs(row.bottom) * 0.75
            : row.top > viewportHeight
              ? row.top - viewportHeight
              : 0
        return [{ id, distance }]
      })
      .sort((left, right) => left.distance - right.distance)
      .slice(0, MAX_OBSERVER_MANAGED_MOUNTS)
      .map(({ id }) => id)

    const observerManaged =
      candidates.length > 0
        ? candidates
        : ids
            .filter((id) => mountedSectionIdsRef.current.has(id))
            .slice(0, MAX_OBSERVER_MANAGED_MOUNTS)
    const next = new Set(observerManaged)
    const pinnedIds = new Set([
      ...mountedSectionIdsRef.current,
      ...focusedSectionIdsRef.current,
    ])
    for (const id of pinnedIds) {
      if (!validIds.has(id)) continue
      const node = rowNodesRef.current.get(id)
      const hasFocus = Boolean(
        node &&
        document.activeElement instanceof Node &&
        node.contains(document.activeElement),
      )
      if (hasFocus) focusedSectionIdsRef.current.add(id)

      // A row is never replaced by a shell until its real, non-zero height is
      // known. This can briefly exceed the steady-state cap while a new page is
      // being measured, but prevents an unmeasured row from collapsing.
      if (
        (mountedSectionIdsRef.current.has(id) &&
          !rowHeightsRef.current.has(id)) ||
        focusedSectionIdsRef.current.has(id) ||
        hasFocus
      ) {
        next.add(id)
      }
    }
    updateMountedSectionIds(next)
  }, [updateMountedSectionIds])

  const rowRefFor = useCallback((id: string) => {
    const existing = rowRefCallbacksRef.current.get(id)
    if (existing) return existing

    const callback: RefCallback<HTMLDivElement> = (node) => {
      const previous = rowNodesRef.current.get(id)
      if (previous) {
        rowIntersectionObserverRef.current?.unobserve(previous)
        rowResizeObserverRef.current?.unobserve(previous)
        resizeObservedIdsRef.current.delete(id)
      }
      if (node) {
        rowNodesRef.current.set(id, node)
        rowIntersectionObserverRef.current?.observe(node)
        if (mountedSectionIdsRef.current.has(id)) {
          rowResizeObserverRef.current?.observe(node)
          resizeObservedIdsRef.current.add(id)
        }
      } else {
        rowNodesRef.current.delete(id)
        rowVisibilityRef.current.delete(id)
        resizeObservedIdsRef.current.delete(id)
      }
    }
    rowRefCallbacksRef.current.set(id, callback)
    return callback
  }, [])

  useEffect(() => {
    const lifecycle = lifecycleRef.current + 1
    lifecycleRef.current = lifecycle
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    requestInFlightRef.current = false
    cursorRef.current = null
    hasNextPageRef.current = true
    seenIdsRef.current = new Set(excludedIds)
    seenSlugsRef.current = new Set(featuredCollections.slugs)
    profileRef.current = feedProfile()
    cacheSignatureRef.current =
      profileRef.current.first === WATCH_COLLECTION_FEED_PROFILES.mobile.first
        ? (cacheSignatures?.mobile ?? null)
        : (cacheSignatures?.desktop ?? null)
    rowVisibilityRef.current.clear()
    rowHeightsRef.current.clear()
    provisionalHeightIdsRef.current.clear()
    selectedSnapsRef.current.clear()
    focusedSectionIdsRef.current.clear()
    mountedSectionIdsRef.current = new Set()
    setSections([])
    setMountedSectionIds(new Set())
    setFocusedSectionIds(new Set())
    setHasNextPage(true)
    setFeedStatus("idle")
    setLiveMessage("More collections load as you scroll.")
    retryAvailableAtRef.current = 0
    setRetrySeconds(0)

    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1
      requestAbortRef.current?.abort()
      requestAbortRef.current = null
      requestInFlightRef.current = false
    }
    // The serialized identity deliberately restarts only when feed inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedIdentity, setFeedStatus])

  useEffect(() => {
    if (retrySeconds <= 0) return
    const timeout = window.setTimeout(() => {
      const remaining = Math.max(
        0,
        Math.ceil((retryAvailableAtRef.current - Date.now()) / 1000),
      )
      setRetrySeconds(remaining)
      if (remaining === 0) retryAvailableAtRef.current = 0
    }, 1000)
    return () => window.clearTimeout(timeout)
  }, [retrySeconds])

  useEffect(() => {
    const ids = sections.map((section) => section.id)
    const validIds = new Set(ids)
    for (const storedId of rowHeightsRef.current.keys()) {
      if (!validIds.has(storedId)) rowHeightsRef.current.delete(storedId)
    }
    for (const storedId of rowRefCallbacksRef.current.keys()) {
      if (!validIds.has(storedId)) rowRefCallbacksRef.current.delete(storedId)
    }

    if (sections.length <= WINDOWING_THRESHOLD) {
      updateMountedSectionIds(new Set(ids))
      return
    }

    // Newly retained rows mount once so their exact restoration height can be
    // recorded. The shared observers then reduce the active set to the window.
    const withUnmeasuredRows = new Set(mountedSectionIdsRef.current)
    for (const id of ids) {
      if (!rowHeightsRef.current.has(id)) withUnmeasuredRows.add(id)
    }
    updateMountedSectionIds(withUnmeasuredRows)
  }, [sections, updateMountedSectionIds])

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    const observedIds = resizeObservedIdsRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-collection-id")
        if (!id || !mountedSectionIdsRef.current.has(id)) continue
        const height = entry.contentRect.height
        if (height <= 0) continue
        rowHeightsRef.current.set(id, height)
        provisionalHeightIdsRef.current.delete(id)
      }
      reconcileMountedSections()
    })
    rowResizeObserverRef.current = observer
    for (const [id, node] of rowNodesRef.current) {
      if (mountedSectionIdsRef.current.has(id)) {
        observer.observe(node)
        observedIds.add(id)
      }
    }
    return () => {
      observer.disconnect()
      if (rowResizeObserverRef.current === observer) {
        rowResizeObserverRef.current = null
      }
      observedIds.clear()
    }
  }, [feedIdentity, reconcileMountedSections])

  useEffect(() => {
    const observer = rowResizeObserverRef.current
    if (!observer) return
    for (const id of [...resizeObservedIdsRef.current]) {
      if (mountedSectionIds.has(id)) continue
      const node = rowNodesRef.current.get(id)
      if (node) observer.unobserve(node)
      resizeObservedIdsRef.current.delete(id)
    }
    for (const id of mountedSectionIds) {
      if (resizeObservedIdsRef.current.has(id)) continue
      const node = rowNodesRef.current.get(id)
      if (!node) continue
      observer.observe(node)
      resizeObservedIdsRef.current.add(id)
    }
  }, [mountedSectionIds])

  useEffect(() => {
    if (!windowingActive) return
    const viewportHeight = Math.max(window.innerHeight, 1)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-collection-id")
          if (!id) continue
          rowVisibilityRef.current.set(id, {
            isIntersecting: entry.isIntersecting,
            top: entry.boundingClientRect.top,
            bottom: entry.boundingClientRect.bottom,
          })
        }
        reconcileMountedSections()
      },
      {
        rootMargin: `${viewportHeight * OVERSCAN_VIEWPORTS_ABOVE}px 0px ${
          viewportHeight * OVERSCAN_VIEWPORTS_BELOW
        }px`,
      },
    )
    rowIntersectionObserverRef.current = observer
    for (const node of rowNodesRef.current.values()) observer.observe(node)
    return () => {
      observer.disconnect()
      if (rowIntersectionObserverRef.current === observer) {
        rowIntersectionObserverRef.current = null
      }
    }
  }, [
    feedIdentity,
    reconcileMountedSections,
    viewportRevision,
    windowingActive,
  ])

  useEffect(() => {
    const handleResize = () => {
      if (resizeFrameRef.current !== null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        for (const id of rowHeightsRef.current.keys()) {
          provisionalHeightIdsRef.current.add(id)
        }
        setViewportRevision((revision) => revision + 1)
      })
    }
    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [feedIdentity])

  const pinFocusedSection = useCallback(
    (id: string) => {
      if (
        focusedSectionIdsRef.current.has(id) &&
        mountedSectionIdsRef.current.has(id)
      ) {
        return
      }
      const nextFocused = new Set(focusedSectionIdsRef.current)
      nextFocused.add(id)
      focusedSectionIdsRef.current = nextFocused
      setFocusedSectionIds(nextFocused)
      if (!mountedSectionIdsRef.current.has(id)) {
        const nextMounted = new Set(mountedSectionIdsRef.current)
        nextMounted.add(id)
        updateMountedSectionIds(nextMounted)
      }
    },
    [updateMountedSectionIds],
  )

  const releaseFocusedSection = useCallback(
    (id: string, relatedTarget: EventTarget | null) => {
      const node = rowNodesRef.current.get(id)
      if (node?.contains(relatedTarget as Node | null)) return
      const nextFocused = new Set(focusedSectionIdsRef.current)
      nextFocused.delete(id)
      focusedSectionIdsRef.current = nextFocused
      setFocusedSectionIds(nextFocused)
      reconcileMountedSections()
    },
    [reconcileMountedSections],
  )

  const loadNextPage = useCallback(
    async (manualRetry = false) => {
      if (
        requestInFlightRef.current ||
        !hasNextPageRef.current ||
        Date.now() < retryAvailableAtRef.current ||
        (!manualRetry && statusRef.current === "error")
      ) {
        return
      }

      const lifecycle = lifecycleRef.current
      const controller = new AbortController()
      requestAbortRef.current = controller
      requestInFlightRef.current = true
      retryAvailableAtRef.current = 0
      setRetrySeconds(0)
      setFeedStatus("loading")
      setLiveMessage("Loading more collections…")
      let shouldRearm = false

      try {
        let requestCursor = cursorRef.current
        let requests = 0
        let appendedCount = 0

        while (requests < MAX_DUPLICATE_ONLY_PAGES_PER_ATTEMPT) {
          const page = await loadDynamicCollectionFeedPage(
            {
              locale,
              languageSlug,
              cacheScope,
              cacheSignature: cacheSignatureRef.current,
              after: requestCursor,
              excludedIds,
              excludedSlugs: featuredCollections.slugs,
              ...profileRef.current,
            },
            { signal: controller.signal },
          )
          if (lifecycleRef.current !== lifecycle || controller.signal.aborted) {
            return
          }
          requests += 1
          cacheSignatureRef.current = page.nextCacheSignature ?? null

          const uniqueSections = page.sections.filter((section) => {
            if (
              seenIdsRef.current.has(section.id) ||
              seenSlugsRef.current.has(section.slug)
            ) {
              return false
            }
            seenIdsRef.current.add(section.id)
            seenSlugsRef.current.add(section.slug)
            return true
          })
          const cursorAdvanced = page.endCursor !== requestCursor
          requestCursor = page.endCursor
          cursorRef.current = requestCursor
          hasNextPageRef.current = page.hasNextPage && cursorAdvanced

          if (uniqueSections.length > 0) {
            appendedCount = uniqueSections.length
            setSections((current) => [...current, ...uniqueSections])
            break
          }
          if (!hasNextPageRef.current) break
        }

        setHasNextPage(hasNextPageRef.current)
        setFeedStatus("idle")
        if (appendedCount > 0) {
          setLiveMessage(
            `Loaded ${appendedCount} more ${
              appendedCount === 1 ? "collection" : "collections"
            }.`,
          )
        } else if (!hasNextPageRef.current) {
          setLiveMessage("You’ve reached the end of the collection library.")
        }
        shouldRearm =
          appendedCount === 0 &&
          hasNextPageRef.current &&
          requests === MAX_DUPLICATE_ONLY_PAGES_PER_ATTEMPT
      } catch (error) {
        if (lifecycleRef.current !== lifecycle || controller.signal.aborted) {
          return
        }
        setFeedStatus("error")
        if (
          error instanceof DynamicCollectionFeedRequestError &&
          error.code === "rate_limited"
        ) {
          const seconds = error.retryAfterSeconds ?? 60
          retryAvailableAtRef.current = Date.now() + seconds * 1000
          setRetrySeconds(seconds)
          setLiveMessage(
            `More collections are temporarily limited. Try again in ${seconds} seconds.`,
          )
        } else {
          retryAvailableAtRef.current = 0
          setRetrySeconds(0)
          setLiveMessage("More collections could not be loaded. Try again.")
        }
      } finally {
        if (lifecycleRef.current === lifecycle) {
          requestInFlightRef.current = false
          if (requestAbortRef.current === controller) {
            requestAbortRef.current = null
          }
          if (shouldRearm) {
            window.setTimeout(() => {
              if (
                lifecycleRef.current === lifecycle &&
                sentinelEligibleRef.current
              ) {
                void loadNextPageRef.current()
              }
            }, DUPLICATE_ONLY_REARM_DELAY_MS)
          }
        }
      }
    },
    [
      excludedIds,
      cacheScope,
      featuredCollections.slugs,
      languageSlug,
      locale,
      setFeedStatus,
    ],
  )
  loadNextPageRef.current = loadNextPage

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        sentinelEligibleRef.current = entries.some(
          (entry) => entry.isIntersecting,
        )
        if (sentinelEligibleRef.current) void loadNextPageRef.current()
      },
      { rootMargin: "900px 0px" },
    )
    observer.observe(sentinel)
    return () => {
      sentinelEligibleRef.current = false
      observer.disconnect()
    }
  }, [feedIdentity, hasNextPage])

  return (
    <section
      id={data.sectionKey ?? data.id ?? undefined}
      data-testid="dynamic-media-collection-feed"
      aria-busy={status === "loading"}
    >
      {sections.map((section, index) => {
        const measuredHeight = rowHeightsRef.current.get(section.id)
        const isMounted =
          sections.length <= WINDOWING_THRESHOLD ||
          mountedSectionIds.has(section.id) ||
          measuredHeight == null
        const isFocused = focusedSectionIds.has(section.id)
        const shellStyle: CSSProperties | undefined =
          !isMounted && measuredHeight
            ? { height: `${measuredHeight}px` }
            : undefined

        return (
          <div
            key={section.id}
            ref={rowRefFor(section.id)}
            data-testid="dynamic-collection-row"
            data-collection-id={section.id}
            data-window-state={isMounted ? "mounted" : "shell"}
            data-height-state={
              provisionalHeightIdsRef.current.has(section.id)
                ? "provisional"
                : "measured"
            }
            tabIndex={!isMounted || isFocused ? 0 : undefined}
            aria-label={
              !isMounted
                ? `${section.title}, collection ${index + 1} of ${sections.length}`
                : undefined
            }
            className={
              !isMounted
                ? "relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                : undefined
            }
            style={shellStyle}
            onFocusCapture={() => pinFocusedSection(section.id)}
            onBlurCapture={(event) =>
              releaseFocusedSection(section.id, event.relatedTarget)
            }
          >
            {isMounted ? (
              <MediaCollection
                data={mediaCollectionData(data, section)}
                languageSlug={languageSlug}
                initialSelectedSnap={selectedSnapsRef.current.get(section.id)}
                onSelectedSnapChange={(snap) =>
                  selectedSnapsRef.current.set(section.id, snap)
                }
              />
            ) : (
              <span className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/45 px-4 py-2 text-xs font-semibold text-white/80">
                {section.title} · {index + 1} of {sections.length}
              </span>
            )}
          </div>
        )
      })}

      <div
        ref={sentinelRef}
        className={`${WATCH_PAGE_CONTENT_CLASSES} flex min-h-28 items-center justify-center py-8`}
        aria-live="polite"
      >
        {status === "error" ? (
          <button
            type="button"
            onClick={() => void loadNextPage(true)}
            disabled={retrySeconds > 0}
            className="rounded-full border border-white/35 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {retrySeconds > 0
              ? `Try loading more collections again in ${retrySeconds}s`
              : "Try loading more collections again"}
          </button>
        ) : !hasNextPage ? (
          <p className="text-sm text-stone-400">
            You’ve reached the end of the collection library.
          </p>
        ) : (
          <p
            className={
              status === "loading" ? "text-sm text-stone-300" : "sr-only"
            }
          >
            {liveMessage}
          </p>
        )}
      </div>
    </section>
  )
}
