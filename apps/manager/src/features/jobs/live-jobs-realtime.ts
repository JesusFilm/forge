import type { JobRecord } from "@/types/job"
import { shouldApplyPollResult } from "./live-jobs-polling"

const DEFAULT_POLL_DELAY_MS = 5_000
const DEFAULT_RECONNECT_DELAY_MS = 1_000
const LIST_WINDOW_SIZE = 50

export type LiveJobsRealtimeTransportMode =
  | "connecting"
  | "live"
  | "polling"
  | "stopped"

export type LiveJobsRealtimeFailureReason =
  | "stream-error"
  | "stream-close"
  | null

export type LiveJobsRealtimeSyncSource =
  | "initial"
  | "stream-snapshot"
  | "stream-upsert"
  | "poll"
  | "external"

export type LiveJobsRealtimeSnapshot<TState> = {
  state: TState
  transportMode: LiveJobsRealtimeTransportMode
  isPollingPaused: boolean
  isReconnectPending: boolean
  isRefreshInFlight: boolean
  needsResync: boolean
  lastFailureReason: LiveJobsRealtimeFailureReason
  lastSyncSource: LiveJobsRealtimeSyncSource
}

export type LiveJobsRealtimeListener<TState> = (
  snapshot: LiveJobsRealtimeSnapshot<TState>,
) => void

export type LiveJobsRealtimeStreamCallbacks<TSnapshot> = {
  onOpen: () => void
  onSnapshot: (snapshot: TSnapshot) => void
  onUpsert: (job: JobRecord) => void
  onError: () => void
  onClose: () => void
}

export type LiveJobsRealtimeStreamConnection = {
  close: () => void
}

export type LiveJobsRealtimeScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type LiveJobsRealtimeController<TState> = {
  start: () => void
  stop: () => void
  subscribe: (listener: LiveJobsRealtimeListener<TState>) => () => void
  getSnapshot: () => LiveJobsRealtimeSnapshot<TState>
  refreshNow: () => Promise<void>
  replaceState: (state: TState) => void
}

type LiveJobsRealtimeControllerOptions<TState> = {
  initialState: TState
  openStream: (
    callbacks: LiveJobsRealtimeStreamCallbacks<TState>,
  ) => LiveJobsRealtimeStreamConnection
  poll: (signal: AbortSignal) => Promise<TState>
  applySnapshot: (currentState: TState, snapshot: TState) => TState
  applyUpsert: (
    currentState: TState,
    job: JobRecord,
  ) => {
    nextState: TState
    didChange: boolean
    needsResync?: boolean
  }
  isTerminalState: (state: TState) => boolean
  getPollDelayMs?: () => number
  getReconnectDelayMs?: () => number
  scheduler?: LiveJobsRealtimeScheduler
}

export type LiveJobsListRealtimeController = LiveJobsRealtimeController<
  JobRecord[]
>

export type LiveJobsDetailRealtimeController =
  LiveJobsRealtimeController<JobRecord>

export type CreateLiveJobsListRealtimeControllerOptions = {
  initialJobs: JobRecord[]
  openStream: (
    callbacks: LiveJobsRealtimeStreamCallbacks<JobRecord[]>,
  ) => LiveJobsRealtimeStreamConnection
  poll: (signal: AbortSignal) => Promise<JobRecord[]>
  getPollDelayMs?: () => number
  getReconnectDelayMs?: () => number
  scheduler?: LiveJobsRealtimeScheduler
}

export type CreateLiveJobDetailRealtimeControllerOptions = {
  initialJob: JobRecord
  openStream: (
    callbacks: LiveJobsRealtimeStreamCallbacks<JobRecord>,
  ) => LiveJobsRealtimeStreamConnection
  poll: (signal: AbortSignal) => Promise<JobRecord>
  getPollDelayMs?: () => number
  getReconnectDelayMs?: () => number
  scheduler?: LiveJobsRealtimeScheduler
}

type ScheduledPollMode = "followup" | "resync"
type ActivePollMode = ScheduledPollMode | "manual"
type LiveJobsListStreamEvent =
  | {
      type: "snapshot"
      jobs: JobRecord[]
    }
  | {
      type: "job-upsert"
      job: JobRecord
    }

type LiveJobDetailStreamEvent =
  | {
      type: "snapshot"
      job: JobRecord
    }
  | {
      type: "job-upsert"
      job: JobRecord
    }

export type LiveJobsEventSourceMessage = {
  data?: string
}

