/**
 * Shared scaffolding for component render suites. Since SDK 57 the package.json
 * jest config pins `^react$` and both jsx runtimes in `moduleNameMapper`, so a
 * suite needs NO per-file `jest.mock("react", …)` preamble to import this. The
 * existing per-suite re-points stay valid and take precedence (see
 * apps/mobile/CLAUDE.md "Component render tests").
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
  /**
   * A host node's type is the tag string; a composite's is the component. Both
   * carry the same props, so a suite that needs an exact count must filter on
   * this — otherwise one rendered control matches twice.
   */
  type?: string | unknown
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
  toJSON(): unknown
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
