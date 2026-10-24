export type SearchTraceHealthCounters = {
  writeSuccesses: number
  writeFailures: number
  writeTimeouts: number
  rawCaptureDisabled: number
  lastWriteSuccessAt: string | null
  lastWriteFailureAt: string | null
  lastWriteTimeoutAt: string | null
  lastRawCaptureDisabledAt: string | null
}

const counters: SearchTraceHealthCounters = {
  writeSuccesses: 0,
  writeFailures: 0,
  writeTimeouts: 0,
  rawCaptureDisabled: 0,
  lastWriteSuccessAt: null,
  lastWriteFailureAt: null,
  lastWriteTimeoutAt: null,
  lastRawCaptureDisabledAt: null,
}

function nowIso(): string {
  return new Date().toISOString()
}

export function recordSearchTraceWriteSuccess(): void {
  counters.writeSuccesses += 1
  counters.lastWriteSuccessAt = nowIso()
}

export function recordSearchTraceWriteFailure(): void {
  counters.writeFailures += 1
  counters.lastWriteFailureAt = nowIso()
}

export function recordSearchTraceWriteTimeout(): void {
  counters.writeTimeouts += 1
  counters.lastWriteTimeoutAt = nowIso()
}

export function recordSearchTraceRawCaptureDisabled(): void {
  counters.rawCaptureDisabled += 1
  counters.lastRawCaptureDisabledAt = nowIso()
}

export function getSearchTraceHealthCounters(): SearchTraceHealthCounters {
  return { ...counters }
}

export function __resetSearchTraceHealthForTest(): void {
  counters.writeSuccesses = 0
  counters.writeFailures = 0
  counters.writeTimeouts = 0
  counters.rawCaptureDisabled = 0
  counters.lastWriteSuccessAt = null
  counters.lastWriteFailureAt = null
  counters.lastWriteTimeoutAt = null
  counters.lastRawCaptureDisabledAt = null
}
