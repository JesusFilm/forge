export class StudioFramePoolError extends Error {}

/** Keep at most one completed/in-flight range per worker until encoding consumes it. */
export async function renderOrderedFrames({
  durationInFrames,
  workerCount,
  chunkFrames,
  failure: externalFailure,
  createWorker,
  consume,
}) {
  for (const value of [durationInFrames, workerCount, chunkFrames]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new StudioFramePoolError(
        "Frame pool bounds must be positive integers",
      )
  }
  const count = Math.ceil(durationInFrames / chunkFrames)
  const workers = []
  const pending = new Map()
  let failed = false
  let rejectFailure
  const failure = new Promise((_, reject) => {
    rejectFailure = reject
  })
  // Observe immediately: a later range can fail while an earlier one is pending.
  failure.catch(() => {})
  const observe = (task) =>
    Promise.resolve(task).catch((error) => {
      failed = true
      rejectFailure(error)
      throw error
    })
  if (externalFailure) observe(externalFailure).catch(() => {})
  const schedule = (index, worker) => {
    if (failed) return
    const start = index * chunkFrames
    const range = {
      index,
      start,
      end: Math.min(durationInFrames - 1, start + chunkFrames - 1),
    }
    const task = observe(Promise.resolve().then(() => worker.render(range)))
    task.catch(() => {})
    pending.set(index, { task, range, worker })
  }
  let completed = false
  let cleanupResults = []
  try {
    for (let id = 0; id < Math.min(workerCount, count); id++) {
      const worker = createWorker(id)
      workers.push(worker)
      if (worker.failed) observe(worker.failed).catch(() => {})
      // Observe initialization before creating another worker, which may throw.
      worker.ready = observe(worker.ready)
      worker.ready.catch(() => {})
    }
    await Promise.race([
      Promise.all(workers.map((worker) => worker.ready)),
      failure,
    ])
    for (let index = 0; index < workers.length; index++)
      schedule(index, workers[index])
    for (let index = 0; index < count; index++) {
      const { task, range, worker } = pending.get(index)
      await Promise.race([task, failure])
      await Promise.race([
        Promise.resolve().then(() => consume(range)),
        failure,
      ])
      pending.delete(index)
      if (index + workers.length < count)
        schedule(index + workers.length, worker)
    }
    completed = true
  } finally {
    cleanupResults = await Promise.allSettled(
      workers.map((worker) =>
        Promise.resolve().then(() => worker.close(!completed)),
      ),
    )
  }
  const rejected = cleanupResults.find((result) => result.status === "rejected")
  if (rejected) throw rejected.reason
}
