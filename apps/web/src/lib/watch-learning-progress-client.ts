import {
  CONTENT_VERSION,
  COURSE_ID,
  LESSONS,
  lessonCards,
  type LessonId,
  type MovementId,
} from "./beginning-with-jesus"

// Browser client for the account's own Beginning With Jesus progress
// (feat-731 U10). It talks only to the same-origin, private/no-store
// `/watch/api/learning-progress` route, which derives the account from the
// HttpOnly session. A write names the account it was loaded for only as a
// precondition the route checks against that session; it never selects one.
//
// Only structured progress crosses the wire: step ids, the explicit lesson
// completion flag, the resume card id and the expected revision. Reflection
// text has no field here and must never be added. Navigation, reading and
// timers never mark anything complete; a resume write records position only.
//
// Writes are compare-and-set on the server revision. A conflict keeps the
// visitor's unsaved state and waits for an explicit choice; nothing here
// overwrites newer progress on its own.

export const LEARNING_PROGRESS_PATH = "/watch/api/learning-progress"
/**
 * Names the account whose progress a write was built from. The route refuses
 * the write unless it equals the verified session; it never selects the account.
 */
export const LEARNING_SUBJECT_HEADER = "x-watch-learning-subject"
/** Resume position is coalesced; explicit changes are sent immediately. */
export const RESUME_DEBOUNCE_MS = 1500

export type LearningRequest =
  | { method: "GET"; signal?: AbortSignal }
  | {
      method: "POST" | "DELETE"
      body: LearningMutationBody
      /** The signed-in account whose loaded progress this write came from. */
      subject: string
      signal?: AbortSignal
      keepalive?: boolean
    }
export type LearningResponse = { status: number; body: unknown }
/** Injectable for tests; the default is the real same-origin fetch. */
export type LearningTransport = (
  request: LearningRequest,
) => Promise<LearningResponse>

export type LearningSaveBody = {
  courseId: typeof COURSE_ID
  contentVersion: typeof CONTENT_VERSION
  lessonId: LessonId
  expectedRevision: number
  completedMovementIds: MovementId[]
  completedStepIds: string[]
  completed: boolean
  resumeCardId: string | null
}
export type LearningResetBody = Pick<
  LearningSaveBody,
  "courseId" | "contentVersion" | "lessonId" | "expectedRevision"
>
export type LearningMutationBody = LearningSaveBody | LearningResetBody

export const fetchLearningTransport: LearningTransport = async (request) => {
  const url = new URL(LEARNING_PROGRESS_PATH, window.location.origin)
  if (request.method === "GET") {
    url.searchParams.set("courseId", COURSE_ID)
    url.searchParams.set("contentVersion", CONTENT_VERSION)
  }
  const body = request.method === "GET" ? undefined : request.body
  const response = await fetch(url.toString(), {
    method: request.method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(request.method === "GET"
        ? {}
        : { [LEARNING_SUBJECT_HEADER]: request.subject }),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: request.signal,
    keepalive: request.method === "GET" ? undefined : request.keepalive,
  })
  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }
  return { status: response.status, body: parsed }
}

/* ---------------------------------------------------------------------------
   Course identity. Stored ids outside the current content version's deck are
   ignored on read and never sent back, so retired steps cannot mark new
   content complete.
--------------------------------------------------------------------------- */

type LessonShape = {
  stepIds: readonly string[]
  cardIds: readonly string[]
  movementSteps: Record<MovementId, readonly string[]>
}

const SHAPES = new Map<LessonId, LessonShape>(
  LESSONS.map((lesson) => {
    const cards = lessonCards(lesson)
    const steps = cards.filter((card) => card.completable)
    const forMovement = (id: MovementId) =>
      steps.filter((card) => card.movementId === id).map((card) => card.id)
    return [
      lesson.id,
      {
        stepIds: steps.map((card) => card.id),
        cardIds: cards.map((card) => card.id),
        movementSteps: {
          back: forMovement("back"),
          up: forMovement("up"),
          forward: forMovement("forward"),
        },
      },
    ]
  }),
)

export function isLessonId(value: unknown): value is LessonId {
  return typeof value === "string" && SHAPES.has(value as LessonId)
}

export function isLessonCardId(lessonId: LessonId, value: unknown) {
  return (
    typeof value === "string" && SHAPES.get(lessonId)!.cardIds.includes(value)
  )
}

