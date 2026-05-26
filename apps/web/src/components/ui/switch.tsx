"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-stone-100 data-[unchecked]:bg-stone-600",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full shadow-sm ring-0 transition-transform duration-200 data-[checked]:translate-x-5 data-[unchecked]:translate-x-0.5 data-[checked]:bg-stone-900 data-[unchecked]:bg-stone-300" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
