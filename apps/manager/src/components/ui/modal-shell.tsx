"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

export function ModalBackdrop({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-[rgba(255,254,250,0.28)] px-3 py-3 backdrop-blur-xl sm:items-center sm:px-4 sm:py-8",
        className,
      )}
      {...props}
    />
  )
}

export function ModalPanel({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "relative max-h-[calc(100dvh-1.5rem)] w-full max-w-[920px] overflow-x-hidden overflow-y-auto rounded-[28px] border border-border bg-card shadow-[0_32px_80px_rgba(8,8,8,0.16)] sm:max-h-[calc(100vh-4rem)] sm:rounded-[32px]",
        className,
      )}
      {...props}
    />
  )
}

export function ModalHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border/70 bg-card/90 px-5 py-4 backdrop-blur-sm sm:gap-5 sm:px-6 sm:py-5",
        className,
      )}
      {...props}
    />
  )
}

export function ModalCloseButton(
  props: Omit<React.ComponentProps<typeof Button>, "variant" | "size">,
) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Close modal"
      className="rounded-2xl"
      {...props}
    >
      <X aria-hidden="true" />
    </Button>
  )
}
