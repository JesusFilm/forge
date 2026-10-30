"use client"

// Two shapes of the "Grow in faith" tab, ported from the read-only prototype:
//
//   default        three modules, all tied to this film, ~1 screen
//   ?grow=full     the long shelf: verse, nine-session course, new-believer
//                  path, 15 plans, monthly prayer guide
//
// The nine-lesson curriculum and its real progress client load only on the
// long shelf (or when a hosted sign-in returns to a lesson), never on the
// default shape.

import {
  Component,
  type ReactNode,
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"

import styles from "./WatchGrowFocus.module.css"
import type { WatchBibleQuotesBlock } from "@/lib/content"
import { hasWatchGrowReturnIntent } from "@/lib/watch-grow-return-intent"
import {
  getLoadedWatchGrowCourse,
  loadWatchGrowCourse,
} from "./watch-grow-loader"
import { BWJ_SOURCE_PDF } from "@/components/watch/grow-resources"
import {
  WatchGrowLean,
  type NextEpisode,
} from "@/components/watch/WatchGrowLean"
import { WatchGrowPlans } from "@/components/watch/WatchGrowPlans"
import type { WatchGrowProgressCourseProps } from "@/components/watch/WatchGrowProgressCourse"
import { WatchGrowSteps } from "@/components/watch/WatchGrowSteps"
import { WatchGrowVerse } from "@/components/watch/WatchGrowVerse"

export type WatchGrowProps = {
  /** Route, selected language and published configuration identity. */
  optionalContentKey?: string
  citations?: WatchBibleQuotesBlock["bibleCitations"]
  filmTitle?: string
  seriesTitle?: string | null
  episodeCount?: number
  /** 1-based position of this film in its series, when it has one. */
  episodeIndex?: number | null
  nextEpisode?: NextEpisode | null
  /** Passed through to the real-progress course. */
  courseProps?: WatchGrowProgressCourseProps
}

/* Which shape to show, read from the URL through an external store so the
   server snapshot is the short version and nothing sets state in an effect. */
function subscribeToUrl(onChange: () => void) {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

function isFullFromUrl(): boolean {
  // A hosted sign-in started from a lesson returns with that lesson in the
  // address; the course lives on the long shelf, so that is where it lands.
  return (
    new URLSearchParams(window.location.search).get("grow") === "full" ||
    hasWatchGrowReturnIntent()
  )
}

const NO_CITATIONS: WatchBibleQuotesBlock["bibleCitations"] = []

// The optional monthly shelf has its own loading boundary: its rich layout
// must not hold up the returned lesson's actual controls and first text paint.
const WatchGrowPrayer = lazy(() =>
  import("./WatchGrowPrayer").then((module) => ({
    default: module.WatchGrowPrayer,
  })),
)

export function WatchGrow({
  optionalContentKey,
  citations = NO_CITATIONS,
  filmTitle = "Jesus Film Project",
  seriesTitle = null,
  episodeCount = 0,
  episodeIndex = null,
  nextEpisode = null,
  courseProps,
}: WatchGrowProps) {
  const fromUrl = useSyncExternalStore(
    subscribeToUrl,
    isFullFromUrl,
    () => false,
  )
  // The course strips its sign-in return params from the address once read;
  // latch so that cleanup does not drop the visitor back to the short shape.
  const [latched, setLatched] = useState(false)
  if (fromUrl && !latched) setLatched(true)
  const full = fromUrl || latched

  if (full) {
    return (
      <div
        data-testid="watch-grow"
        data-shape="full"
        className={`${styles.controls} w-full min-w-0`}
      >
        <WatchGrowVerse citations={citations} filmTitle={filmTitle} />
        <DeferredCourse {...courseProps} />
        <WatchGrowSteps />
        <WatchGrowPlans />
        <OptionalPrayerBoundary
          key={JSON.stringify([optionalContentKey, filmTitle, citations])}
        >
          <Suspense fallback={null}>
            <WatchGrowPrayer />
          </Suspense>
        </OptionalPrayerBoundary>
        <p className="mt-10 text-[13px] text-white/45">
          <a
            href="?as=grow"
            className="underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
          >
            ← Back to the short version
          </a>
        </p>
      </div>
    )
  }

  return (
    <div
      data-testid="watch-grow"
      data-shape="lean"
      className={`${styles.controls} w-full min-w-0`}
    >
      <WatchGrowLean
        citations={citations}
        filmTitle={filmTitle}
        seriesTitle={seriesTitle}
        episodeCount={episodeCount}
        episodeIndex={episodeIndex}
        nextEpisode={nextEpisode}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
   The course module (curriculum, progress client, session read) is imported
   when the long shelf mounts. Until then, and if the chunk fails, the slot is
   a plain line in the course's own position, never a fake course.
--------------------------------------------------------------------------- */

function DeferredCourse(props: WatchGrowProgressCourseProps) {
  const [Course, setCourse] = useState(getLoadedWatchGrowCourse)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (Course) return
    let cancelled = false
    void loadWatchGrowCourse().then(
      (component) => {
        if (!cancelled) setCourse(() => component)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [Course, attempt])

  if (Course) return <Course {...props} />
  return (
    <section
      data-testid="watch-grow-course"
      data-loading={failed ? undefined : "true"}
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      {failed ? (
        <div role="alert" className="text-[15px] text-white/70">
          <p>The nine lessons could not load.</p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
            <button
              type="button"
              onClick={() => {
                setFailed(false)
                setAttempt((value) => value + 1)
              }}
              className="cursor-pointer underline decoration-white/25 underline-offset-4 hover:text-white"
            >
              Try again
            </button>
            <a
              href={BWJ_SOURCE_PDF}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/25 underline-offset-4 hover:text-white"
            >
              The printed guide (PDF)
            </a>
          </div>
        </div>
      ) : (
        <p role="status" className="text-[13px] text-white/45">
          Loading the nine lessons…
        </p>
      )}
    </section>
  )
}

// Suspense handles pending imports, not rejected imports or render failures.
// Keep this optional shelf's failure inside its own slot. React.lazy caches
// rejected imports, so a prayer retry button would misleadingly rethrow the
// same rejection even when the bundler permits a new chunk request.
// A new content scope resets render errors; a fresh navigation can
// fetch a failed chunk again without sacrificing the usable lesson controls.
class OptionalPrayerBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <p
          role="status"
          lang="en"
          dir="ltr"
          className="mt-12 text-[15px] text-white/70"
        >
          The prayer guide is unavailable. You can continue with the lessons and
          plans.
        </p>
      )
    }
    return this.props.children
  }
}