export type LiveJobsEventSourceLike = {
  addEventListener: (
    type: string,
    listener: (event: LiveJobsEventSourceMessage) => void,
  ) => void
  close: () => void
}

export type LiveJobsEventSourceFactory = (
  url: string,
) => LiveJobsEventSourceLike

function getDefaultScheduler(): LiveJobsRealtimeScheduler {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
  }
}

function getDefaultEventSourceFactory(): LiveJobsEventSourceFactory {
  return (url) => {
    if (typeof EventSource === "undefined") {
      throw new Error("EventSource is not available in this environment")
    }

    return new EventSource(url) as unknown as LiveJobsEventSourceLike
  }
}

function parseStreamPayload<TEvent extends { type: string }>(
  event: LiveJobsEventSourceMessage,
): TEvent {
  if (typeof event.data !== "string") {
    throw new Error("Expected stream event data to be a string")
  }

  return JSON.parse(event.data) as TEvent
}

function createEventSourceOpener<
  TSnapshot,
  TStreamEvent extends { type: string },
>({
  url,
  createEventSource = getDefaultEventSourceFactory(),
  readSnapshot,
}: {
  url: string
  createEventSource?: LiveJobsEventSourceFactory
  readSnapshot: (event: TStreamEvent) => TSnapshot
}): (
  callbacks: LiveJobsRealtimeStreamCallbacks<TSnapshot>,
) => LiveJobsRealtimeStreamConnection {
  return (callbacks) => {
    const eventSource = createEventSource(url)
    let closed = false

    const close = () => {
      if (closed) return
      closed = true
      eventSource.close()
    }

    const handleParseFailure = () => {
      if (closed) return
      callbacks.onError()
      close()
    }

    eventSource.addEventListener("open", () => {
      if (closed) return
      callbacks.onOpen()
    })

    eventSource.addEventListener("snapshot", (event) => {
      if (closed) return

      try {
        callbacks.onSnapshot(
          readSnapshot(parseStreamPayload<TStreamEvent>(event)),
        )
      } catch {
        handleParseFailure()
      }
    })

    eventSource.addEventListener("job-upsert", (event) => {
      if (closed) return

      try {
        const payload = parseStreamPayload<TStreamEvent>(event)
        if (!("job" in payload) || !payload.job) {
          throw new Error("Missing job payload")
        }
        callbacks.onUpsert(payload.job as JobRecord)
      } catch {
        handleParseFailure()
      }
    })

    eventSource.addEventListener("error", () => {
      if (closed) return
      callbacks.onError()
      close()
    })

    return {
      close,
    }
  }
}

function isTerminalJobStatus(status: JobRecord["status"]): boolean {
  return status === "completed" || status === "failed"
}

function getTimestampValue(timestamp: string | undefined): number | null {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : null
}

function isIncomingJobStale(
  currentJob: JobRecord | undefined,
  incomingJob: JobRecord,
): boolean {
  if (!currentJob) return false

  const currentUpdatedAt = getTimestampValue(currentJob.updatedAt)
  const incomingUpdatedAt = getTimestampValue(incomingJob.updatedAt)

  if (currentUpdatedAt === null || incomingUpdatedAt === null) {
    return false
  }

  return incomingUpdatedAt < currentUpdatedAt
}

function applyJobListUpsert(
  currentJobs: JobRecord[],
  incomingJob: JobRecord,
): {
  nextState: JobRecord[]
  didChange: boolean
  needsResync?: boolean
} {
  const existingIndex = currentJobs.findIndex(
    (job) => job.id === incomingJob.id,
  )
  if (existingIndex >= 0) {
    const existingJob = currentJobs[existingIndex]
    if (isIncomingJobStale(existingJob, incomingJob)) {
      return {
        nextState: currentJobs,
        didChange: false,
      }
    }

    const nextJobs = [...currentJobs]
    nextJobs[existingIndex] = incomingJob
    return {
      nextState: nextJobs,
      didChange: true,
    }
  }

  return {
    nextState: [incomingJob, ...currentJobs].slice(0, LIST_WINDOW_SIZE),
    didChange: true,
    needsResync: true,
  }
}

function applyDetailSnapshot(
  currentJob: JobRecord,
  nextJob: JobRecord,
): JobRecord {
  return nextJob.id === currentJob.id ? nextJob : currentJob
}

