import type { EditorSession } from "./editor-session"
import { CLIENT_NAVIGATION_REQUEST } from "@/lib/client-navigation"

/** Read current dirty state at navigation time, including unresolved save receipts. */
export function guardEditorNavigation(
  session: EditorSession,
  browser: Window,
  page: Document,
) {
  const mayLeave = (href: string) => {
    if (!session.getSnapshot().hasUnsavedChanges) return true
    const destination = new URL(href, browser.location.href)
    if (
      destination.origin === browser.location.origin &&
      destination.pathname === browser.location.pathname &&
      destination.search === browser.location.search
    )
      return true
    return browser.confirm(
      "Your changes are not saved. Leave this page anyway?",
    )
  }
  const request = (event: Event) => {
    if (
      event instanceof CustomEvent &&
      typeof event.detail?.href === "string" &&
      !mayLeave(event.detail.href)
    )
      event.preventDefault()
  }
  const unload = (event: BeforeUnloadEvent) => {
    if (!session.getSnapshot().hasUnsavedChanges) return
    event.preventDefault()
    event.returnValue = ""
  }
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !session.getSnapshot().hasUnsavedChanges
    )
      return
    const target = event.target
    const link = target instanceof Element ? target.closest("a[href]") : null
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self")
    )
      return
    const destination = new URL(link.href, browser.location.href)
    if (!["http:", "https:"].includes(destination.protocol)) return
    if (!mayLeave(destination.href)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  // Navigation API covers same-document Back/Forward, which bypass beforeunload
  // in the App Router. Ordinary document traversals retain the native warning.
  const navigation =
    "navigation" in browser && browser.navigation instanceof EventTarget
      ? browser.navigation
      : null
  const traverse = (event: Event) => {
    if (
      !event.cancelable ||
      !("navigationType" in event) ||
      event.navigationType !== "traverse" ||
      !("destination" in event) ||
      !event.destination ||
      typeof event.destination !== "object" ||
      !("sameDocument" in event.destination) ||
      !event.destination.sameDocument ||
      !("url" in event.destination) ||
      typeof event.destination.url !== "string" ||
      !session.getSnapshot().hasUnsavedChanges
    )
      return
    if (!mayLeave(event.destination.url)) event.preventDefault()
  }
  browser.addEventListener(CLIENT_NAVIGATION_REQUEST, request)
  navigation?.addEventListener("navigate", traverse)
  browser.addEventListener("beforeunload", unload)
  page.addEventListener("click", click, true)
  return () => {
    browser.removeEventListener(CLIENT_NAVIGATION_REQUEST, request)
    navigation?.removeEventListener("navigate", traverse)
    browser.removeEventListener("beforeunload", unload)
    page.removeEventListener("click", click, true)
  }
}
