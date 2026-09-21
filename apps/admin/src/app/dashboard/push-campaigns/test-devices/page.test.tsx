import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminMessages } from "@/i18n/messages"
import type { PushTestDeviceRow } from "@/services/push/test-devices.service"

const uiMessages = {
  common: adminMessages.en.common,
  pages: adminMessages.en.pages,
}
const devices = adminMessages.en.pages.pushCampaigns.devices

const state: { role: "PUBLIC" | "VIEWER"; rows: PushTestDeviceRow[] } = {
  role: "VIEWER",
  rows: [],
}

vi.mock("@/i18n/server", () => ({
  getAdminMessages: vi.fn(async () => uiMessages as never),
}))

vi.mock("@/auth/session", () => ({
  requireSession: vi.fn(async () => ({ id: "user_1", role: state.role })),
}))

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/push/test-devices.service", () => ({
  listPushTestDevices: vi.fn(async () => state.rows),
}))

vi.mock("../components/test-device-manager", () => ({
  AddTestDeviceForm: () => <div data-testid="stub-add-test-device" />,
  RemoveTestDeviceButton: ({ label }: { label: string }) => (
    <div data-testid="stub-remove-test-device" data-label={label} />
  ),
}))

import PushTestDevicesPage from "./page"

async function html(node: Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(await node)
}

function device(overrides: Partial<PushTestDeviceRow> = {}): PushTestDeviceRow {
  return {
    id: "device_1",
    label: "Urim iPhone 15",
    testDeviceId: "ab12cd34ef",
    registrationId: "reg_1",
    platform: "IOS",
    active: true,
    createdAt: new Date("2026-09-20T10:00:00Z"),
    createdById: "user_1",
    ...overrides,
  }
}

describe("push test devices page", () => {
  beforeEach(() => {
    state.role = "VIEWER"
    state.rows = []
  })

  it("sends a principal without the campaign permission to the dashboard", async () => {
    state.role = "PUBLIC"
    await expect(html(PushTestDevicesPage())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    )
  })

  it("always offers the add form, including on the empty state", async () => {
    const markup = await html(PushTestDevicesPage())
    expect(markup).toContain('data-testid="stub-add-test-device"')
    expect(markup).toContain(devices.emptyTitle)
    expect(markup).toContain(devices.emptyDescription)
  })

  it("renders one row per device with the test ID and a remove control", async () => {
    state.rows = [device()]
    const markup = await html(PushTestDevicesPage())
    expect(markup).toContain("Urim iPhone 15")
    expect(markup).toContain("ab12cd34ef")
    expect(markup).toContain("IOS")
    expect(markup).toContain(devices.active)
    expect(markup).toContain('data-testid="stub-remove-test-device"')
    expect(markup).not.toContain(devices.emptyTitle)
  })

  it("marks a retired registration, which a test send cannot reach", async () => {
    state.rows = [device({ active: false })]
    const markup = await html(PushTestDevicesPage())
    expect(markup).toContain(devices.retired)
  })
})
