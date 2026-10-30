import { readFileSync } from "node:fs"
import {
  readSchedulerSnapshot,
  computeSchedulerPressure,
} from "<apps/web>/src/observability/scheduler-pressure.ts"
const rf = (p: string) => {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return undefined
  }
}
const a = readSchedulerSnapshot(
  rf,
  process.pid,
  Number(process.hrtime.bigint()),
)
const end = Date.now() + 300
while (Date.now() < end) {}
const b = readSchedulerSnapshot(
  rf,
  process.pid,
  Number(process.hrtime.bigint()),
)
console.log(JSON.stringify(a))
console.log(JSON.stringify(computeSchedulerPressure(a, b)))
