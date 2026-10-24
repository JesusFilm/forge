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
        "fixed inset-0 z-50 flex items-center justify-center bg-[rgba(255,254,250,0.28)] px-4 py-8 backdrop-blur-xl",
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
        "relative max-h-[calc(100vh-4rem)] w-full max-w-[920px] overflow-auto rounded-md border border-border bg-card shadow-[0_32px_80px_rgba(8,8,8,0.16)]",
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
        "sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-border/70 bg-card/90 px-6 py-5 backdrop-blur-sm",
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
      className="rounded-md"
      {...props}
    >
      <X aria-hidden="true" />
    </Button>
  )
}
