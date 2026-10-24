import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// jest-dom matchers (toBeDisabled, toHaveValue, toBeInTheDocument, …) and
// auto-unmount between tests. jsdom is the app-wide test env (vitest.config.ts).
import "@testing-library/jest-dom/vitest"

afterEach(() => {
  cleanup()
})
