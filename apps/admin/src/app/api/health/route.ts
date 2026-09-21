import { env } from "@/config/env"

const PRELOAD_ENTRIES = Symbol.for("forge.next.preloadEntries")

export async function GET() {
  if (env.NODE_ENV === "production") {
    // The pinned Next patch exposes its existing background preload promise.
    // Keep background entry loading ahead of readiness; preserve preloading.
    const completion = (
      globalThis as typeof globalThis & {
        [PRELOAD_ENTRIES]?: Promise<void>
      }
    )[PRELOAD_ENTRIES]
    if (!completion) {
      return Response.json({ status: "starting" }, { status: 503 })
    }
    await completion
    // Next ignores individual preload failures. GraphQL must initialize before
    // we admit API traffic; importing it performs no operation or mutation.
    await import("../graphql/route")
  }
  return Response.json({ status: "ok" }, { status: 200 })
}
