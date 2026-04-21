"use client"

import * as React from "react"
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

const StepperContext = React.createContext<StepperContextValue | undefined>(
  undefined,
)
const StepItemContext = React.createContext<StepItemContextValue | undefined>(
  undefined,
)

function useStepper() {
  const context = React.useContext(StepperContext)

  if (!context) {
    throw new Error("useStepper must be used within a Stepper")
  }

  return context
}

function useStepItem() {
  const context = React.useContext(StepItemContext)

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
        return
      }

      triggerNodesRef.current.delete(step)
    },
    [],
  )

  const focusStep = React.useCallback((step: number | undefined) => {
    if (step === undefined) return
    triggerNodesRef.current.get(step)?.focus()
  }, [])

  const getOrderedSteps = React.useCallback(
    () => Array.from(triggerNodesRef.current.keys()).sort((a, b) => a - b),
    [],
  )

  const focusNext = React.useCallback(
    (current: number) => {
      const orderedSteps = getOrderedSteps()
      const currentIndex = orderedSteps.indexOf(current)

      if (currentIndex === -1 || orderedSteps.length === 0) return
      focusStep(orderedSteps[(currentIndex + 1) % orderedSteps.length])
    },
    [focusStep, getOrderedSteps],
  )

  const focusPrev = React.useCallback(
    (current: number) => {
      const orderedSteps = getOrderedSteps()
      const currentIndex = orderedSteps.indexOf(current)

      if (currentIndex === -1 || orderedSteps.length === 0) return
      focusStep(
        orderedSteps[
          (currentIndex - 1 + orderedSteps.length) % orderedSteps.length
        ],
      )
    },
    [focusStep, getOrderedSteps],
  )

  const focusFirst = React.useCallback(() => {
    const [firstStep] = getOrderedSteps()
    focusStep(firstStep)
  }, [focusStep, getOrderedSteps])

  const focusLast = React.useCallback(() => {
    const orderedSteps = getOrderedSteps()
    focusStep(orderedSteps[orderedSteps.length - 1])
  }, [focusStep, getOrderedSteps])

  const stepsCount = React.Children.toArray(children).filter(
    (child): child is React.ReactElement =>
      React.isValidElement(child) &&
      (child.type as { displayName?: string }).displayName === "StepperItem",
  ).length

  const contextValue = React.useMemo(
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
      focusFirst,
      focusLast,
      focusNext,
      focusPrev,
      indicators,
      orientation,
      registerTrigger,
      setActiveStep,
      stepsCount,
    ],
  )

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        role="tablist"
        aria-orientation={orientation}
        data-slot="stepper"
        data-orientation={orientation}
        className={cn("ui-stepper", className)}
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
  const { activeStep } = useStepper()

  const state: StepState =
    loading && step === activeStep
      ? "loading"
      : completed || step < activeStep
        ? "completed"
        : step === activeStep
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
        data-loading={isLoading || undefined}
        className={cn("ui-stepper-item", className)}
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
  onClick,
  onKeyDown,
  ...props
}: StepperTriggerProps) {
  const { state, isDisabled, isLoading, step } = useStepItem()
  const {
    activeStep,
    focusFirst,
    focusLast,
    focusNext,
    focusPrev,
    registerTrigger,
    setActiveStep,
  } = useStepper()
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const isSelected = activeStep === step
  const id = `stepper-tab-${step}`
  const panelId = `stepper-panel-${step}`

  React.useEffect(() => {
    registerTrigger(step, buttonRef.current)
    return () => registerTrigger(step, null)
  }, [registerTrigger, step])

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || isDisabled) return
    setActiveStep(step)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

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
        if (!isDisabled) {
          setActiveStep(step)
        }
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
        data-loading={isLoading || undefined}
        className={cn("ui-stepper-trigger", className)}
      >
        {children}
      </span>
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      role="tab"
      id={id}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={typeof tabIndex === "number" ? tabIndex : isSelected ? 0 : -1}
      data-slot="stepper-trigger"
      data-state={state}
      data-loading={isLoading || undefined}
      className={cn("ui-stepper-trigger", className)}
      disabled={isDisabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </button>
  )
}

function StepperIndicator({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { state, isLoading } = useStepItem()
  const { indicators } = useStepper()

  const indicatorContent =
    (isLoading && indicators.loading) ||
    (state === "completed" && indicators.completed) ||
    (state === "active" && indicators.active) ||
    (state === "inactive" && indicators.inactive) ||
    children

  return (
    <div
      data-slot="stepper-indicator"
      data-state={state}
      data-loading={isLoading || undefined}
      className={cn("ui-stepper-indicator", className)}
      {...props}
    >
      {indicatorContent ? (
        <span className="ui-stepper-indicator-inner">{indicatorContent}</span>
      ) : null}
    </div>
  )
}

function StepperSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { state } = useStepItem()

  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn("ui-stepper-separator", className)}
      {...props}
    />
  )
}

function StepperTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h3">) {
  const { state } = useStepItem()

  return (
    <h3
      data-slot="stepper-title"
      data-state={state}
      className={cn("ui-stepper-title", className)}
      {...props}
    >
      {children}
    </h3>
  )
}

function StepperDescription({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { state } = useStepItem()

  return (
    <div
      data-slot="stepper-description"
      data-state={state}
      className={cn("ui-stepper-description", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function StepperNav({
  className,
  children,
  ...props
}: React.ComponentProps<"nav">) {
  const { activeStep, orientation } = useStepper()

  return (
    <nav
      data-slot="stepper-nav"
      data-state={activeStep}
      data-orientation={orientation}
      className={cn("ui-stepper-nav", className)}
      {...props}
    >
      {children}
    </nav>
  )
}

function StepperPanel({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { activeStep } = useStepper()

  return (
    <div
      data-slot="stepper-panel"
      data-state={activeStep}
      className={cn("ui-stepper-panel", className)}
      {...props}
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
  forceMount = false,
  className,
  children,
  ...props
}: StepperContentProps) {
  const { activeStep } = useStepper()
  const isActive = value === activeStep

  if (!forceMount && !isActive) {
    return null
  }

  return (
    <div
      id={`stepper-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`stepper-tab-${value}`}
      data-slot="stepper-content"
      data-state={activeStep}
      className={cn(
        "ui-stepper-content",
        !isActive && forceMount ? "ui-stepper-content-hidden" : "",
        className,
      )}
      hidden={!isActive && forceMount}
      {...props}
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
