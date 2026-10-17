"use client"

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react"

import { LESSONS, type LessonId } from "@/lib/beginning-with-jesus"
import {
  createLearningProgressClient,
  readWatchGrowReturn,
  watchGrowLoginUrl,
  withoutWatchGrowReturn,
  type LearningAccount,
  type LearningTransport,
  type LearningProgressClient,
  type LearningSnapshot,
  type LessonView,
  type WatchGrowReturn,
} from "@/lib/watch-learning-progress-client"
import {
  useWatchAccountSession,
  type WatchAccountSession,
} from "./use-watch-account-session"
import {
  watchLearningDrafts,
  type WatchLearningDraftStore,
} from "./watch-learning-drafts"
import {
  WatchGrowCourse,
  type WatchGrowCourseProps,
  type WatchGrowLessonContext,
  type WatchGrowLessonProgress,
} from "./WatchGrowCourse"
import type { WatchGrowStoryProps } from "./WatchGrowStory"

// The course with honest account progress (feat-731 U10). WatchGrow loads this
// module only after the course-open intent, inside its Dialog, so the session
// read and the progress read happen only for visitors who open the course.
//
// Anonymous progress lives in this page only and says so. Saving to an
// account is an explicit request that goes through the existing hosted sign-in
// and comes back to the same lesson and card, still unsaved until the visitor
// saves again. Signed-in changes made with the step and completion controls
// are saved; failures and conflicts stay visible with a retry or a choice.

export type WatchGrowProgressCourseProps = WatchGrowCourseProps & {
  /** Test seam; the default is one client per page shared across re-opens. */
  client?: LearningProgressClient
  /** Test seam; the default reads the session route through the U6 hook. */
  useSession?: () => {
    session: WatchAccountSession
    retry: () => void
    revalidating?: boolean
  }
}

let pageClient: LearningProgressClient | null = null
const staleIdentity = { retry: () => {} }

/** The page's progress client, wired to the shared drafts and session retry. */
export function createWatchGrowLearningClient({
  transport,
  drafts = watchLearningDrafts,
}: {
  transport?: LearningTransport
  drafts?: WatchLearningDraftStore
} = {}) {
  return createLearningProgressClient({
    transport,
    // Reflections typed by one person must not appear for another.
    onAccountCleared: () => drafts.clear(),
    onStaleIdentity: () => staleIdentity.retry(),
  })
}

/** One client per page, so closing and re-opening keeps unsaved state honest. */
function defaultClient() {
  pageClient ??= createWatchGrowLearningClient()
  return pageClient
}

function toAccount(session: WatchAccountSession): LearningAccount {
  if (session.status === "signed-out") return { kind: "anonymous" }
  if (session.status === "signed-in") {
    // Without a stable account id, cached progress could not be isolated.
    return session.user?.id
      ? { kind: "signed-in", userId: session.user.id }
      : { kind: "unavailable" }
  }
  return { kind: session.status }
}

