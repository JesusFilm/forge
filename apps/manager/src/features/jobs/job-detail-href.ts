import type { Route } from "next"

export function buildJobDetailHref(jobId: string, suffix: string): Route {
  return `/dashboard/jobs/${jobId}${suffix}` as Route
}
