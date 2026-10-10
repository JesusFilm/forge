import { getAuthBaseUrl } from "@/config/env"

export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const initialized = import("@/auth/config")
      .then(({ auth }) => auth.$context)
      .then(
        () => true,
        () => false,
      )
    const ok = await Promise.race([
      initialized,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 5000)
      }),
    ])
    return Response.json(
      { ok, service: "forge-auth", authBaseUrl: getAuthBaseUrl() },
      {
        status: ok ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  } finally {
    clearTimeout(timer)
  }
}
