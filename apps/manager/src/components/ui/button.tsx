"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[0.95rem] border text-sm font-medium tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out outline-none focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-black/10 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.99]",
  {
    variants: {
      variant: {
        primary:
          "border-black bg-black text-white shadow-[0_1px_2px_rgba(8,8,8,0.12)] hover:bg-black/92",
        outline:
          "border-border bg-card text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.06)] hover:bg-accent",
        soft: "border-transparent bg-secondary text-foreground hover:bg-accent",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        danger:
          "border-transparent bg-[color:var(--ds-brand-red)] text-white shadow-[0_1px_2px_rgba(239,51,64,0.2)] hover:bg-[color:color-mix(in_srgb,var(--ds-brand-red)_88%,black)]",
      },
      size: {
        sm: "h-7.5 px-2.5 text-[12px]",
        md: "h-8.5 px-3 text-[13px]",
        lg: "h-9 px-3.5 text-[14px]",
        icon: "size-8.5",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "md",
    },
  },
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
)

Button.displayName = "Button"

export { buttonVariants }
