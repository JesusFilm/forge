"use client"

import * as React from "react"
import { createContext, useContext } from "react"
import { Check, LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"

type StepperOrientation = "horizontal" | "vertical"
type StepState = "active" | "completed" | "inactive" | "loading"
type StepIndicators = {
  active?: React.ReactNode
  completed?: React.ReactNode
  inactive?: React.ReactNode
  loading?: React.ReactNode
}

interface StepperContextValue {
  activeStep: number
  setActiveStep: (step: number) => void
  stepsCount: number
  orientation: StepperOrientation
  registerTrigger: (step: number, node: HTMLButtonElement | null) => void
  focusNext: (currentStep: number) => void
  focusPrev: (currentStep: number) => void
  focusFirst: () => void
  focusLast: () => void
  indicators: StepIndicators
}

interface StepItemContextValue {
  step: number
  state: StepState
  isDisabled: boolean
  isLoading: boolean
}

const StepperContext = createContext<StepperContextValue | undefined>(undefined)
const StepItemContext = createContext<StepItemContextValue | undefined>(
  undefined,
)

function useStepper() {
  const context = useContext(StepperContext)

  if (!context) {
    throw new Error("useStepper must be used within a Stepper")
  }

  return context
}

function useStepItem() {
  const context = useContext(StepItemContext)

  if (!context) {
    throw new Error("useStepItem must be used within a StepperItem")
  }

  return context
}

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number
  value?: number
  onValueChange?: (value: number) => void
  orientation?: StepperOrientation
  indicators?: StepIndicators
}

function Stepper({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = "horizontal",
  className,
  children,
  indicators = {},
  ...props
}: StepperProps) {
  const [uncontrolledStep, setUncontrolledStep] = React.useState(defaultValue)
  const triggerNodesRef = React.useRef(new Map<number, HTMLButtonElement>())

  const currentStep = value ?? uncontrolledStep

  const setActiveStep = React.useCallback(
    (step: number) => {
      if (value === undefined) {
        setUncontrolledStep(step)
      }

      onValueChange?.(step)
    },
    [onValueChange, value],
  )

  const registerTrigger = React.useCallback(
    (step: number, node: HTMLButtonElement | null) => {
      if (node) {
        triggerNodesRef.current.set(step, node)
      } else {
        triggerNodesRef.current.delete(step)
      }
    },
    [],
  )

  const getOrderedSteps = React.useCallback(
    () => Array.from(triggerNodesRef.current.keys()).sort((a, b) => a - b),
    [],
  )

  const focusStep = React.useCallback((step: number | undefined) => {
    if (step === undefined) return
    triggerNodesRef.current.get(step)?.focus()
  }, [])

  const focusNext = React.useCallback(
    (current: number) => {
      const ordered = getOrderedSteps()
      const currentIndex = ordered.indexOf(current)

      if (currentIndex === -1 || ordered.length === 0) return
      focusStep(ordered[(currentIndex + 1) % ordered.length])
    },
    [focusStep, getOrderedSteps],
  )

  const focusPrev = React.useCallback(
    (current: number) => {
      const ordered = getOrderedSteps()
      const currentIndex = ordered.indexOf(current)

      if (currentIndex === -1 || ordered.length === 0) return
      focusStep(ordered[(currentIndex - 1 + ordered.length) % ordered.length])
    },
    [focusStep, getOrderedSteps],
  )

  const focusFirst = React.useCallback(() => {
    const [first] = getOrderedSteps()
    focusStep(first)
  }, [focusStep, getOrderedSteps])

  const focusLast = React.useCallback(() => {
    const ordered = getOrderedSteps()
    focusStep(ordered[ordered.length - 1])
  }, [focusStep, getOrderedSteps])

  const stepsCount = React.Children.toArray(children).filter(
    (child): child is React.ReactElement =>
      React.isValidElement(child) &&
      (child.type as { displayName?: string }).displayName === "StepperItem",
  ).length

  const contextValue = React.useMemo<StepperContextValue>(
    () => ({
      activeStep: currentStep,
      setActiveStep,
      stepsCount,
      orientation,
      registerTrigger,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
      indicators,
    }),
    [
      currentStep,
      setActiveStep,
      stepsCount,
      orientation,
      registerTrigger,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
      indicators,
    ],
  )

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        role="tablist"
        aria-orientation={orientation}
        data-slot="stepper"
        data-orientation={orientation}
        className={cn("w-full", className)}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  )
}

export interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number
  completed?: boolean
  disabled?: boolean
  loading?: boolean
}

