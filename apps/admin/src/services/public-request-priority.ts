type PublicRequestPriorityState = {
  active: number
  completed: number
  pendingDeadlines: number[]
  idleWaiters: Set<() => void>
}

const PUBLIC_REQUEST_PRIORITY_STATE = Symbol.for(
  "forge.admin.public-request-priority",
)
const EXPERIENCE_EDITOR_PRIORITY_WAIT_MAX_MS = 250
const EXPERIENCE_EDITOR_PUBLIC_REGISTRATION_GRACE_MS = 25

function priorityState() {
  const shared = globalThis as typeof globalThis & {
    [PUBLIC_REQUEST_PRIORITY_STATE]?: PublicRequestPriorityState
  }
  const existing = shared[PUBLIC_REQUEST_PRIORITY_STATE]
  if (
    existing &&
    Number.isFinite(existing.active) &&
    Number.isFinite(existing.completed) &&
    Array.isArray(existing.pendingDeadlines) &&
    existing.idleWaiters instanceof Set
  ) {
    return existing
  }
  const state: PublicRequestPriorityState = {
    active: 0,
    completed: 0,
    pendingDeadlines: [],
    idleWaiters: new Set(),
  }
  shared[PUBLIC_REQUEST_PRIORITY_STATE] = state
  return state
}

function hasPendingPublicRequest(state: PublicRequestPriorityState) {
  const now = Date.now()
  state.pendingDeadlines = state.pendingDeadlines.filter(
    (expiresAt) => expiresAt > now,
  )
  return state.pendingDeadlines.length > 0
}

function releaseIdleWaiters(state: PublicRequestPriorityState) {
  const waiters = [...state.idleWaiters]
  waiters.forEach((resolve) => resolve())
}

/** Marks public work at the proxy boundary, before route preparation. */
export function registerPublicGraphqlAdmission() {
  const state = priorityState()
  state.pendingDeadlines.push(
    Date.now() + EXPERIENCE_EDITOR_PRIORITY_WAIT_MAX_MS,
  )
}

/** Tracks public GraphQL work so lower-priority admin reads can yield to it. */
export async function withPublicGraphqlPriority<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const state = priorityState()
  hasPendingPublicRequest(state)
  state.pendingDeadlines.shift()
  state.active += 1
  try {
    return await operation()
  } finally {
    state.active = Math.max(0, state.active - 1)
    state.completed += 1
    releaseIdleWaiters(state)
  }
}

async function waitForPublicGraphql() {
  const state = priorityState()
  if (state.active === 0 && !hasPendingPublicRequest(state)) return

  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (state.active > 0 || hasPendingPublicRequest(state)) {
        return
      }
      if (timer) clearTimeout(timer)
      state.idleWaiters.delete(finish)
      resolve()
    }
    state.idleWaiters.add(finish)
    timer = setTimeout(() => {
      state.idleWaiters.delete(finish)
      resolve()
    }, EXPERIENCE_EDITOR_PRIORITY_WAIT_MAX_MS)
  })
}

/**
 * Gives same-instant public requests a short bounded window to register at the
 * proxy boundary, then waits only while public work is pending or active. A
 * timer turn alone is not sufficient under concurrent route preparation: the
 * editor middleware can resume before the public GraphQL handler has entered.
 */
export async function admitExperienceEditorRequest() {
  await new Promise<void>((resolve) =>
    setTimeout(resolve, EXPERIENCE_EDITOR_PUBLIC_REGISTRATION_GRACE_MS),
  )
  await waitForPublicGraphql()
}
