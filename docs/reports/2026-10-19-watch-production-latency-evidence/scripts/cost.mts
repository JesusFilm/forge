import { readFileSync } from "node:fs"
import { readSchedulerSnapshot } from "<apps/web>/src/observability/scheduler-pressure.ts"
const rf = (p: string) => {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return undefined
  }
}
for (let i = 0; i < 50; i++) readSchedulerSnapshot(rf, process.pid, 0)
const t = process.hrtime.bigint()
const N = 2000
for (let i = 0; i < N; i++) readSchedulerSnapshot(rf, process.pid, 0)
console.log("us_per_sample", Number(process.hrtime.bigint() - t) / N / 1000)
