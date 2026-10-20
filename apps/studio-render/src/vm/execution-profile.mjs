/** Fixed host bounds, checked against the runtime-neutral contract in tests. */
export const executionProfile = Object.freeze({
  id: "studio-render-4/3600s-180prep-24cpu-32g-4096p-4096child-128m",
  jobMs: 3600000,
  cpu: 24,
  memoryBytes: 34359738368,
  aggregatePids: 4096,
  childPids: 4096,
  preparationMs: 180000,
  requestMs: 3620000,
})
