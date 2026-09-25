/**
 * Explore clip evidence (KTD9, R32): which clips earn a recommendation episode,
 * one open at a time. R33: nothing here reaches the watch progress store.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"

import type { RecommendationPlaybackRecorder } from "../recommendations/playbackRecorder"
import {
  createPlaybackRecorderForMedia,
  isPlaybackRecorderAvailable,
} from "../recommendations/playbackRecorderClient"
import { getRecommendationViewerStore } from "../recommendations/viewerIdentityClient"

/** R32: a clip episode starts once the clip has played this long, unbroken. */
export const CLIP_EPISODE_START_MS = 3_000

/** A new episode starts no sooner than this after the previous one started.
 *  It keeps fast swipes inside Admin's 30 mutations per minute. */
export const CLIP_EPISODE_GAP_MS = 10_000

/** R32: the most clip episodes one recommendation session counts. The count
 *  is stored beside a digest of the session token, so a relaunch keeps it. */
export const CLIP_EPISODES_PER_SESSION = 12

export const CLIP_EVIDENCE_STORAGE_KEY = "explore-clip-evidence"

/** Bump when the stored shape changes; an old value then reads as no count. */
export const CLIP_EVIDENCE_VERSION = 1

/** Keeps this digest apart from any other digest of the same token. */
export const CLIP_EVIDENCE_DIGEST_PREFIX = "forge-explore-clip-evidence-v1:"

const MAX_DIGEST_LENGTH = 128

export type ClipEvidenceCount = {
  sessionDigest: string
  count: number
}

type StoredClipEvidence = { v: number; s: string; n: number }

/** Tolerant: bad JSON, another version, or a bad shape reads as no count. */
export function parseStoredClipEvidence(
  raw: string | null,
): ClipEvidenceCount | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null
  }
  const stored = data as Partial<Record<keyof StoredClipEvidence, unknown>>
  if (stored.v !== CLIP_EVIDENCE_VERSION) return null
  if (
    typeof stored.s !== "string" ||
    stored.s.length === 0 ||
    stored.s.length > MAX_DIGEST_LENGTH ||
    typeof stored.n !== "number" ||
    !Number.isSafeInteger(stored.n) ||
    stored.n < 0
  ) {
    return null
  }
  return { sessionDigest: stored.s, count: stored.n }
}

export function serializeClipEvidence(value: ClipEvidenceCount): string {
  const stored: StoredClipEvidence = {
    v: CLIP_EVIDENCE_VERSION,
    s: value.sessionDigest,
    n: value.count,
  }
  return JSON.stringify(stored)
}

export type ClipEvidenceBudgetDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

export type ClipEvidenceBudget = ReturnType<typeof createClipEvidenceBudget>

/**
 * The session count and the gap. Memory is authoritative once the stored
 * value lands, and storage follows it. App-wide, so a feed remount keeps both.
 */
export function createClipEvidenceBudget(deps: ClipEvidenceBudgetDeps) {
  let current: ClipEvidenceCount | null = null
  let hydration: Promise<void> | null = null
  let landed = false
  let lastStartedAt = Number.NEGATIVE_INFINITY
  /** Writes land in the order they start, so an older count never lands last. */
  let writeChain: Promise<void> = Promise.resolve()

  function persist(value: ClipEvidenceCount) {
    const blob = serializeClipEvidence(value)
    writeChain = writeChain.then(async () => {
      try {
        await deps.setItem(CLIP_EVIDENCE_STORAGE_KEY, blob)
      } catch {
        // Memory still holds the count; the next episode writes it again.
      }
    })
  }

  function countFor(sessionDigest: string): number {
    return current?.sessionDigest === sessionDigest ? current.count : 0
  }

  return {
    /** Reads the stored count once. Never rejects; a bad read is no count. */
    hydrate(): Promise<void> {
      hydration ??= (async () => {
        let raw: string | null = null
        try {
          raw = await deps.getItem(CLIP_EVIDENCE_STORAGE_KEY)
        } catch {
          // An unreadable key reads as empty, the same as a corrupt one.
        }
        current ??= parseStoredClipEvidence(raw)
        landed = true
      })()
      return hydration
    },

    /** The earliest time the gap lets the next episode start. */
    nextStartAt(): number {
      return lastStartedAt + CLIP_EPISODE_GAP_MS
    },

    countFor,

    /**
     * Counts one episode that starts at `at`, or refuses at the cap. It is
     * synchronous, so two admissions can never both take the last slot.
     */
    tryStart(sessionDigest: string, at: number): boolean {
      if (!landed) return false
      const count = countFor(sessionDigest)
      if (count >= CLIP_EPISODES_PER_SESSION) return false
      current = { sessionDigest, count: count + 1 }
      lastStartedAt = at
      persist(current)
      return true
    },
  }
}

