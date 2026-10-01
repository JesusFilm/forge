import { cx } from "@/components/admin-ui"

import type { PushActionState } from "./action-state"

/** What an action answered, in the words the service or the form chose. */
export function ActionFeedback({
  state,
  className,
}: {
  state: PushActionState
  className?: string
}) {
  if (state.status === "idle") return null
  const failed = state.status === "error"
  return (
    <p
      role="status"
      data-testid="push-action-feedback"
      data-tone={failed ? "error" : "ok"}
      className={cx(
        "rounded-sm border px-3 py-2 text-[12px] leading-5",
        failed
          ? "border-[var(--color-danger-border)] text-[var(--color-danger)]"
          : "border-[var(--color-success-border)] text-[var(--color-success)]",
        className,
      )}
    >
      {failed ? state.reason : state.message}
    </p>
  )
}

/** A standing notice, such as the freeze rule or the kill switch. */
export function InlineNotice({
  tone,
  title,
  children,
  testId,
}: {
  tone: "warning" | "danger" | "muted"
  title?: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className={cx(
        "rounded-sm border px-3 py-2 text-[12px] leading-5",
        tone === "danger"
          ? "border-[var(--color-danger-border)] text-[var(--color-danger)]"
          : tone === "warning"
            ? "border-[var(--color-warning-border)] text-[var(--color-warning)]"
            : "border-[var(--color-hairline)] text-[var(--color-text-muted)]",
      )}
    >
      {title ? <div className="font-medium">{title}</div> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  )
}
