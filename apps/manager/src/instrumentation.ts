export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Warm read-heavy caches before first request arrives.
    // Railway rolling deploys give Manager a few seconds before traffic routes here.
    const { videoCache } = await import("@/app/api/videos/cache")
    const { languageCache } = await import("@/app/api/languages/cache")
    const { latestCoverageSnapshotCache } =
      await import("@/app/api/coverage-snapshots/cache")
    void Promise.allSettled([
      videoCache.warm(),
      languageCache.warm(),
      latestCoverageSnapshotCache.warm(),
    ]).then((results) => {
      const failed = results.filter((r) => r.status === "rejected")
      if (failed.length > 0) {
        console.warn(`[cache-warm] ${failed.length} cache(s) failed to warm`)
      } else {
        console.log("[cache-warm] All caches warmed successfully")
      }
    })
  }
}
