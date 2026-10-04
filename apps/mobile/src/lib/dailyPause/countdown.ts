// The Reflect and Pray pause timers (KTD9, R16, R17, R26). A timer keeps the
// time left, not an end time, so the time stops while the app is not active
// and continues on return. At zero it stops and waits; it never moves the run.
import { useEffect, useState } from "react"
import { AppState, type AppStateStatus } from "react-native"

const SECOND_MS = 1000

export type Countdown = {
  totalMs: number
  /** The time left at this render. */
  msLeft: number
  /** Whole seconds left, rounded up, so 0 comes only when the time is over. */
  secondsLeft: number
  /** True while the time goes down: the app is active and time is left. */
  running: boolean
  /** The time left when this run started, at the mount or a return. It stays
   *  the same for the whole run, and it is null while the time does not run. */
  runFromMs: number | null
  done: boolean
}

type Clock = {
  totalMs: number
  /** The time left at `since`, or at the hold. */
  leftMs: number
  /** When the time started to go down again; null while it holds. */
  since: number | null
}

function leftAt(clock: Clock, now: number): number {
  if (clock.since === null) return clock.leftMs
  return Math.max(0, clock.leftMs - (now - clock.since))
}

function hold(clock: Clock, now: number): Clock {
  if (clock.since === null) return clock
  return { ...clock, leftMs: leftAt(clock, now), since: null }
}

function proceed(clock: Clock, now: number): Clock {
  if (clock.since !== null) return clock
  return { ...clock, since: now }
}

function isAway(state: AppStateStatus | null | undefined): boolean {
  return state === "background" || state === "inactive"
}

/** "0:45", "1:30". */
export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

function unit(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/** What VoiceOver says for the time left: "1 minute 30 seconds left". */
export function spokenTimeLeft(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const parts = [
    minutes > 0 ? unit(minutes, "minute") : null,
    rest > 0 || minutes === 0 ? unit(rest, "second") : null,
  ].filter((part) => part !== null)
  return `${parts.join(" ")} left`
}

/** A pause timer of `totalSec` that starts at mount. */
export function useCountdown(totalSec: number): Countdown {
  const [clock, setClock] = useState<Clock>(() => {
    const now = Date.now()
    const started: Clock = {
      totalMs: totalSec * SECOND_MS,
      leftMs: totalSec * SECOND_MS,
      since: now,
    }
    return isAway(AppState.currentState) ? hold(started, now) : started
  })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const at = Date.now()
      setClock((current) =>
        state === "active" ? proceed(current, at) : hold(current, at),
      )
      setNow(at)
    })
    return () => subscription.remove()
  }, [])

  const msLeft = leftAt(clock, now)
  const running = clock.since !== null && msLeft > 0

  // One render at each whole second. The time comes from the clock, not from
  // a count of ticks, so a late timer cannot make the pause longer.
  useEffect(() => {
    if (!running) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      msLeft % SECOND_MS || SECOND_MS,
    )
    return () => clearTimeout(timer)
  }, [running, msLeft])

  const secondsLeft = Math.ceil(msLeft / SECOND_MS)
  return {
    totalMs: clock.totalMs,
    msLeft,
    secondsLeft,
    running,
    runFromMs: running ? clock.leftMs : null,
    done: msLeft === 0,
  }
}
