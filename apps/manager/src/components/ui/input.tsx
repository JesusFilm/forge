"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-white px-4 text-[13px] font-normal tracking-[-0.01em] text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground/70 focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-black/12 disabled:cursor-default disabled:opacity-60",
        className,
      )}
      {...props}
    />
  )
})

Input.displayName = "Input"
