"use client"

/**
 * R34 and KTD15 — after a stale refusal, the person loads the stored campaign
 * again. The page keeps the typed text until the person says yes, because the
 * reload discards it.
 */
import { useRouter } from "next/navigation"
import { useState } from "react"

import { SecondaryButton } from "@/components/admin-ui"
import type { AdminMessages } from "@/i18n/messages"

import { ConfirmSendModal } from "./confirm-send-modal"

export type PushReviewMessages =
  AdminMessages["pages"]["pushCampaigns"]["review"]

export function LoadLatestVersion({
  messages,
}: {
  messages: PushReviewMessages
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function confirm() {
    setOpen(false)
    router.refresh()
  }

  return (
    <div>
      <SecondaryButton
        type="button"
        data-testid="push-load-latest"
        onClick={() => setOpen(true)}
      >
        {messages.loadLatest}
      </SecondaryButton>
      <ConfirmSendModal
        open={open}
        testId="push-load-latest-confirm"
        title={messages.loadLatestTitle}
        consequence={messages.loadLatestConsequence}
        confirmLabel={messages.loadLatest}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      />
    </div>
  )
}