export function WatchGrowProgressCourse({
  client: injected,
  useSession = useWatchAccountSession,
  initialLessonId,
  initialStory,
  ...courseProps
}: WatchGrowProgressCourseProps) {
  const [client] = useState(() => injected ?? defaultClient())
  const { session, retry, revalidating = false } = useSession()
  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  // Read once from the address the hosted sign-in returned to; the params are
  // removed below so a reload or a shared link cannot replay the restore.
  const [returned] = useState<WatchGrowReturn | null>(() =>
    readWatchGrowReturn(),
  )
  const [launch, setLaunch] = useState(() => ({
    key: 0,
    lessonId: returned?.lessonId ?? initialLessonId ?? "lesson-1",
    cardId: returned?.cardId ?? null,
    story: Boolean(returned?.cardId) || Boolean(initialStory),
  }))
  const [lessonId, setLessonId] = useState<LessonId>(launch.lessonId)
  // The visitor's place in this page: the story card they are on, if any. It
  // seeds the story when re-opened and the return address for sign-in.
  const [position, setPosition] = useState<{
    lessonId: LessonId
    cardId: string
    inStory: boolean
  } | null>(() =>
    launch.cardId
      ? { lessonId: launch.lessonId, cardId: launch.cardId, inStory: true }
      : null,
  )

  useEffect(() => {
    if (!returned) return
    window.history.replaceState(
      window.history.state,
      "",
      withoutWatchGrowReturn(),
    )
  }, [returned])

  useEffect(() => {
    staleIdentity.retry = retry
  }, [retry])

  // A pending focus re-read may be about to report another account (signed in
  // through another tab), so writes hold until it answers. The hold changes
  // nothing visible; the answer then confirms the account or replaces it.
  useEffect(() => {
    if (revalidating) {
      client.hold()
      return
    }
    client.setAccount(toAccount(session))
    client.release()
  }, [client, session, revalidating])

  // Coalesced resume writes are sent when the course closes or the page is
  // hidden; keepalive lets them finish while the page goes away.
  useEffect(() => {
    const flush = () => client.flush({ keepalive: true })
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush()
    }
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onVisibility)
      flush()
    }
  }, [client])

  const progress: Partial<Record<LessonId, WatchGrowLessonProgress>> = {}
  for (const [id, view] of Object.entries(snapshot.lessons)) {
    progress[id as LessonId] = {
      completedStepIds: view.completedStepIds,
      completed: view.completed,
    }
  }

  function renderStory(context: WatchGrowLessonContext) {
    const id = context.lesson.id
    return (
      <DeferredStory
        {...context}
        initialCardId={
          (position?.lessonId === id ? position.cardId : null) ??
          snapshot.lessons[id]?.resumeCardId
        }
        onCardChange={(cardId) => {
          setPosition({ lessonId: id, cardId, inStory: true })
          client.setResume(id, cardId)
        }}
        showSheet={() => {
          setPosition((previous) =>
            previous ? { ...previous, inStory: false } : null,
          )
          context.showSheet()
        }}
      />
    )
  }
  const currentCard =
    position?.lessonId === lessonId && position.inStory ? position.cardId : null

  const resume = resumeTarget(snapshot, lessonId)

  return (
    <WatchGrowCourse
      key={launch.key}
      {...courseProps}
      initialLessonId={launch.lessonId}
      initialStory={launch.story}
      progress={progress}
      drafts={courseProps.drafts ?? watchLearningDrafts}
      onProgressChange={(change) =>
        client.change(change.lessonId, change.progress)
      }
      onLessonChange={(next) => {
        setLessonId(next)
        courseProps.onLessonChange?.(next)
      }}
      renderStory={renderStory}
      progressStatus={
        <ProgressStatus
          lessonId={lessonId}
          snapshot={snapshot}
          session={session}
          returned={returned}
          client={client}
          onRetrySession={retry}
          currentCard={currentCard}
          resume={resume}
          onResume={(target) => {
            setPosition({ ...target, inStory: true })
            setLessonId(target.lessonId)
            setLaunch((previous) => ({
              key: previous.key + 1,
              lessonId: target.lessonId,
              cardId: target.cardId,
              story: true,
            }))
          }}
        />
      }
    />
  )
}

/** First saved, unfinished lesson elsewhere with a stored position. */
function resumeTarget(snapshot: LearningSnapshot, current: LessonId) {
  if (snapshot.account !== "signed-in" || snapshot.load !== "loaded")
    return null
  for (const lesson of LESSONS) {
    const view = snapshot.lessons[lesson.id]
    if (lesson.id === current || !view?.saved || view.completed) continue
    if (view.resumeCardId)
      return { lessonId: lesson.id, n: lesson.n, cardId: view.resumeCardId }
  }
  return null
}

/* ---------------------------------------------------------------------------
   Deferred story: imported only after "Read as story".
--------------------------------------------------------------------------- */

