import * as React from "react"
import { cn } from "@/lib/utils"

export function PageIntro({
  actions,
  children,
  className,
}: React.HTMLAttributes<HTMLElement> & { actions?: React.ReactNode }) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-border/70 pb-6 md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export function PageEyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "block text-[14px] font-medium uppercase tracking-[0.15em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function PageTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn(
        "mt-3 text-[36px] leading-[0.98] font-semibold tracking-[-0.035em] text-foreground sm:text-[42px]",
        className,
      )}
      {...props}
    />
  )
}

export function PageDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "mt-3 max-w-4xl text-[16px] leading-[1.5] font-normal tracking-[-0.015em] text-muted-foreground sm:text-[17px]",
        className,
      )}
      {...props}
    />
  )
}
