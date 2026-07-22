export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertGatewayRuntimeEnv } = await import("@/config/env")
    assertGatewayRuntimeEnv()
  }
}
