"use client"

/**
 * R31 — the test-device list. The ID is the one the app shows on its Profile
 * screen, never the push token, and the service refuses a token-shaped string.
 */
import { useActionState } from "react"

import { PrimaryButton, SecondaryButton } from "@/components/admin-ui"

import { addTestDeviceAction, removeTestDeviceAction } from "../actions"
import { ActionFeedback } from "./action-feedback"
import { PUSH_ACTION_IDLE } from "./action-state"

export function AddTestDeviceForm() {
  const [state, formAction, pending] = useActionState(
    addTestDeviceAction,
    PUSH_ACTION_IDLE,
  )

  return (
    <form action={formAction} className="grid gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="label-text">Notification test ID</span>
          <input
            name="testDeviceId"
            required
            autoComplete="off"
            data-testid="push-test-device-id"
            placeholder="ab12cd34ef"
            className="h-8 w-56 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-2 font-mono text-[13px]"
          />
        </label>
        <label className="grid gap-1">
          <span className="label-text">Label</span>
          <input
            name="label"
            required
            autoComplete="off"
            data-testid="push-test-device-label"
            placeholder="Urim iPhone 15"
            className="h-8 w-56 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-2 text-[13px]"
          />
        </label>
        <PrimaryButton
          type="submit"
          data-testid="push-test-device-add"
          disabled={pending}
        >
          {pending ? "Adding..." : "Add test device"}
        </PrimaryButton>
      </div>
      <ActionFeedback state={state} />
    </form>
  )
}

export function RemoveTestDeviceButton({
  id,
  label,
}: {
  id: string
  label: string
}) {
  const [state, formAction, pending] = useActionState(
    removeTestDeviceAction,
    PUSH_ACTION_IDLE,
  )

  return (
    <form action={formAction} className="grid gap-1">
      <input type="hidden" name="id" value={id} />
      <SecondaryButton
        type="submit"
        data-testid="push-test-device-remove"
        aria-label={`Remove ${label} from the test-device list`}
        disabled={pending}
      >
        {pending ? "Removing..." : "Remove"}
      </SecondaryButton>
      <ActionFeedback state={state} />
    </form>
  )
}