function knownSteps(lessonId: LessonId, ids: readonly unknown[]) {
  const shape = SHAPES.get(lessonId)!
  // Deck order, deduplicated: the server rejects padded or unknown lists.
  return shape.stepIds.filter((id) => ids.includes(id))
}

/** A movement is complete only when every one of its steps was checked. */
export function completedMovements(
  lessonId: LessonId,
  stepIds: readonly string[],
): MovementId[] {
  const shape = SHAPES.get(lessonId)!
  return (["back", "up", "forward"] as const).filter((movement) => {
    const steps = shape.movementSteps[movement]
    return steps.length > 0 && steps.every((id) => stepIds.includes(id))
  })
}

/* ---------------------------------------------------------------------------
   State.
--------------------------------------------------------------------------- */

export type LessonState = {
  completedStepIds: readonly string[]
  completed: boolean
  resumeCardId: string | null
}
type ServerLesson = LessonState & { revision: number }

/** Only touched fields are intent; an unchecked UI default is not a removal. */
type LessonIntent = {
  steps: Record<string, boolean>
  completed?: boolean
  resumeCardId?: string | null
}

function mergeIntent(previous: LessonIntent | null, next: LessonIntent) {
  return { ...previous, ...next, steps: { ...previous?.steps, ...next.steps } }
}

function applyIntent(
  lessonId: LessonId,
  base: LessonState,
  intent: LessonIntent | null,
): LessonState {
  return {
    completedStepIds: SHAPES.get(lessonId)!.stepIds.filter(
      (id) => intent?.steps[id] ?? base.completedStepIds.includes(id),
    ),
    completed: intent?.completed ?? base.completed,
    resumeCardId:
      intent?.resumeCardId === undefined
        ? base.resumeCardId
        : intent.resumeCardId,
  }
}

export type LearningAccount =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "anonymous" }
  | { kind: "signed-in"; userId: string }

export type LessonSyncStatus =
  /** Nothing to report: anonymous untouched, or signed in with no row. */
  | "idle"
  /** Local structured changes that no account holds. */
  | "unsaved"
  | "saving"
  | "saved"
  | "error"
  | "conflict"

export type LessonSyncError =
  | "network"
  | "upstream"
  | "invalid"
  | "forbidden"
  | "unauthorized"

export type LessonView = LessonState & {
  status: LessonSyncStatus
  error: LessonSyncError | null
  /** Which explicit operation the conflict or failure belongs to. */
  operation: "save" | "reset" | null
  /** The account has stored progress for this lesson (revision > 0). */
  saved: boolean
}

export type LearningSnapshot = {
  account: LearningAccount["kind"]
  load: "idle" | "loading" | "loaded" | "error"
  lessons: Partial<Record<LessonId, LessonView>>
}

type Entry = {
  server: ServerLesson | null
  local: LessonState | null
  /** Signed-in edits sync automatically only after an explicit change/save. */
  armed: boolean
  status: LessonSyncStatus
  error: LessonSyncError | null
  /** Unsettled intent; only its acknowledgement or explicit Use saved retires it. */
  operation: "save" | "reset" | null
  inFlight: {
    controller: AbortController
    revision: number
    reset: boolean
  } | null
  /** Reset owns pre-dispatch state; later edits wait for its acknowledgement. */
  resetIntent: { after: LessonIntent | null } | null
  /** Deltas made before any authoritative read, scoped to their known owner. */
  unreadIntent: { delta: LessonIntent; owner: string | null } | null
  timer: ReturnType<typeof setTimeout> | null
  /**
   * A write held while identity was re-checked, with the revision it was
   * built on. It is sent only if the same account still holds that revision.
   */
  deferred: {
    revision: number
    reset: boolean
    explicit: boolean
    /** An explicit conflict or failure choice, which may send a blocked entry. */
    choice: boolean
  } | null
}

const EMPTY: LessonState = {
  completedStepIds: [],
  completed: false,
  resumeCardId: null,
}

/**
 * A save or reset the server refused or never confirmed. It is disarmed and
 * waits for an explicit Keep mine, Use saved or Retry; no re-read, session
 * check or later edit sends it.
 */
function blocked(item: Entry) {
  return (
    item.status === "conflict" ||
    (item.status === "error" && item.operation !== null)
  )
}

