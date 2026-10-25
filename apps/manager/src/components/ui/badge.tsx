import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] transition-colors",
  {
    variants: {
      variant: {
        neutral: "border-border bg-card text-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success:
          "border-[color:rgba(29,185,84,0.28)] bg-[color:rgba(29,185,84,0.10)] text-[color:#15803d]",
        danger:
          "border-[color:rgba(239,51,64,0.24)] bg-[color:rgba(239,51,64,0.10)] text-[color:var(--ds-brand-red)]",
        pending:
          "border-[color:rgba(8,8,8,0.10)] bg-secondary text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
