// Shared test harness for the AppShell behavioral suites (app-shell.test.tsx
// and app-shell.history.test.tsx — split so neither file crosses the 1k-line
// bar). Not a test file itself; each suite calls setup/teardown per test.
import { StrictMode } from "react"
import { act, render, screen, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { vi } from "vitest"

import { STUB_REPLY_DELAY_MS } from "@/lib/chat-stub"
import { encodeSseFrame } from "@/lib/sse"

import { AppShell } from "./app-shell"

// Module-level so every helper reads the current render. Per test FILE (each
// vitest module registry instantiates its own copy) — never shared across files.
export let user: UserEvent
export let view: ReturnType<typeof render>
export let container: HTMLElement

export type ShellRenderOptions = {
  /** Wrap in <StrictMode> to exercise dev's double-mount cycle. */
  strictMode?: boolean
  /** feat-209 deep-link id — ALWAYS prop-injected, never read from
   * window.location at construction (URL isolation between tests). */
  initialConversationId?: string
  /** feat-209 server-decided denial pane. */
  deniedScreen?: "sign_in" | "unavailable"
  /** feat-399 granted-shell-on-the-unavailable-pane flag. */
  deepLinkUnresolvable?: boolean
  /** Renders the rail-foot account control (KTD8 sign-in href assertions). */
  authConfigured?: boolean
}

/** Render the shell with a given flag value and capture the view/container. */
export function renderShell(
  seekerEnabled = false,
  opts: ShellRenderOptions = {},
) {
  const shell = (
    <AppShell
      seekerEnabled={seekerEnabled}
      authConfigured={opts.authConfigured}
      initialConversationId={opts.initialConversationId}
      deniedScreen={opts.deniedScreen}
      deepLinkUnresolvable={opts.deepLinkUnresolvable}
    />
  )
  view = render(opts.strictMode ? <StrictMode>{shell}</StrictMode> : shell)
  container = view.container
}

/** Per-test setup: fake timers (shouldAdvanceTime lets user-event's awaited
 * interactions resolve and microtasks flow) + a flag-off initial render.
 * cleanup() in vitest.setup.ts unmounts after each test. */
export function setupShellTest() {
  // Flag-on shells write to window.history (feat-209) and jsdom URL state
  // leaks between tests — every test starts at "/".
  window.history.replaceState(null, "", "/")
  vi.useFakeTimers({ shouldAdvanceTime: true })
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderShell(false)
}

export function teardownShellTest() {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  // Mirror of the setup reset — a failing test must not leak its URL either.
  window.history.replaceState(null, "", "/")
}

export function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" })
}

export function getSendButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
}

export function getLog(): HTMLElement {
  return screen.getByRole("log", { name: "Conversation" })
}

export function getConversationNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Conversations" })
}

// Structural landmark accessors: jsdom applies no CSS, so suites read which
// elements exist + the `data-open` attr. drawerOpen deliberately THROWS via
// getAside when the rail is missing — silent-false would hide a lost aside.
export function getAside(): HTMLElement {
  const el = container.querySelector("aside")
  if (!el) throw new Error("aside not found")
  return el
}

export function getMain(): HTMLElement {
  const el = container.querySelector("main")
  if (!el) throw new Error("main not found")
  return el
}

export function drawerOpen(): boolean {
  return getAside().getAttribute("data-open") === "true"
}

// Read only the answer text of each turn (the [data-message-content] node), so
// the engine marker / grounded badge / sources metadata never leak into counts.
export function messageTexts(): string[] {
  return Array.from(getLog().querySelectorAll("[data-message-content]")).map(
    (el) => el.textContent ?? "",
  )
}

export function isPending(): boolean {
  return getLog().querySelector("[data-pending]") !== null
}

export function getNewConversationAction(): HTMLButtonElement {
  const nav = getConversationNav()
  const action = screen
    .getAllByRole("button", { name: "New conversation" })
    .find((b) => !nav.contains(b))
  if (!action) throw new Error("New conversation action button not found")
  return action as HTMLButtonElement
}

export function sidebarReplyingCount(): number {
  return getConversationNav().querySelectorAll("[data-replying]").length
}

export async function sendMessage(text: string) {
  await user.type(getTextarea(), text)
  await user.click(getSendButton())
}

// Jump the stub reply's 800ms timer AND flush the microtasks the streaming seam
// resolves on (the reply lands via an awaited promise, not a sync callback).
export async function awaitReply() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
  })
}

export async function clickNewConversation() {
  await user.click(getNewConversationAction())
}

export async function selectSidebarConversation(title: string) {
  await user.click(
    within(getConversationNav()).getByRole("button", { name: title }),
  )
}

// ---------------------------------------------------------------------------
// Seeker-path helpers (flag on): a mocked fetch returning an SSE Response.
// ---------------------------------------------------------------------------

export type Frame = { event: string; data: unknown }

export function sseResponse(frames: Frame[], init?: ResponseInit): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(encodeSseFrame(f.event, f.data)))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

// One server-listing row as the harness speaks it (feat-241).
export type HistoryRow = { id: string; title: string; updatedAt: string }

// Failure shapes the history endpoints can be told to produce.
export type JsonSpec =
  | { status: number; body?: unknown }
  | { reject: true }
  | { hang: true }