function sameState(a: LessonState, b: LessonState) {
  return (
    a.completed === b.completed &&
    a.resumeCardId === b.resumeCardId &&
    a.completedStepIds.length === b.completedStepIds.length &&
    a.completedStepIds.every((id) => b.completedStepIds.includes(id))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

/** Strict read of one server lesson; anything malformed is a failure. */
export function parseServerLesson(value: unknown): {
  lessonId: LessonId
  progress: ServerLesson
} | null {
  if (!isRecord(value)) return null
  if (value.courseId !== COURSE_ID || value.contentVersion !== CONTENT_VERSION)
    return null
  if (!isLessonId(value.lessonId)) return null
  const lessonId = value.lessonId
  const { completedStepIds, completed, resumeCardId, revision } = value
  if (!Array.isArray(completedStepIds)) return null
  if (typeof completed !== "boolean") return null
  if (resumeCardId !== null && typeof resumeCardId !== "string") return null
  if (typeof revision !== "number" || !Number.isInteger(revision)) return null
  if (revision < 0) return null
  return {
    lessonId,
    progress: {
      completedStepIds: knownSteps(lessonId, completedStepIds),
      completed,
      resumeCardId: isLessonCardId(lessonId, resumeCardId)
        ? (resumeCardId as string)
        : null,
      revision,
    },
  }
}

export type LearningProgressClient = ReturnType<
  typeof createLearningProgressClient
>

export function createLearningProgressClient({
  transport = fetchLearningTransport,
  resumeDebounceMs = RESUME_DEBOUNCE_MS,
  onAccountCleared,
  onStaleIdentity,
}: {
  transport?: LearningTransport
  resumeDebounceMs?: number
  /** Another identity replaced the previous one: drop browser-only drafts. */
  onAccountCleared?: () => void
  /** The server no longer accepts this session; ask the session route again. */
  onStaleIdentity?: () => void
} = {}) {
  let account: LearningAccount = { kind: "checking" }
  /** Identity whose data is held: null before any answer. */
  let holder: { kind: "anonymous" } | { kind: "user"; id: string } | null = null
  let load: LearningSnapshot["load"] = "idle"
  let loadController: AbortController | null = null
  // Every identity change bumps the epoch; a response from an older epoch is
  // discarded even if its abort raced the network.
  let epoch = 0
  let entries = new Map<LessonId, Entry>()
  // One session re-check per account until a read succeeds, so an answer the
  // session route keeps contradicting cannot loop the two reads forever.
  let staleChecked: string | null = null
  // A focus re-read of the session is pending: writes wait, nothing else
  // changes, so the visitor keeps the same status, controls and choices.
  let held = false
  const listeners = new Set<() => void>()
  let snapshot: LearningSnapshot = build()

  function entry(lessonId: LessonId) {
    let found = entries.get(lessonId)
    if (!found) {
      found = {
        server: null,
        local: null,
        armed: false,
        status: "idle",
        error: null,
        operation: null,
        inFlight: null,
        resetIntent: null,
        unreadIntent: null,
        timer: null,
        deferred: null,
      }
      entries.set(lessonId, found)
    }
    return found
  }

  function edit(lessonId: LessonId, item: Entry, intent: LessonIntent) {
    if (item.resetIntent) {
      item.resetIntent.after = mergeIntent(item.resetIntent.after, intent)
      item.local = applyIntent(lessonId, EMPTY, item.resetIntent.after)
    } else if (!item.server) {
      item.unreadIntent ??= {
        delta: { steps: {} },
        owner: holder?.kind === "user" ? holder.id : null,
      }
      item.unreadIntent.delta = mergeIntent(item.unreadIntent.delta, intent)
      item.local = applyIntent(lessonId, EMPTY, item.unreadIntent.delta)
    } else {
      item.local = applyIntent(lessonId, item.local ?? item.server, intent)
    }
  }

  function build(): LearningSnapshot {
    const lessons: LearningSnapshot["lessons"] = {}
    for (const [lessonId, item] of entries) {
      const state = item.local ?? item.server ?? EMPTY
      lessons[lessonId] = {
        completedStepIds: state.completedStepIds,
        completed: state.completed,
        resumeCardId: state.resumeCardId,
        status: item.status,
        error: item.error,
        operation: item.operation,
        saved: (item.server?.revision ?? 0) > 0,
      }
    }
    return { account: account.kind, load, lessons }
  }

  function emit() {
    snapshot = build()
    listeners.forEach((listener) => listener())
  }

  function clearAll() {
    epoch++
    loadController?.abort()
    loadController = null
    for (const item of entries.values()) {
      item.inFlight?.controller.abort()
      if (item.timer) clearTimeout(item.timer)
    }
    entries = new Map()
    load = "idle"
    staleChecked = null
  }

  function staleIdentity(userId: string) {
    if (staleChecked === userId) return
    staleChecked = userId
    onStaleIdentity?.()
  }

  function loadFailed(error: LessonSyncError = "upstream") {
    load = "error"
    // Edits waiting for the first read cannot be saved yet; say so plainly.
    for (const item of entries.values()) {
      // The load error is shown separately. A failed GET has not refused a
      // queued DELETE; keep its ownership until a read permits dispatch.
      if (item.deferred?.reset) continue
      if (item.local && item.status === "saving" && !item.inFlight) {
        item.status = "error"
        item.error = error
      }
    }
    emit()
  }

  function signedIn() {
    return account.kind === "signed-in" && load === "loaded"
  }

  function defer(
    item: Entry,
    { reset = false, explicit = false, choice = false } = {},
  ) {
    if (!item.server) return
    // Retain the explicit operation if an earlier in-flight save fails.
    if (reset) item.operation = "reset"
    item.deferred = {
      // Additional held edits retain their base; only an explicit recovery
      // choice may adopt the currently installed revision.
      revision: choice
        ? item.server.revision
        : (item.deferred?.revision ?? item.server.revision),
      // Passive position updates cannot cancel an explicit held reset.
      reset: reset || (item.deferred?.reset ?? false),
      explicit: explicit || (item.deferred?.explicit ?? false),
      choice: choice || (item.deferred?.choice ?? false),
    }
  }

  /** An independent revision cannot acknowledge or authorize this intent. */
  function disarmReplay(
    item: Entry,
    reset = item.operation === "reset" || item.deferred?.reset === true,
  ) {
    // Retire the invalidated operation before the visitor chooses recovery.
    // A new explicit request owns the slot even if the old response arrives.
    item.inFlight?.controller.abort()
    item.inFlight = null
    item.armed = false
    item.deferred = null
    item.error = null
    item.operation = reset ? "reset" : item.local ? "save" : null
    item.status = item.operation
      ? "conflict"
      : (item.server?.revision ?? 0) > 0
        ? "saved"
        : "idle"
  }

  /** Send held writes whose lesson still has the revision they were built on. */
  function sendDeferred() {
    if (!signedIn() || held) return
    for (const [lessonId, item] of entries) {
      const waiting = item.deferred
      if (!waiting) continue
      if (
        !item.server ||
        item.server.revision !== waiting.revision ||
        (blocked(item) && !waiting.choice)
      ) {
        item.deferred = null
        continue
      }
      // Keep the operation (especially reset) until the predecessor settles.
      if (item.inFlight) continue
      item.deferred = null
      void send(lessonId, {
        reset: waiting.reset,
        explicit: waiting.explicit,
        choice: waiting.choice,
      })
    }
  }

  /** A pending debounce belongs to the revision preceding any new read. */
  function pauseDebounced() {
    for (const item of entries.values()) {
      if (!item.timer) continue
      clearTimeout(item.timer)
      item.timer = null
      defer(item)
    }
  }

  function setAccount(next: LearningAccount) {
    const previous = account
    account = next
    if (next.kind === "checking" || next.kind === "unavailable") {
      // Identity is unconfirmed: pause writes, hold everything, decide later.
      // A coalesced resume write waits with the revision it was built on.
      pauseDebounced()
      emit()
      return
    }
    const nextHolder =
      next.kind === "anonymous"
        ? ({ kind: "anonymous" } as const)
        : ({ kind: "user", id: next.userId } as const)
    const changed =
      holder !== null &&
      (holder.kind !== nextHolder.kind ||
        (holder.kind === "user" &&
          nextHolder.kind === "user" &&
          holder.id !== nextHolder.id))
    if (holder?.kind === "user" && changed) {
      // Sign-out or account switch: nothing of the old account may remain.
      clearAll()
      onAccountCleared?.()
    } else if (changed) {
      // Anonymous -> signed in elsewhere: drafts belong to whoever typed them.
      // Structured anonymous changes stay visible as unsaved, never auto-sent.
      epoch++
      onAccountCleared?.()
      for (const item of entries.values()) item.armed = false
    }
    holder = nextHolder
    if (next.kind === "signed-in") {
      const sameUser = previous.kind === "signed-in" && !changed
      if (!sameUser || load !== "loaded") void refresh()
      else {
        emit()
        sendDeferred()
      }
    } else {
      load = "idle"
      emit()
    }
  }

  async function refresh() {
    if (account.kind !== "signed-in") return
    // Freeze queued intent before the GET can replace its baseline. Waiting
    // until the timer fires would adopt the newly read revision implicitly.
    pauseDebounced()
    const userId = account.userId
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    const started = epoch
    load = "loading"
    emit()
    let response: LearningResponse
    try {
      response = await transport({ method: "GET", signal: controller.signal })
    } catch {
      if (started !== epoch || controller.signal.aborted) return
      loadFailed("network")
      return
    }
    if (started !== epoch || controller.signal.aborted) return
    loadController = null
    const body = response.body
    if (response.status !== 200 || !isRecord(body)) {
      loadFailed()
      return
    }
    if (body.authenticated === false || body.userId !== userId) {
      // The session changed between the two reads; never show either mix.
      loadFailed("unauthorized")
      staleIdentity(userId)
      return
    }
    if (body.progressAvailable === false) {
      // Signed in, but this session cannot hold progress; asking the session
      // route again would only repeat the same answer.
      loadFailed("unauthorized")
      return
    }
    if (!Array.isArray(body.lessons)) {
      loadFailed()
      return
    }
    const parsed = body.lessons.map(parseServerLesson)
    if (parsed.some((item) => item === null)) {
      loadFailed()
      return
    }
    const byLesson = new Map(parsed.map((item) => [item!.lessonId, item!]))
    for (const lesson of LESSONS) {
      const found = byLesson.get(lesson.id)
      const item = entry(lesson.id)
      const read = found
        ? found.progress
        : { ...EMPTY, completedStepIds: [], revision: 0 }
      const firstRead = item.server === null
      // Revisions only grow: a read answered before a concurrent save landed
      // must not move the lesson back to the older revision.
      if (!item.server || read.revision >= item.server.revision)
        item.server = read
      if (firstRead && item.unreadIntent) {
        const { delta, owner } = item.unreadIntent
        item.unreadIntent = null
        item.local = applyIntent(lesson.id, item.server, delta)
        if (sameState(item.local, item.server)) item.local = null
        if (item.local) {
          // Unscoped drafts still need a fresh explicit account-save choice.
          if (
            !item.armed &&
            owner !== (holder?.kind === "user" ? holder.id : null)
          ) {
            disarmReplay(item)
            continue
          }
          // Once read, only already-stored lessons qualify for resume-only sync.
          if (item.armed || (owner !== null && item.server.revision > 0))
            defer(item)
        }
      }
      const pendingRevision =
        item.deferred?.revision ??
        (item.inFlight?.reset ? item.inFlight.revision : undefined)
      // A GET may observe this DELETE's empty successor before its response.
      // Keep waiting for the owner; the read alone grants no continuation.
      const resetRead =
        item.inFlight?.reset &&
        item.server.revision === item.inFlight.revision + 1 &&
        sameState(item.server, EMPTY)
      if (
        pendingRevision !== undefined &&
        pendingRevision !== item.server.revision &&
        !resetRead
      ) {
        disarmReplay(item)
        continue
      }
      // A read cannot settle an unresolved operation, even when final intent
      // matches the old baseline: a failed response may hide a committed write.
      // Keep ownership through failures and held recovery choices as well as
      // in-flight writes; only an owning acknowledgement can deduplicate them.
      if (item.operation || item.inFlight || item.resetIntent) continue
      if (item.local && sameState(item.local, item.server)) item.local = null
      item.error = null
      item.operation = item.deferred?.reset ? "reset" : null
      item.status = item.deferred
        ? "saving"
        : item.local
          ? item.armed
            ? "saving"
            : "unsaved"
          : item.server.revision > 0
            ? "saved"
            : "idle"
    }
    load = "loaded"
    staleChecked = null
    emit()
    sendDeferred()
    for (const lesson of LESSONS) {
      const item = entry(lesson.id)
      if (item.local && item.armed && !item.inFlight) void send(lesson.id)
    }
  }

  function saveBody(lessonId: LessonId, item: Entry): LearningSaveBody {
    const state = item.local ?? item.server ?? EMPTY
    const steps = knownSteps(lessonId, [...state.completedStepIds])
    return {
      courseId: COURSE_ID,
      contentVersion: CONTENT_VERSION,
      lessonId,
      expectedRevision: item.server?.revision ?? 0,
      completedMovementIds: completedMovements(lessonId, steps),
      completedStepIds: steps,
      completed: state.completed,
      resumeCardId: isLessonCardId(lessonId, state.resumeCardId)
        ? state.resumeCardId
        : null,
    }
  }

  async function send(
    lessonId: LessonId,
    {
      keepalive = false,
      reset = false,
      explicit = false,
      choice = false,
    }: {
      keepalive?: boolean
      reset?: boolean
      explicit?: boolean
      choice?: boolean
    } = {},
  ) {
    const item = entry(lessonId)
    if (item.timer) {
      clearTimeout(item.timer)
      item.timer = null
    }
    // A conflict or failure waits for the visitor; a late resume timer, a
    // queued re-send or pagehide never answers it on their behalf.
    if (blocked(item) && !choice) return
    if (!item.server) return
    // An explicit retry/save must finish the outstanding reset first.
    if (item.resetIntent && !item.inFlight) reset = true
    // Repeated reset clicks share the dispatched intent, including while held.
    if (reset && item.inFlight?.reset) return
    if (!signedIn() || held || item.inFlight) {
      // Accepted intent is pending regardless of why dispatch must wait.
      // Record lineage and publish its status together, including a held
      // reset that has no local edit to make the pending state visible.
      if (holder?.kind === "user") {
        defer(item, { reset, explicit, choice })
        item.status = "saving"
        item.error = null
        emit()
      }
      return
    }
    // Matching the last read does not settle an uncertain earlier write.
    // Explicit recovery must CAS the final intent, even a toggle-back. Fresh
    // unchanged state needs no request, except an explicit first account save.
    const unchanged = !item.local || sameState(item.local, item.server)
    if (
      !reset &&
      !item.operation &&
      unchanged &&
      !(explicit && item.server.revision === 0)
    ) {
      item.local = null
      item.status = item.server.revision > 0 ? "saved" : "idle"
      emit()
      return
    }
    const body: LearningMutationBody = reset
      ? {
          courseId: COURSE_ID,
          contentVersion: CONTENT_VERSION,
          lessonId,
          expectedRevision: item.server.revision,
        }
      : saveBody(lessonId, item)
    const sent = item.local
    // signedIn() holds, so the holder is the account this progress was read for.
    const subject = holder?.kind === "user" ? holder.id : ""
    const controller = new AbortController()
    const started = epoch
    const mutation = { controller, revision: body.expectedRevision, reset }
    const resetIntent = reset ? (item.resetIntent ??= { after: null }) : null
    item.inFlight = mutation
    item.status = "saving"
    item.error = null
    item.operation = reset ? "reset" : "save"
    emit()

    let response: LearningResponse | null = null
    try {
      response = await transport({
        method: reset ? "DELETE" : "POST",
        body,
        subject,
        signal: controller.signal,
        keepalive,
      })
    } catch {
      response = null
    }
    if (
      started !== epoch ||
      controller.signal.aborted ||
      item.inFlight !== mutation
    )
      return
    item.inFlight = null

    if (!response) return fail(item, "network")
    const parsed =
      response.status === 200 && isRecord(response.body)
        ? {
            status: response.body.status,
            lesson: parseServerLesson(response.body.progress),
          }
        : null
    if (
      parsed &&
      (parsed.status === "saved" || parsed.status === "conflict") &&
      parsed.lesson?.lessonId === lessonId
    ) {
      const incoming = parsed.lesson.progress
      if (
        incoming.revision < item.server.revision ||
        (incoming.revision === item.server.revision &&
          !sameState(incoming, item.server))
      ) {
        // A delayed POST/DELETE cannot replace a newer read, clear local
        // edits, or grant its held continuation permission to write.
        disarmReplay(item, reset || item.operation === "reset")
        emit()
        return
      }
      // A refresh may already have invalidated this operation's continuation.
      if (blocked(item)) {
        emit()
        return
      }
      const previousRevision = item.server.revision
      item.server = incoming
      if (parsed.status === "conflict") {
        // Keep what the visitor did; an explicit choice decides what wins.
        if (reset)
          item.local = resetIntent?.after
            ? applyIntent(lessonId, EMPTY, resetIntent.after)
            : null
        item.armed = false
        item.status = "conflict"
        emit()
        return
      }
      // Only the owning success can advance its continuation. A reset's
      // later edits are based on its empty result, never pre-reset completion.
      // A newer independent read still fails the monotonic check above.
      if (
        !reset &&
        item.deferred?.revision === body.expectedRevision &&
        previousRevision === body.expectedRevision
      )
        item.deferred.revision = item.server.revision
      if (reset) {
        item.local = resetIntent?.after
          ? applyIntent(lessonId, EMPTY, resetIntent.after)
          : null
        item.resetIntent = null
        // Retry can retain later edits even after its old queue was disarmed.
        item.deferred = null
        if (item.local) defer(item)
      } else if (
        item.local === sent ||
        (item.local && sameState(item.local, item.server))
      ) {
        item.local = null
      }
      // This acknowledgement owns its mutation, not a queued successor reset.
      item.operation = item.deferred?.reset ? "reset" : null
      if (item.deferred?.revision === item.server.revision) {
        // This also preserves a queued reset when the POST cleared local.
        item.status = "saving"
        emit()
        sendDeferred()
        return
      }
      item.status = item.local ? "unsaved" : "saved"
      if (item.local && item.armed) return void send(lessonId)
      emit()
      return
    }
    if (response.status === 401 || response.status === 409) {
      // 409: the session now belongs to another account than the one loaded.
      fail(item, "unauthorized")
      if (
        !(
          isRecord(response.body) &&
          response.body.error === "progress-unavailable"
        )
      )
        staleIdentity(subject)
      return
    }
    fail(
      item,
      response.status === 403
        ? "forbidden"
        : response.status === 400
          ? "invalid"
          : "upstream",
    )
  }

  function fail(item: Entry, error: LessonSyncError) {
    // Pending changes stay visible and unsaved; only a retry sends them again.
    item.status = "error"
    item.error = error
    item.armed = false
    emit()
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    setAccount,
    /**
     * A focus re-read of the session started: hold writes without changing
     * the account, the loaded progress or any open choice.
     */
    hold() {
      held = true
    },
    /**
     * The re-read answered and was passed to setAccount. The same account
     * sends what was held, with no progress re-read; another account already
     * cleared it.
     */
    release() {
      held = false
      sendDeferred()
    },
    /** Ask the server again (a failed load, or after a conflict). */
    refresh: () => void refresh(),
    /** Explicit step or lesson-completion change from a visible control. */
    change(
      lessonId: LessonId,
      next: { completedStepIds: readonly string[]; completed: boolean },
    ) {
      const item = entry(lessonId)
      // Controls supply their displayed snapshot. Only differences from that
      // visible state are edits; retained old/default fields are not intent.
      const visible = item.local ?? item.server ?? EMPTY
      const intent: LessonIntent = { steps: {} }
      for (const id of SHAPES.get(lessonId)!.stepIds) {
        const checked = next.completedStepIds.includes(id)
        if (checked !== visible.completedStepIds.includes(id))
          intent.steps[id] = checked
      }
      if (next.completed !== visible.completed)
        intent.completed = next.completed
      edit(lessonId, item, intent)
      if (blocked(item)) {
        // Held with the open choice, whoever the session turns out to be.
        emit()
        return
      }
      // While a known account is re-checked the change is held, not dropped:
      // it is sent only if the same account is confirmed (another clears it).
      const pending =
        holder?.kind === "user" &&
        (account.kind === "checking" || account.kind === "unavailable")
      if (account.kind === "signed-in" || pending) {
        item.armed = true
        if (item.status === "error") {
          emit()
          return
        }
        item.status = "saving"
        emit()
        void send(lessonId)
        return
      }
      item.status = "unsaved"
      emit()
    },
    /** Position only. Never completion; synced only for lessons already saved. */
    setResume(lessonId: LessonId, cardId: string) {
      if (!isLessonCardId(lessonId, cardId)) return
      const item = entry(lessonId)
      const base = item.resetIntent
        ? applyIntent(lessonId, EMPTY, item.resetIntent.after)
        : (item.local ?? item.server ?? EMPTY)
      if (base.resumeCardId === cardId) return
      edit(lessonId, item, { steps: {}, resumeCardId: cardId })
      const syncs =
        holder?.kind === "user" &&
        (item.armed || (item.server?.revision ?? 0) > 0) &&
        item.status !== "conflict" &&
        item.status !== "error"
      if (!syncs) {
        if (item.status === "saved") item.status = "unsaved"
        emit()
        return
      }
      // The position is not on the account until the write is acknowledged.
      item.status = "saving"
      if (!signedIn()) {
        // Resume includes the whole local lesson, so preserve its revision
        // while identity or progress is being checked, just like an edit.
        defer(item)
        emit()
        return
      }
      if (item.timer) clearTimeout(item.timer)
      item.timer = setTimeout(() => {
        item.timer = null
        void send(lessonId)
      }, resumeDebounceMs)
      emit()
    },
    /** Explicit "save to my account", e.g. after returning from sign-in. */
    save(lessonId: LessonId) {
      const item = entry(lessonId)
      item.armed = true
      void send(lessonId, { explicit: true, choice: true })
    },
    /** Conflict choice: replace the newer saved state with this tab's state. */
    keepMine(lessonId: LessonId) {
      const item = entry(lessonId)
      item.armed = true
      if (item.operation === "reset")
        return void send(lessonId, { reset: true, choice: true })
      void send(lessonId, { choice: true })
    },
    /** Conflict choice: drop this tab's unsaved state for the saved one. */
    useSaved(lessonId: LessonId) {
      const item = entry(lessonId)
      item.inFlight?.controller.abort()
      item.inFlight = null
      if (item.timer) clearTimeout(item.timer)
      item.timer = null
      item.resetIntent = null
      item.unreadIntent = null
      item.local = null
      item.deferred = null
      item.armed = false
      item.error = null
      item.operation = null
      item.status = (item.server?.revision ?? 0) > 0 ? "saved" : "idle"
      emit()
    },
    retry(lessonId: LessonId) {
      if (load === "error") return void refresh()
      const item = entry(lessonId)
      item.armed = true
      void send(lessonId, { reset: item.operation === "reset", choice: true })
    },
    /** Explicit reset of one saved lesson, guarded by the last read revision. */
    reset(lessonId: LessonId) {
      const item = entry(lessonId)
      if (!signedIn() || (item.server?.revision ?? 0) === 0) return
      void send(lessonId, { reset: true })
    },
    /** Send a coalesced resume write now (close, pagehide, tab hidden). */
    flush({ keepalive = false }: { keepalive?: boolean } = {}) {
      for (const [lessonId, item] of entries) {
        if (item.timer) void send(lessonId, { keepalive })
      }
    },
  }
}

/* ---------------------------------------------------------------------------
   Hosted sign-in return. Only the lesson and card ids travel in the return
   address — never reflection text or progress — and the course restores that
   position without saving or completing anything.
--------------------------------------------------------------------------- */

export const GROW_RETURN_LESSON = "growLesson"
export const GROW_RETURN_CARD = "growCard"
const AUTH_FAILURE_PARAMS = ["auth", "reason"] as const

export type WatchGrowReturn = {
  lessonId: LessonId
  cardId: string | null
  /** The callback reported that sign-in did not complete. */
  authFailed: boolean
}

export function readWatchGrowReturn(
  href: string = window.location.href,
): WatchGrowReturn | null {
  const url = new URL(href)
  const lessonId = url.searchParams.get(GROW_RETURN_LESSON)
  if (!isLessonId(lessonId)) return null
  const card = url.searchParams.get(GROW_RETURN_CARD)
  return {
    lessonId,
    cardId: isLessonCardId(lessonId, card) ? card : null,
    authFailed: url.searchParams.get("auth") === "failed",
  }
}

/** The current address with the return position set and failure markers removed. */
export function watchGrowReturnTo(
  lessonId: LessonId,
  cardId: string | null,
  href: string = window.location.href,
): string {
  const url = new URL(href)
  for (const param of AUTH_FAILURE_PARAMS) url.searchParams.delete(param)
  url.searchParams.set("as", "grow")
  url.searchParams.set(GROW_RETURN_LESSON, lessonId)
  if (cardId && isLessonCardId(lessonId, cardId))
    url.searchParams.set(GROW_RETURN_CARD, cardId)
  else url.searchParams.delete(GROW_RETURN_CARD)
  return `${url.pathname}${url.search}${url.hash}`
}

/** Hosted login pointed back at this lesson position. */
export function watchGrowLoginUrl(
  lessonId: LessonId,
  cardId: string | null,
  serverLoginUrl?: string,
  href: string = window.location.href,
): string {
  const origin = new URL(href).origin
  const url = new URL(serverLoginUrl ?? "/watch/api/auth/login", origin)
  // Only same-origin login routes; a foreign base falls back to the local one.
  const base =
    url.origin === origin ? url : new URL("/watch/api/auth/login", origin)
  base.searchParams.set("returnTo", watchGrowReturnTo(lessonId, cardId, href))
  return base.toString()
}

/** Address without the restore params, so reload or share cannot replay it. */
export function withoutWatchGrowReturn(href: string = window.location.href) {
  const url = new URL(href)
  url.searchParams.delete(GROW_RETURN_LESSON)
  url.searchParams.delete(GROW_RETURN_CARD)
  for (const param of AUTH_FAILURE_PARAMS) url.searchParams.delete(param)
  return `${url.pathname}${url.search}${url.hash}`
}