function StepperItem({
  step,
  completed = false,
  disabled = false,
  loading = false,
  className,
  children,
  ...props
}: StepperItemProps) {
  const { activeStep, orientation } = useStepper()

  const state: StepState =
    completed || step < activeStep
      ? "completed"
      : activeStep === step
        ? "active"
        : "inactive"

  const isLoading = loading && step === activeStep

  return (
    <StepItemContext.Provider
      value={{ step, state, isDisabled: disabled, isLoading }}
    >
      <div
        data-slot="stepper-item"
        data-state={state}
        data-orientation={orientation}
        {...(isLoading ? { "data-loading": true } : {})}
        className={cn(
          "group/step flex min-w-0 items-stretch",
          orientation === "horizontal" ? "flex-1" : "w-full",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </StepItemContext.Provider>
  )
}

export interface StepperTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

function StepperTrigger({
  asChild = false,
  className,
  children,
  tabIndex,
  ...props
}: StepperTriggerProps) {
  const { state, isLoading, isDisabled, step } = useStepItem()
  const {
    activeStep,
    registerTrigger,
    setActiveStep,
    focusNext,
    focusPrev,
    focusFirst,
    focusLast,
  } = useStepper()

  const isSelected = activeStep === step
  const id = `stepper-tab-${step}`
  const panelId = `stepper-panel-${step}`
  const buttonRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    registerTrigger(step, buttonRef.current)

    return () => registerTrigger(step, null)
  }, [registerTrigger, step])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault()
        focusNext(step)
        break
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault()
        focusPrev(step)
        break
      case "Home":
        event.preventDefault()
        focusFirst()
        break
      case "End":
        event.preventDefault()
        focusLast()
        break
      case "Enter":
      case " ":
        event.preventDefault()
        setActiveStep(step)
        break
      default:
        break
    }
  }

  if (asChild) {
    return (
      <span
        data-slot="stepper-trigger"
        data-state={state}
        className={className}
      >
        {children}
      </span>
    )
  }

  return (
    <button
      ref={buttonRef}
      role="tab"
      id={id}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={typeof tabIndex === "number" ? tabIndex : isSelected ? 0 : -1}
      data-slot="stepper-trigger"
      data-state={state}
      data-loading={isLoading}
      className={cn(
        "inline-flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-[14px] border border-[var(--ds-line)] bg-[var(--ds-panel)] px-2.5 py-2.5 text-left text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.06)] outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out hover:bg-[var(--ds-hover)] focus-visible:border-black focus-visible:ring-4 focus-visible:ring-black/10 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-black data-[state=active]:shadow-[inset_0_0_0_1px_var(--ds-black)] data-[state=completed]:bg-[var(--ds-panel-muted)] data-[state=inactive]:text-[var(--ds-muted)] active:scale-[0.995]",
        className,
      )}
      onClick={() => setActiveStep(step)}
      onKeyDown={handleKeyDown}
      disabled={isDisabled}
      {...props}
    >
      {children}
    </button>
  )
}

function StepperIndicator({
  children,
  className,
}: React.ComponentProps<"div">) {
  const { state, isLoading, step } = useStepItem()
  const { indicators } = useStepper()

  const resolvedIndicator =
    (isLoading && indicators.loading) ||
    (state === "completed" && indicators.completed) ||
    (state === "active" && indicators.active) ||
    (state === "inactive" && indicators.inactive)

  return (
    <div
      data-slot="stepper-indicator"
      data-state={state}
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--ds-line)] bg-[var(--ds-panel-muted)] text-[10px] font-semibold text-[var(--ds-muted)] transition-[background-color,border-color,color] duration-200 data-[state=active]:border-black data-[state=active]:bg-black data-[state=active]:text-white data-[state=completed]:border-black data-[state=completed]:bg-black data-[state=completed]:text-white",
        className,
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {resolvedIndicator ? (
          resolvedIndicator
        ) : isLoading ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : state === "completed" ? (
          <Check className="size-4" />
        ) : (
          (children ?? <span>{step}</span>)
        )}
      </div>
    </div>
  )
}

function StepperSeparator({ className }: React.ComponentProps<"div">) {
  const { state } = useStepItem()
  const { orientation } = useStepper()

  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn(
        "rounded-full bg-[var(--ds-line)] transition-colors duration-200 data-[state=completed]:bg-black data-[state=active]:bg-black",
        orientation === "horizontal"
          ? "mx-1.5 mt-4 h-0.5 flex-1"
          : "ml-3.5 mt-2 h-8 w-0.5",
        className,
      )}
    />
  )
}

function StepperTitle({ children, className }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="stepper-title"
      className={cn(
        "min-w-0 text-balance text-[12px] font-semibold leading-none tracking-[-0.01em]",
        className,
      )}
    >
      {children}
    </h3>
  )
}

function StepperDescription({
  children,
  className,
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stepper-description"
      className={cn("text-[12px] leading-5 text-muted-foreground", className)}
    >
      {children}
    </div>
  )
}

function StepperNav({ children, className }: React.ComponentProps<"nav">) {
  const { orientation } = useStepper()

  return (
    <nav
      data-slot="stepper-nav"
      data-orientation={orientation}
      className={cn(
        "group/stepper-nav inline-flex w-full",
        orientation === "horizontal"
          ? "flex-row items-stretch gap-2"
          : "flex-col gap-2",
        className,
      )}
    >
      {children}
    </nav>
  )
}

function StepperPanel({ children, className }: React.ComponentProps<"div">) {
  const { activeStep } = useStepper()

  return (
    <div
      data-slot="stepper-panel"
      data-state={activeStep}
      className={cn("w-full", className)}
    >
      {children}
    </div>
  )
}

export interface StepperContentProps extends React.ComponentProps<"div"> {
  value: number
  forceMount?: boolean
}

function StepperContent({
  value,
  forceMount,
  children,
  className,
}: StepperContentProps) {
  const { activeStep } = useStepper()
  const isActive = value === activeStep

  if (!forceMount && !isActive) {
    return null
  }

  return (
    <div
      data-slot="stepper-content"
      data-state={activeStep}
      className={cn("w-full", className, !isActive && forceMount && "hidden")}
      hidden={!isActive && forceMount}
    >
      {children}
    </div>
  )
}

Stepper.displayName = "Stepper"
StepperItem.displayName = "StepperItem"
StepperTrigger.displayName = "StepperTrigger"
StepperIndicator.displayName = "StepperIndicator"
StepperSeparator.displayName = "StepperSeparator"
StepperTitle.displayName = "StepperTitle"
StepperDescription.displayName = "StepperDescription"
StepperNav.displayName = "StepperNav"
StepperPanel.displayName = "StepperPanel"
StepperContent.displayName = "StepperContent"

export {
  useStepper,
  useStepItem,
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperDescription,
  StepperPanel,
  StepperContent,
  StepperNav,
}