let loadedStory: ComponentType<WatchGrowStoryProps> | null = null

function DeferredStory(props: WatchGrowStoryProps) {
  const [Story, setStory] = useState(() => loadedStory)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (Story) return
    let cancelled = false
    void import("./WatchGrowStory").then(
      (module) => {
        loadedStory = module.WatchGrowStory
        if (!cancelled) setStory(() => module.WatchGrowStory)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [Story, attempt])

  if (Story) return <Story {...props} />
  if (failed) {
    return (
      <div role="alert" className="mt-6">
        <p>The story view could not load. The lesson sheet still works.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            className={ACTION}
            onClick={() => {
              setFailed(false)
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
          <button type="button" className={ACTION} onClick={props.showSheet}>
            Back to lesson sheet
          </button>
        </div>
      </div>
    )
  }
  return (
    <p role="status" className="mt-6">
      Opening the story…
    </p>
  )
}

/* ---------------------------------------------------------------------------
   Status. Never says Saved unless the server confirmed this exact state.
--------------------------------------------------------------------------- */

const ACTION =
  "min-h-11 cursor-pointer rounded-full border border-current/25 px-4 py-2 text-sm font-semibold hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
const LINK =
  "inline-flex min-h-11 items-center rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950"

const ERROR_TEXT: Record<NonNullable<LessonView["error"]>, string> = {
  network: "Not saved. You appear to be offline.",
  upstream: "Not saved. The progress service had a problem.",
  invalid: "Not saved. This change could not be accepted.",
  forbidden: "Not saved. This account cannot save progress.",
  unauthorized: "Not saved. Your session ended; sign in again to save.",
}

function ProgressStatus({
  lessonId,
  snapshot,
  session,
  returned,
  client,
  onRetrySession,
  currentCard,
  resume,
  onResume,
}: {
  lessonId: LessonId
  snapshot: LearningSnapshot
  session: WatchAccountSession
  returned: WatchGrowReturn | null
  client: LearningProgressClient
  onRetrySession: () => void
  currentCard: string | null
  resume: ReturnType<typeof resumeTarget>
  onResume: (target: { lessonId: LessonId; cardId: string }) => void
}) {
  const [asking, setAsking] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const view = snapshot.lessons[lessonId]
  const lesson = LESSONS.find((item) => item.id === lessonId)!
  const state = (() => {
    if (snapshot.account === "checking") return "checking"
    if (snapshot.account === "unavailable") return "unavailable"
    if (snapshot.account === "anonymous") return "anonymous"
    return "signed-in"
  })()

  return (
    <div data-testid="watch-grow-progress" data-progress-state={state}>
      {state === "checking" ? (
        <p>Checking your account. Progress is not saved yet.</p>
      ) : null}

      {state === "unavailable" ? (
        <div>
          <p>
            We could not confirm your account, so progress is not being saved.
          </p>
          <button
            type="button"
            className={`${ACTION} mt-2`}
            onClick={onRetrySession}
          >
            Try again
          </button>
        </div>
      ) : null}

      {state === "anonymous" ? (
        <div>
          {returned?.authFailed ? (
            <p className="font-semibold">
              Sign-in did not finish. Nothing was saved; you can keep going.
            </p>
          ) : null}
          <p>
            Progress is not saved to an account. It lasts while this page is
            open.
          </p>
          {asking ? (
            <div className="mt-3 rounded-xl border border-stone-400/60 p-4">
              <p>
                Signing in leaves this page and brings you back to Lesson{" "}
                {lesson.n}
                {currentCard ? " at the same card" : ""}. Checked steps and
                reflections in this tab are not carried over. After you return,
                choose Save to keep this lesson in your account.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <a
                  className={LINK}
                  data-testid="watch-grow-sign-in"
                  href={watchGrowLoginUrl(
                    lessonId,
                    currentCard,
                    session.status === "signed-out"
                      ? session.loginUrl
                      : undefined,
                  )}
                >
                  Continue to sign in
                </a>
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => setAsking(false)}
                >
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${ACTION} mt-2`}
              onClick={() => setAsking(true)}
            >
              Save progress to an account
            </button>
          )}
        </div>
      ) : null}

      {state === "signed-in" ? (
        <div>
          {snapshot.load === "loading" || snapshot.load === "idle" ? (
            <p>Loading your saved progress…</p>
          ) : snapshot.load === "error" ? (
            <div>
              <p>
                Your saved progress could not load. Changes here are not saved.
              </p>
              <button
                type="button"
                className={`${ACTION} mt-2`}
                onClick={() => client.refresh()}
              >
                Try again
              </button>
            </div>
          ) : (
            <LessonStatus
              view={view}
              lessonN={lesson.n}
              returned={Boolean(returned && !returned.authFailed)}
              confirmReset={confirmReset}
              setConfirmReset={setConfirmReset}
              onSave={() => client.save(lessonId)}
              onRetry={() => client.retry(lessonId)}
              onKeepMine={() => client.keepMine(lessonId)}
              onUseSaved={() => client.useSaved(lessonId)}
              onReset={() => {
                setConfirmReset(false)
                client.reset(lessonId)
              }}
            />
          )}
          {resume ? (
            <button
              type="button"
              className={`${ACTION} mt-2`}
              onClick={() => onResume(resume)}
            >
              Continue Lesson {resume.n} where you left off
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function LessonStatus({
  view,
  lessonN,
  returned,
  confirmReset,
  setConfirmReset,
  onSave,
  onRetry,
  onKeepMine,
  onUseSaved,
  onReset,
}: {
  view: LessonView | undefined
  lessonN: number
  returned: boolean
  confirmReset: boolean
  setConfirmReset: (value: boolean) => void
  onSave: () => void
  onRetry: () => void
  onKeepMine: () => void
  onUseSaved: () => void
  onReset: () => void
}) {
  const status = view?.status ?? "idle"
  if (status === "saving") return <p>Saving…</p>
  if (status === "error") {
    return (
      <div>
        <p>{ERROR_TEXT[view?.error ?? "upstream"]}</p>
        <button type="button" className={`${ACTION} mt-2`} onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }
  if (status === "conflict") {
    const reset = view?.operation === "reset"
    return (
      <div>
        <p>
          {reset
            ? "This lesson changed in another tab or device, so it was not reset."
            : "This lesson changed in another tab or device. Your changes here are not saved."}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <button type="button" className={ACTION} onClick={onKeepMine}>
            {reset ? "Reset anyway" : "Keep my changes"}
          </button>
          <button type="button" className={ACTION} onClick={onUseSaved}>
            {reset ? "Keep saved progress" : "Use saved version"}
          </button>
        </div>
      </div>
    )
  }
  if (status === "unsaved" || (status === "idle" && returned)) {
    return (
      <div>
        <p>
          {status === "unsaved"
            ? "Not saved yet. These changes are only on this page."
            : "You are signed in. This lesson is not saved to your account yet."}
        </p>
        <button type="button" className={`${ACTION} mt-2`} onClick={onSave}>
          Save to your account
        </button>
      </div>
    )
  }
  if (status === "saved") {
    return (
      <div>
        <p>Saved to your account.</p>
        {confirmReset ? (
          <div className="mt-2">
            <p>
              Reset Lesson {lessonN}? This clears its saved steps and
              completion. Reflections are never saved to your account.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <button type="button" className={ACTION} onClick={onReset}>
                Reset lesson
              </button>
              <button
                type="button"
                className={ACTION}
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${ACTION} mt-2`}
            onClick={() => setConfirmReset(true)}
          >
            Reset saved progress
          </button>
        )}
      </div>
    )
  }
  return (
    <p>
      Signed in. Checking a step or marking the lesson complete saves it to your
      account.
    </p>
  )
}
