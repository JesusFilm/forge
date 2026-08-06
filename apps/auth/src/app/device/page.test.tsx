import { afterEach, describe, expect, it, vi } from "vitest"

const {
  deviceClientMock,
  getSessionMock,
  redirectMock,
  resolveRequestingAppNameMock,
} = vi.hoisted(() => ({
  deviceClientMock: vi.fn(() => null),
  getSessionMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
  resolveRequestingAppNameMock: vi.fn(async () => "Jesus Film Admin"),
}))

// Real `firstParam`, spied `resolveRequestingAppName`. The spy has to answer
// with a plausible display name, or a page that wrongly consulted it would
// still fall through to the placeholder and the assertion below would pass
// vacuously.
vi.mock("@/app/login/login-page-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/login/login-page-data")>()),
  resolveRequestingAppName: resolveRequestingAppNameMock,
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/auth/config", () => ({
  auth: { api: { getSession: getSessionMock } },
}))

vi.mock("@/app/device/device-page-client", () => ({
  DeviceApprovalPageClient: deviceClientMock,
}))

afterEach(() => {
  deviceClientMock.mockClear()
  getSessionMock.mockReset()
  redirectMock.mockClear()
  resolveRequestingAppNameMock.mockClear()
})

async function renderDevicePage(params: Record<string, string | string[]>) {
  const DevicePage = (await import("@/app/device/page")).default
  return (await DevicePage({
    searchParams: Promise.resolve(params),
  })) as { props: Record<string, unknown> }
}

describe("DevicePage", () => {
  it("never renders the approval screen without a session", async () => {
    getSessionMock.mockResolvedValue(null)

    await expect(
      renderDevicePage({ user_code: "019-450-7302" }),
    ).rejects.toThrow("redirect:/login?user_code=0194507302&prompt=login")
    expect(deviceClientMock).not.toHaveBeenCalled()
  })

  it("treats a session without an email as signed out", async () => {
    getSessionMock.mockResolvedValue({ user: {} })

    await expect(renderDevicePage({ user_code: "0194507302" })).rejects.toThrow(
      "redirect:/login?",
    )
  })

  it("renders the approval screen for the signed-in account", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "mum@example.com" } })

    const element = await renderDevicePage({ user_code: "019-450-7302" })

    expect(element.props).toMatchObject({
      accountEmail: "mum@example.com",
      initialUserCode: "0194507302",
    })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("never lets a query parameter name the requesting application", async () => {
    // `device-grant-plugin.ts` builds verification_uri_complete as
    // `/device?user_code=…` and never emits a client_id, so any client_id here
    // came from whoever crafted the link. Letting it name the app would put a
    // trusted display name on an approval screen for someone else's code.
    getSessionMock.mockResolvedValue({ user: { email: "mum@example.com" } })

    const element = await renderDevicePage({
      client_id: "jfp_admin_local",
      user_code: "0194507302",
    })

    expect(element.props.fallbackAppName).toBe("Jesus Film on your TV")
    expect(resolveRequestingAppNameMock).not.toHaveBeenCalled()
  })

  it("falls back to code entry when the link carried no usable code", async () => {
    getSessionMock.mockResolvedValue({ user: { email: "mum@example.com" } })

    const element = await renderDevicePage({ user_code: "🙂🙂" })

    expect(element.props.initialUserCode).toBe("")
  })
})
