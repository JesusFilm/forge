export type RecommendationIdentity = {
  viewerToken: string
  sessionToken: string
  expiresAt: string
  lastActivity: number
}

export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000

export type IdentityDependencies = {
  read: () => Promise<RecommendationIdentity | null>
  write: (identity: RecommendationIdentity) => Promise<void>
  readChoice: () => Promise<boolean | null>
  bootstrap: () => Promise<Omit<RecommendationIdentity, "lastActivity">>
  transition: (
    identity: RecommendationIdentity,
    action: "status" | "withdraw",
  ) => Promise<void>
  randomToken: () => string
  now: () => number
  onAuthorityChanged?: () => void
}

export function createIdentityStore(deps: IdentityDependencies) {
  let current: RecommendationIdentity | null = null
  let flight: Promise<RecommendationIdentity> | null = null
  let playbackCount = 0
  let invalidated = false
  const load = async () => {
    const now = deps.now()
    let identity = invalidated ? null : (current ?? (await deps.read()))
    let authorityChanged =
      invalidated || (identity != null && Date.parse(identity.expiresAt) <= now)
    if (!identity || Date.parse(identity.expiresAt) <= now) {
      identity = { ...(await deps.bootstrap()), lastActivity: now }
      if ((await deps.readChoice()) === false)
        await deps.transition(identity, "withdraw")
    } else if (
      playbackCount === 0 &&
      now - identity.lastActivity >= SESSION_IDLE_MS
    ) {
      identity = {
        ...identity,
        sessionToken: deps.randomToken(),
        lastActivity: now,
      }
      await deps.transition(identity, "status")
      authorityChanged = true
    }
    current = { ...identity, lastActivity: now }
    await deps.write(current)
    invalidated = false
    if (authorityChanged) deps.onAuthorityChanged?.()
    return current
  }
  return {
    get() {
      if (flight) return flight
      const pending = load()
      flight = pending
      const release = () => {
        if (flight === pending) flight = null
      }
      void pending.then(release, release)
      return pending
    },
    beginPlayback() {
      playbackCount++
    },
    async endPlayback() {
      playbackCount = Math.max(0, playbackCount - 1)
      if (current) {
        current = { ...current, lastActivity: deps.now() }
        await deps.write(current)
      }
    },
    forget() {
      current = null
      invalidated = true
    },
  }
}
