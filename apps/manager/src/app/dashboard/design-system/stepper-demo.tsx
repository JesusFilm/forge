"use client"
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper"

const steps = [
  { title: "User Details" },
  { title: "Payment Info" },
  { title: "Auth OTP" },
  { title: "Preview Form" },
]

export function StepperDemo() {
  return (
    <Stepper defaultValue={2} className="w-full max-w-[640px] space-y-8">
      <StepperNav className="grid gap-3 sm:grid-cols-4">
        {steps.map((step, index) => (
          <StepperItem
            key={step.title}
            step={index + 1}
            className="items-start"
          >
            <StepperTrigger className="w-full flex-col items-start gap-2.5">
              <StepperIndicator className="h-1.5 w-full rounded-full border-0 bg-secondary text-transparent data-[state=active]:bg-foreground data-[state=completed]:bg-foreground" />
              <StepperTitle className="text-left text-[15px] font-semibold tracking-[-0.02em] text-muted-foreground data-[state=active]:text-foreground data-[state=completed]:text-foreground">
                {step.title}
              </StepperTitle>
            </StepperTrigger>
          </StepperItem>
        ))}
      </StepperNav>

      <StepperPanel>
        {steps.map((step, index) => (
          <StepperContent
            key={step.title}
            value={index + 1}
            className="flex min-h-28 items-center justify-center rounded-[1.5rem] border border-border bg-card px-6 py-8 text-center text-[18px] font-medium tracking-[-0.02em] text-foreground shadow-[0_10px_24px_rgba(8,8,8,0.05)]"
          >
            Step {step.title} content
          </StepperContent>
        ))}
      </StepperPanel>
    </Stepper>
  )
}