/** What the clip evidence needs from a recorder; the clip mode supplies it. */
export type ClipEpisodeRecorder = Pick<
  RecommendationPlaybackRecorder,
  "start" | "onPlayingChange" | "onTick" | "onLoop" | "dispose"
>

export type ClipEvidenceClip = {
  /** The reducer's load token. Every event names it, so an event from the
   *  standby or a stale load is dropped. A replay is a new token. */
  token: number
  /** The Admin video id the episode is claimed for. */
  mediaId: string
  /** Where a loop lands: the clip window's start in the full video. */
  windowStartSeconds: number
}

export type ClipEvidenceDeps = {
  /** False when the client is off or unprovisioned: nothing runs at all. */
  isAvailable: () => boolean
  /** Null when the client cannot record; the clip then sends nothing. */
  createRecorder: (mediaId: string) => ClipEpisodeRecorder | null
  /** The current recommendation session token, or null without an identity. */
  getSessionToken: () => Promise<string | null>
  digest: (sessionToken: string) => Promise<string | null>
  budget: ClipEvidenceBudget
  now?: () => number
  setTimer?: (run: () => void, ms: number) => () => void
}

export type ClipEvidence = ReturnType<typeof createClipEvidence>

function defaultSetTimer(run: () => void, ms: number): () => void {
  const id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

export function createClipEvidence(deps: ClipEvidenceDeps) {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? defaultSetTimer

  let clip: ClipEvidenceClip | null = null
  /** When the current clip's unbroken play began; null while it is not playing. */
  let playingSince: number | null = null
  let lastPosition = 0
  let cancelTimer: (() => void) | null = null
  let admitting: number | null = null
  let episode: ClipEpisodeRecorder | null = null
  let disposed = false

  function isCurrent(token: number): boolean {
    return !disposed && clip != null && clip.token === token
  }

  function cancel() {
    cancelTimer?.()
    cancelTimer = null
  }

  function closeEpisode() {
    const open = episode
    episode = null
    open?.dispose()
  }

  /** The timer starts on a real play edge only, never at a load. */
  function arm() {
    cancel()
    if (clip == null || playingSince == null || episode != null) return
    if (admitting === clip.token || !deps.isAvailable()) return
    const token = clip.token
    const dueAt = Math.max(
      playingSince + CLIP_EPISODE_START_MS,
      deps.budget.nextStartAt(),
    )
    cancelTimer = setTimer(
      () => {
        cancelTimer = null
        void admit(token)
      },
      Math.max(0, dueAt - now()),
    )
  }

  async function admit(token: number): Promise<void> {
    const since = playingSince
    if (!isCurrent(token) || since == null) return
    admitting = token
    // A refusal is final for this run. Only a break in play during the
    // lookup, or a gap another episode reopened, arms the timer again.
    let rearm = false
    const unbroken = () => {
      if (!isCurrent(token)) return false
      if (playingSince === since) return true
      rearm = true
      return false
    }
    try {
      const sessionToken = await deps.getSessionToken()
      if (sessionToken == null || !unbroken()) return
      const sessionDigest = await deps.digest(sessionToken)
      if (sessionDigest == null || !unbroken()) return
      await deps.budget.hydrate()
      if (!unbroken() || clip == null) return
      if (now() < deps.budget.nextStartAt()) {
        rearm = true
        return
      }
      const recorder = deps.createRecorder(clip.mediaId)
      if (recorder == null) return
      if (!deps.budget.tryStart(sessionDigest, now())) return
      episode = recorder
      recorder.start()
      recorder.onPlayingChange(true, lastPosition)
    } catch {
      // Evidence is best effort: a failed lookup sends nothing for this clip.
    } finally {
      if (admitting === token) admitting = null
      if (rearm && isCurrent(token)) arm()
    }
  }

  return {
    /**
     * The active clip changed: a swipe, a replay from history, or a release
     * (null). The open episode ends first, so at most one is ever open.
     */
    setClip(next: ClipEvidenceClip | null): void {
      if (disposed || next?.token === clip?.token) return
      cancel()
      closeEpisode()
      clip = next
      playingSince = null
      lastPosition = next?.windowStartSeconds ?? 0
    },

    /** The active player's play edge, or its pause. */
    onPlayingChange(
      token: number,
      isPlaying: boolean,
      positionSeconds: number,
    ): void {
      if (!isCurrent(token)) return
      lastPosition = positionSeconds
      if (isPlaying) {
        if (playingSince != null) return
        playingSince = now()
        if (episode != null) episode.onPlayingChange(true, positionSeconds)
        else arm()
        return
      }
      playingSince = null
      cancel()
      episode?.onPlayingChange(false, positionSeconds)
    },

    /** The active player's time update; `durationSeconds` is the full video's. */
    onTime(token: number, positionSeconds: number, durationSeconds: number) {
      if (!isCurrent(token)) return
      lastPosition = positionSeconds
      if (playingSince != null)
        episode?.onTick(positionSeconds, durationSeconds)
    },

    /** `useFeedPlayers`' `onLoop`: the clip jumped back to its window start. */
    onLoop(token: number): void {
      if (!isCurrent(token) || clip == null) return
      lastPosition = clip.windowStartSeconds
      episode?.onLoop(clip.windowStartSeconds)
    },

    /** The feed unmounts: the open episode ends, and no start is left armed. */
    dispose(): void {
      if (disposed) return
      disposed = true
      cancel()
      closeEpisode()
      clip = null
    },
  }
}

let budget: ClipEvidenceBudget | null = null

/** The app-wide count and gap. */
export function getClipEvidenceBudget(): ClipEvidenceBudget {
  budget ??= createClipEvidenceBudget({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  })
  return budget
}

/** Test seam: drop the singleton so the next getter builds a fresh budget. */
export function resetClipEvidenceBudgetForTests(): void {
  budget = null
}

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * SHA-256 of the prefixed session token, as hex. `expo-crypto` is required
 * lazily so module init and jest never touch the native module. Null when
 * the digest fails: without it the count cannot hold, so nothing is sent.
 */
export async function digestSessionToken(
  sessionToken: string,
): Promise<string | null> {
  try {
    const Crypto = require("expo-crypto") as typeof import("expo-crypto")
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${CLIP_EVIDENCE_DIGEST_PREFIX}${sessionToken}`,
    )
    return typeof digest === "string" && digest.length > 0 ? digest : null
  } catch {
    return null
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

async function currentSessionToken(): Promise<string | null> {
  const result = await getRecommendationViewerStore().get()
  return result.kind === "ready" ? result.identity.sessionToken : null
}

/** One per feed mount; the feed disposes it on unmount. */
export function createClipEvidenceForFeed(): ClipEvidence {
  return createClipEvidence({
    isAvailable: isPlaybackRecorderAvailable,
    createRecorder: (mediaId) =>
      createPlaybackRecorderForMedia({ mediaId, mode: "clip" }),
    getSessionToken: currentSessionToken,
    digest: digestSessionToken,
    budget: getClipEvidenceBudget(),
  })
}
