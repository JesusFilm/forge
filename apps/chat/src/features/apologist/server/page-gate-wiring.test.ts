// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest"
vi.mock("@/components/shell/app-shell", () => ({ AppShell: () => null }))
vi.mock("@/auth/identity", () => ({
  getChatIdentity: async () => ({
    sub: "tester",
    email: "agent@local",
    emailVerified: true,
  }),
}))
vi.mock("@/config/env", () => ({ chatAuthConfigured: () => true }))
vi.mock("@/lib/seeker-gate", () => ({
  resolveSeekerGate: async () => ({ seekerEnabled: true }),
}))
afterEach(() => vi.unstubAllEnvs())
it("resolves the same optional capability on home and saved-conversation pages", async () => {
  const Home = (await import("@/app/page")).default
  const Conversation = (await import("@/app/c/[id]/page")).default
  const pages = () =>
    Promise.all([
      Home({ searchParams: Promise.resolve({}) }),
      Conversation({
        params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
        searchParams: Promise.resolve({}),
      }),
    ])
  vi.stubEnv("APOLOGIST_COMPARE_ENABLED", "true")
  vi.stubEnv("APOLOGIST_ALLOWED_EMAILS", "agent@local")
  for (const page of await pages())
    expect(page.props.comparisonEnabled).toBe(true)
  vi.stubEnv("APOLOGIST_ALLOWED_EMAILS", "")
  for (const page of await pages())
    expect(page.props.comparisonEnabled).toBe(false)
})