export function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function resolveJsonSpec(spec: object, ok: () => Response): Promise<Response> {
  const s = spec as Partial<{
    reject: boolean
    hang: boolean
    status: number
    body: unknown
  }>
  if (s.reject) return Promise.reject(new Error("down"))
  if (s.hang) return new Promise<Response>(() => {})
  if (typeof s.status === "number") {
    return Promise.resolve(jsonRes(s.status, s.body ?? {}))
  }
  return Promise.resolve(ok())
}

export type SeekerHarnessOptions = {
  /** Response for the Nth /api/history/list call (0-based). Defaults to an
   * empty page — the pre-241 look. */
  listFor?: (
    call: number,
  ) => { threads: HistoryRow[]; hasMore?: boolean } | JsonSpec
  /** Response for an /api/history/thread call, by conversation id. May return
   * a raw Promise<Response> for hand-controlled (deferred) settlement. */
  threadFor?: (conversationId: string) =>
    | {
        messages: Array<{
          id: string
          role: string
          text: string
          createdAt?: string
        }>
      }
    | JsonSpec
    | Promise<Response>
  /** Render inside <StrictMode> (dev double-mount cycle). */
  strictMode?: boolean
  /** feat-209 deep-link id, threaded as a prop (see ShellRenderOptions). */
  initialConversationId?: string
  /** feat-209 server-decided denial pane. */
  deniedScreen?: "sign_in" | "unavailable"
  /** feat-399 granted-shell-on-the-unavailable-pane flag. */
  deepLinkUnresolvable?: boolean
}

// Stub global fetch and render flag-on. The mock URL-dispatches: /api/history/*
// answer from the harness options (hydration fires on every flag-on mount);
// everything else is the Seeker SSE proxy (`framesFor` called per request).
export function renderSeeker(
  framesFor: () => Frame[] | { reject: true } = () => [],
  options: SeekerHarnessOptions = {},
) {
  view.unmount()
  let listCall = 0
  const fetchMock = vi.fn().mockImplementation((url, init?: RequestInit) => {
    const target = String(url)
    if (target === "/api/history/list") {
      const spec = options.listFor?.(listCall++) ?? { threads: [] }
      return resolveJsonSpec(spec, () => {
        const page = spec as { threads: HistoryRow[]; hasMore?: boolean }
        return jsonRes(200, {
          threads: page.threads,
          page: 0,
          perPage: 20,
          total: page.threads.length,
          hasMore: page.hasMore === true,
        })
      })
    }
    if (target === "/api/history/thread") {
      const { conversationId } = JSON.parse(String(init?.body)) as {
        conversationId: string
      }
      const spec = options.threadFor?.(conversationId) ?? { messages: [] }
      if (spec instanceof Promise) return spec
      return resolveJsonSpec(spec, () =>
        jsonRes(200, { messages: (spec as { messages: unknown[] }).messages }),
      )
    }
    const out = framesFor()
    if (!Array.isArray(out) && out.reject)
      return Promise.reject(new Error("down"))
    return Promise.resolve(sseResponse(out as Frame[]))
  })
  vi.stubGlobal("fetch", fetchMock)
  renderShell(true, {
    strictMode: options.strictMode,
    initialConversationId: options.initialConversationId,
    deniedScreen: options.deniedScreen,
    deepLinkUnresolvable: options.deepLinkUnresolvable,
  })
  return fetchMock
}

// Bodies of the /api/seeker calls only — the flag-on mount also fires history
// fetches, so Seeker assertions must never index the raw call list.
export function seekerCallBodies(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<{ conversationId: string; text: string }> {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]) === "/api/seeker")
    .map(
      (call) =>
        JSON.parse(String((call[1] as RequestInit).body)) as {
          conversationId: string
          text: string
        },
    )
}

export function historyThreadCallCount(
  fetchMock: ReturnType<typeof vi.fn>,
): number {
  return fetchMock.mock.calls.filter(
    (call) => String(call[0]) === "/api/history/thread",
  ).length
}

// Sidebar row titles in render order (via the button title attr, which always
// carries the display title — sr-only suffixes never leak in).
export function navRowTitles(): string[] {
  return Array.from(getConversationNav().querySelectorAll("ul li button")).map(
    (button) => button.getAttribute("title") ?? "",
  )
}

// Shared feat-241 fixtures.
export const ALPHA: HistoryRow = {
  id: "thread-alpha",
  title: "Alpha thread",
  updatedAt: "2026-07-12T08:00:00.000Z",
}
export const BETA: HistoryRow = {
  id: "thread-beta",
  title: "Beta thread",
  updatedAt: "2026-07-11T08:00:00.000Z",
}
export const UNTITLED: HistoryRow = {
  id: "thread-untitled",
  title: "",
  updatedAt: "2026-07-10T08:00:00.000Z",
}

export const ALPHA_TRANSCRIPT = {
  messages: [
    {
      id: "am1",
      role: "user",
      text: "old question",
      createdAt: "2026-07-12T07:59:00.000Z",
    },
    {
      id: "am2",
      role: "assistant",
      text: "old answer",
      createdAt: "2026-07-12T08:00:00.000Z",
    },
  ],
}

export function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

export async function selectRow(title: string | RegExp) {
  await user.click(
    within(getConversationNav()).getByRole("button", { name: title }),
  )
}
