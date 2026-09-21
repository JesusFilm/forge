/**
 * R31 — the test-device list. A test phone is any phone whose notification
 * test ID an admin user has added here, so this page is what R10 depends on.
 */
import type { Route } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import {
  DashboardPageHeader,
  DataTable,
  PageSection,
  SecondaryButton,
  StatusPill,
} from "@/components/admin-ui"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { getAdminMessages } from "@/i18n/server"
import { listPushTestDevices } from "@/services/push/test-devices.service"

import { PUSH_CAMPAIGNS_PATH } from "../components/action-state"
import { formatPushUtcDate } from "../components/campaign-view"
import {
  AddTestDeviceForm,
  RemoveTestDeviceButton,
} from "../components/test-device-manager"

export default async function PushTestDevicesPage() {
  const principal = await requireSession()
  if (!hasPermission(principal, "write:push-campaigns")) {
    redirect("/dashboard")
  }

  const messages = await getAdminMessages()
  const page = messages.pages.pushCampaigns
  const devices = messages.pages.pushCampaigns.devices
  const rows = await listPushTestDevices(prisma)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={devices.eyebrow}
        title={devices.title}
        description={devices.description}
        action={
          <Link href={PUSH_CAMPAIGNS_PATH as Route}>
            <SecondaryButton type="button">{page.allCampaigns}</SecondaryButton>
          </Link>
        }
      />

      <PageSection title={devices.title} meta="PUSH_TEST_DEVICE">
        <AddTestDeviceForm />
      </PageSection>

      {rows.length === 0 ? (
        <PageSection title={devices.title} meta="PUSH_TEST_DEVICE">
          <div
            data-testid="push-test-devices-empty"
            className="flex flex-col gap-2 p-6"
          >
            <h2 className="text-[15px] font-medium">{devices.emptyTitle}</h2>
            <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
              {devices.emptyDescription}
            </p>
          </div>
        </PageSection>
      ) : (
        <PageSection title={devices.title} meta="PUSH_TEST_DEVICE">
          <DataTable
            columns={[
              devices.columns.label,
              devices.columns.testDeviceId,
              devices.columns.platform,
              devices.columns.state,
              devices.columns.added,
              "",
            ]}
            rows={rows.map((row) => [
              <span key={`${row.id}-label`} className="text-[13px] font-medium">
                {row.label}
              </span>,
              <span key={`${row.id}-id`} className="mono-meta">
                {row.testDeviceId}
              </span>,
              <span key={`${row.id}-platform`} className="mono-meta">
                {row.platform}
              </span>,
              <StatusPill
                key={`${row.id}-state`}
                tone={row.active ? "success" : "muted"}
              >
                {row.active ? devices.active : devices.retired}
              </StatusPill>,
              <span key={`${row.id}-added`} className="mono-meta">
                {formatPushUtcDate(row.createdAt)}
              </span>,
              <RemoveTestDeviceButton
                key={`${row.id}-remove`}
                id={row.id}
                label={row.label}
              />,
            ])}
          />
        </PageSection>
      )}
    </div>
  )
}
