/**
 * Shared scaffolding for component render suites. A new suite needs no
 * preamble: since SDK 57 the package.json jest `moduleNameMapper` pins
 * `react` and both jsx runtimes globally. The per-file
 * `jest.mock("react", …)` re-point in the older suites is still valid and
 * still takes precedence, but it is no longer required to import this module.
 */

import { act, type ReactElement } from "react"

// No @types/node (no new test deps) — type the ambient require locally.
// Shared by the render suites' `jest.mock("react", …)` re-point factories.
export type NodeRequireLike = {
  (id: string): unknown
  resolve: (request: string, options?: { paths?: string[] }) => string
}
export type NodePath = {
  dirname: (p: string) => string
  join: (...parts: string[]) => string
}

export type RenderedNode = {
  props: {
    onPress?: () => void
    accessibilityLabel?: string
    disabled?: boolean
    children?: unknown
    [key: string]: unknown
  }
}
export type TestInstance = {
  root: { findAll(predicate: (node: RenderedNode) => boolean): RenderedNode[] }
  update(element: ReactElement): void
  unmount(): void
}
export type TestRendererModule = {
  create(element: ReactElement): TestInstance
}

const nodeRequire = require as unknown as NodeRequireLike

/** jest-expo's own transitive react-test-renderer — no new dependency. */
export const TestRenderer = nodeRequire(
  nodeRequire.resolve("react-test-renderer", {
    paths: [nodeRequire.resolve("jest-expo/package.json")],
  }),
) as TestRendererModule

export function pressableByLabel(renderer: TestInstance, label: string) {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

export function hasText(renderer: TestInstance, needle: string): boolean {
  return (
    renderer.root.findAll(
      (node) =>
        typeof node.props.children === "string" &&
        node.props.children.includes(needle),
    ).length > 0
  )
}

export async function unmount(renderer: TestInstance) {
  await act(async () => {
    renderer.unmount()
  })
}

export async function press(node: RenderedNode) {
  await act(async () => {
    node.props.onPress?.()
  })
}
