"use client"

import type { CSSProperties } from "react"
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
    <Stepper defaultValue={2} className="design-system-stepper-demo">
      <StepperNav
        className="design-system-stepper-nav"
        style={{ "--stepper-columns": steps.length } as CSSProperties}
      >
        {steps.map((step, index) => (
          <StepperItem
            key={step.title}
            step={index + 1}
            className="design-system-stepper-item"
          >
            <StepperTrigger className="design-system-stepper-trigger">
              <StepperIndicator className="design-system-stepper-indicator" />
              <StepperTitle className="design-system-stepper-title">
                {step.title}
              </StepperTitle>
            </StepperTrigger>
          </StepperItem>
        ))}
      </StepperNav>

      <StepperPanel className="design-system-stepper-panel">
        {steps.map((step, index) => (
          <StepperContent
            key={step.title}
            value={index + 1}
            className="design-system-stepper-content"
          >
            Step {step.title} content
          </StepperContent>
        ))}
      </StepperPanel>
    </Stepper>
  )
}