function applyDetailUpsert(
  currentJob: JobRecord,
  incomingJob: JobRecord,
): {
  nextState: JobRecord
  didChange: boolean
  needsResync?: boolean
} {
  if (incomingJob.id !== currentJob.id) {
    return {
      nextState: currentJob,
      didChange: false,
    }
  }

  if (isIncomingJobStale(currentJob, incomingJob)) {
    return {
      nextState: currentJob,
      didChange: false,
    }
  }

  return {
    nextState: incomingJob,
    didChange: true,
  }
}

function createLiveJobsRealtimeController<TState>({
  initialState,
  openStream,
  poll,
  applySnapshot,
  applyUpsert,
  isTerminalState,
  getPollDelayMs = () => DEFAULT_POLL_DELAY_MS,
  getReconnectDelayMs = () => DEFAULT_RECONNECT_DELAY_MS,
  scheduler = getDefaultScheduler(),
}: LiveJobsRealtimeControllerOptions<TState>): LiveJobsRealtimeController<TState> {
  let snapshot: LiveJobsRealtimeSnapshot<TState> = {
    state: initialState,
    transportMode: "connecting",
    isPollingPaused: false,
    isReconnectPending: false,
    isRefreshInFlight: false,
    needsResync: false,
    lastFailureReason: null,
    lastSyncSource: "initial",
  }

  let started = false
  let disposed = false
  let streamConnection: LiveJobsRealtimeStreamConnection | null = null
  let pollTimeoutHandle: unknown | null = null
  let reconnectTimeoutHandle: unknown | null = null
  let activePollController: AbortController | null = null
  let activePollMode: ActivePollMode | null = null
  let requestSeq = 0
  let authoritativeStateSeq = 0
  let pollMode: ScheduledPollMode | null = null
  let pendingResyncAfterActivePoll = false
  let shouldResyncAfterReconnect = false
  const listeners = new Set<LiveJobsRealtimeListener<TState>>()

  const emit = () => {
    const nextSnapshot = { ...snapshot }
    listeners.forEach((listener) => listener(nextSnapshot))
  }

  const clearPollTimer = () => {
    if (pollTimeoutHandle !== null) {
      scheduler.clearTimeout(pollTimeoutHandle)
      pollTimeoutHandle = null
      pollMode = null
    }
  }

  const clearReconnectTimer = () => {
    if (reconnectTimeoutHandle !== null) {
      scheduler.clearTimeout(reconnectTimeoutHandle)
      reconnectTimeoutHandle = null
    }
  }

  const abortActivePoll = () => {
    activePollController?.abort()
    activePollController = null
    activePollMode = null
  }

  const clearFollowupPollTimer = () => {
    if (pollMode === "followup") {
      clearPollTimer()
    }
  }

  const abortFollowupPoll = () => {
    if (activePollMode === "followup") {
      abortActivePoll()
    }
  }

  const abortNonFollowupPoll = () => {
    if (activePollMode === "manual" || activePollMode === "resync") {
      abortActivePoll()
    }
  }

  const schedulePoll = (delayMs: number, mode: ScheduledPollMode) => {
    if (disposed) return

    clearPollTimer()
    if (snapshot.transportMode === "stopped") return

    if (mode === "followup" && snapshot.transportMode !== "polling") {
      return
    }

    if (mode === "followup" && isTerminalState(snapshot.state)) {
      if (!snapshot.isPollingPaused) {
        snapshot = {
          ...snapshot,
          isPollingPaused: true,
        }
        emit()
      }
      return
    }

    if (snapshot.isPollingPaused) {
      snapshot = {
        ...snapshot,
        isPollingPaused: false,
      }
      emit()
    }

    pollMode = mode
    pollTimeoutHandle = scheduler.setTimeout(() => {
      pollTimeoutHandle = null
      const nextMode = pollMode
      pollMode = null
      void runPoll(nextMode ?? "followup")
    }, delayMs)
  }

  const syncPollingState = () => {
    if (snapshot.transportMode !== "polling") {
      return
    }

    const shouldPause = isTerminalState(snapshot.state)
    if (shouldPause) {
      clearPollTimer()
      abortActivePoll()
    }

    if (snapshot.isPollingPaused !== shouldPause) {
      snapshot = {
        ...snapshot,
        isPollingPaused: shouldPause,
      }
      emit()
    }

    if (
      !shouldPause &&
      pollTimeoutHandle === null &&
      activePollController === null
    ) {
      schedulePoll(getPollDelayMs(), "followup")
    }
  }

  const closeStream = () => {
    const currentConnection = streamConnection
    streamConnection = null
    currentConnection?.close()
  }

  const markAuthoritativeStateUpdate = () => {
    authoritativeStateSeq += 1
  }

  const scheduleImmediateReconciliation = () => {
    if (disposed || snapshot.transportMode === "stopped") {
      return
    }

    schedulePoll(
      0,
      snapshot.transportMode === "polling" ? "followup" : "resync",
    )
  }

  const runPoll = async (mode: ActivePollMode) => {
    const responseSeq = ++requestSeq
    const authoritativeStateSeqAtStart = authoritativeStateSeq
    snapshot = {
      ...snapshot,
      isRefreshInFlight: true,
    }
    emit()

    abortActivePoll()
    const controller = new AbortController()
    activePollController = controller
    activePollMode = mode

    try {
      const nextState = await poll(controller.signal)
      const wasInvalidatedByAuthoritativeUpdate =
        authoritativeStateSeq !== authoritativeStateSeqAtStart
      if (
        shouldApplyPollResult({
          cancelled: disposed,
          activeRequestSeq: requestSeq,
          responseSeq,
          aborted: controller.signal.aborted,
        }) &&
        !wasInvalidatedByAuthoritativeUpdate
      ) {
        snapshot = {
          ...snapshot,
          state: applySnapshot(snapshot.state, nextState),
          needsResync: false,
          lastSyncSource: "poll",
          isPollingPaused:
            snapshot.transportMode === "polling"
              ? isTerminalState(nextState)
              : false,
        }
        emit()
      }
    } catch {
      // Keep the degraded mode active and let the next poll/reconnect recover.
    } finally {
      if (responseSeq === requestSeq) {
        activePollController = null
        activePollMode = null
        snapshot = {
          ...snapshot,
          isRefreshInFlight: false,
        }
        emit()
      }

      if (!disposed && pendingResyncAfterActivePoll) {
        pendingResyncAfterActivePoll = false
        scheduleImmediateReconciliation()
      } else if (
        mode === "followup" &&
        !disposed &&
        snapshot.transportMode === "polling" &&
        !isTerminalState(snapshot.state)
      ) {
        schedulePoll(getPollDelayMs(), "followup")
      }
    }
  }

  const requestResync = () => {
    if (!snapshot.needsResync) {
      snapshot = {
        ...snapshot,
        needsResync: true,
      }
      emit()
    }

    if (activePollController !== null) {
      pendingResyncAfterActivePoll = true
      return
    }

    schedulePoll(
      0,
      snapshot.transportMode === "polling" ? "followup" : "resync",
    )
  }

  const handleStreamFailure = (
    reason: Exclude<LiveJobsRealtimeFailureReason, null>,
  ) => {
    if (disposed) return

    if (snapshot.transportMode === "polling" && snapshot.isReconnectPending) {
      return
    }

    closeStream()

    snapshot = {
      ...snapshot,
      transportMode: "polling",
      isPollingPaused: isTerminalState(snapshot.state),
      isReconnectPending: true,
      needsResync: true,
      lastFailureReason: reason,
    }
    emit()

    shouldResyncAfterReconnect = true

    if (!snapshot.isPollingPaused) {
      schedulePoll(getPollDelayMs(), "followup")
    }

    clearReconnectTimer()
    reconnectTimeoutHandle = scheduler.setTimeout(() => {
      reconnectTimeoutHandle = null
      connectStream()
    }, getReconnectDelayMs())
  }

  const connectStream = () => {
    if (disposed) return

    try {
      streamConnection = openStream({
        onOpen: () => {
          if (disposed) return
          clearFollowupPollTimer()
          abortFollowupPoll()
          snapshot = {
            ...snapshot,
            transportMode: "live",
            isPollingPaused: false,
            isReconnectPending: false,
            lastFailureReason: null,
          }
          emit()
        },
        onSnapshot: (nextState) => {
          if (disposed) return
          clearFollowupPollTimer()
          abortFollowupPoll()
          abortNonFollowupPoll()
          markAuthoritativeStateUpdate()
          snapshot = {
            ...snapshot,
            state: applySnapshot(snapshot.state, nextState),
            needsResync: false,
            lastSyncSource: "stream-snapshot",
          }
          emit()

          if (shouldResyncAfterReconnect) {
            shouldResyncAfterReconnect = false
            requestResync()
          }
        },
        onUpsert: (job) => {
          if (disposed) return
          clearFollowupPollTimer()
          abortFollowupPoll()

          const result = applyUpsert(snapshot.state, job)
          if (!result.didChange) {
            return
          }

          abortNonFollowupPoll()
          markAuthoritativeStateUpdate()
          snapshot = {
            ...snapshot,
            state: result.nextState,
            lastSyncSource: "stream-upsert",
          }
          emit()

          if (result.needsResync) {
            requestResync()
          }
        },
        onError: () => {
          handleStreamFailure("stream-error")
        },
        onClose: () => {
          handleStreamFailure("stream-close")
        },
      })
    } catch {
      handleStreamFailure("stream-error")
    }
  }

  return {
    start: () => {
      if (started) return
      started = true
      disposed = false
      connectStream()
    },
    stop: () => {
      if (disposed) return
      disposed = true
      clearPollTimer()
      clearReconnectTimer()
      abortActivePoll()
      closeStream()
      snapshot = {
        ...snapshot,
        transportMode: "stopped",
        isPollingPaused: false,
        isReconnectPending: false,
        isRefreshInFlight: false,
        needsResync: false,
      }
      emit()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => ({ ...snapshot }),
    refreshNow: async () => {
      clearPollTimer()
      await runPoll("manual")
    },
    replaceState: (nextState) => {
      markAuthoritativeStateUpdate()
      snapshot = {
        ...snapshot,
        state: nextState,
        lastSyncSource: "external",
      }
      emit()
      syncPollingState()
    },
  }
}

export function createLiveJobsListRealtimeController({
  initialJobs,
  openStream,
  poll,
  getPollDelayMs,
  getReconnectDelayMs,
  scheduler,
}: CreateLiveJobsListRealtimeControllerOptions): LiveJobsListRealtimeController {
  return createLiveJobsRealtimeController({
    initialState: initialJobs,
    openStream,
    poll,
    applySnapshot: (_currentJobs, nextJobs) => nextJobs,
    applyUpsert: applyJobListUpsert,
    isTerminalState: () => false,
    getPollDelayMs,
    getReconnectDelayMs,
    scheduler,
  })
}

export function createInitialLiveJobsRealtimeSnapshot<TState>(
  initialState: TState,
): LiveJobsRealtimeSnapshot<TState> {
  return {
    state: initialState,
    transportMode: "connecting",
    isPollingPaused: false,
    isReconnectPending: false,
    isRefreshInFlight: false,
    needsResync: false,
    lastFailureReason: null,
    lastSyncSource: "initial",
  }
}

export function createLiveJobDetailRealtimeController({
  initialJob,
  openStream,
  poll,
  getPollDelayMs,
  getReconnectDelayMs,
  scheduler,
}: CreateLiveJobDetailRealtimeControllerOptions): LiveJobsDetailRealtimeController {
  return createLiveJobsRealtimeController({
    initialState: initialJob,
    openStream,
    poll,
    applySnapshot: applyDetailSnapshot,
    applyUpsert: applyDetailUpsert,
    isTerminalState: (job) => isTerminalJobStatus(job.status),
    getPollDelayMs,
    getReconnectDelayMs,
    scheduler,
  })
}

export function createLiveJobsListEventSourceOpener({
  url = "/api/jobs/events",
  createEventSource,
}: {
  url?: string
  createEventSource?: LiveJobsEventSourceFactory
} = {}): (
  callbacks: LiveJobsRealtimeStreamCallbacks<JobRecord[]>,
) => LiveJobsRealtimeStreamConnection {
  return createEventSourceOpener<JobRecord[], LiveJobsListStreamEvent>({
    url,
    createEventSource,
    readSnapshot: (event) => {
      if (event.type !== "snapshot") {
        throw new Error("Expected a list snapshot event")
      }
      return event.jobs
    },
  })
}

export function createLiveJobDetailEventSourceOpener({
  jobId,
  createEventSource,
}: {
  jobId: string
  createEventSource?: LiveJobsEventSourceFactory
}): (
  callbacks: LiveJobsRealtimeStreamCallbacks<JobRecord>,
) => LiveJobsRealtimeStreamConnection {
  return createEventSourceOpener<JobRecord, LiveJobDetailStreamEvent>({
    url: `/api/jobs/${encodeURIComponent(jobId)}/events`,
    createEventSource,
    readSnapshot: (event) => {
      if (event.type !== "snapshot") {
        throw new Error("Expected a detail snapshot event")
      }
      return event.job
    },
  })
}
