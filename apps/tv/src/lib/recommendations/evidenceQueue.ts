export function createEvidenceQueue<Event>(deps: {
  send: (events: Event[]) => Promise<void>
  retryable: (error: unknown) => boolean
  now: () => number
  failed?: (error: unknown) => void
}) {
  const batches: {
    events: Event[]
    firstAttempt: number | null
    attempts: number
  }[] = []
  let draining = false
  let retired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const drain = async () => {
    if (draining || retired || timer) return
    draining = true
    try {
      while (batches.length && !retired) {
        const batch = batches[0]
        batch.firstAttempt ??= deps.now()
        batch.attempts++
        try {
          await deps.send(batch.events)
          if (batches[0] === batch) batches.shift()
        } catch (error) {
          if (
            !deps.retryable(error) ||
            batch.attempts >= 3 ||
            deps.now() - batch.firstAttempt >= 30000
          ) {
            retired = true
            batches.length = 0
            deps.failed?.(error)
          } else {
            timer = setTimeout(
              () => {
                timer = undefined
                void drain()
              },
              batch.attempts === 1 ? 1000 : 8000,
            )
          }
          break
        }
      }
    } finally {
      draining = false
    }
  }
  return {
    push(events: Event[]) {
      if (retired) return
      if (batches.length + Math.ceil(events.length / 16) > 64) {
        retired = true
        batches.length = 0
        clearTimeout(timer)
        return
      }
      for (let i = 0; i < events.length; i += 16)
        batches.push({
          events: events.slice(i, i + 16),
          firstAttempt: null,
          attempts: 0,
        })
      void drain()
    },
    retire() {
      retired = true
      batches.length = 0
      clearTimeout(timer)
    },
  }
}
