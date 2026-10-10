import * as React from "react"
import { cn } from "@/lib/utils"

export function SegmentedControl({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-md border border-border bg-secondary p-1 shadow-[0_1px_2px_rgba(8,8,8,0.05)]",
        className,
      )}
      {...props}
    />
  )
}

export interface SegmentedControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function SegmentedControlButton({
  active = false,
  className,
  ...props
}: SegmentedControlButtonProps) {
  return (
    <button
      className={cn(
        "flex min-h-8.5 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent px-3.5 text-[12px] font-medium tracking-[-0.01em] text-muted-foreground transition-colors outline-none focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-black/10 disabled:pointer-events-none disabled:opacity-50",
        active && "bg-card text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.06)]",
        !active && "hover:text-foreground",
        className,
      )}
      {...props}
    />
  )
}
