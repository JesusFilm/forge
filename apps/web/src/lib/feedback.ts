export const FEEDBACK_CATEGORIES = [
  "problem",
  "confusing",
  "idea",
  "praise",
] as const

export const FEEDBACK_LANGUAGE_AREAS = [
  "audio",
  "subtitles",
  "interface",
  "title-description",
  "other",
] as const

export const FEEDBACK_CONTENT_SCOPES = ["current", "other"] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]
export type FeedbackLanguageArea = (typeof FEEDBACK_LANGUAGE_AREAS)[number]
export type FeedbackContentScope = (typeof FEEDBACK_CONTENT_SCOPES)[number]

export type FeedbackPageContext = {
  title: string
  url: string
  locale: string
}

export type FeedbackDiagnostics = {
  browser: string
  operatingSystem: string
  device: string
  viewport: string
  timeZone: string
  appVersion: string
}

export type FeedbackSelectedElement = {
  label: string
  role: string
  path: string
}

export type FeedbackLanguageContext = {
  area: FeedbackLanguageArea
  language: string
}

export type FeedbackContentContext = {
  scope: FeedbackContentScope
  title: string
  url?: string
  id?: string
  slug?: string
  label?: string
}

export type FeedbackSubmission = {
  category: FeedbackCategory
  message: string
  name: string
  email?: string
  page: FeedbackPageContext
  languageIssue?: FeedbackLanguageContext
  content?: FeedbackContentContext
  selectedElement?: FeedbackSelectedElement
  diagnostics?: FeedbackDiagnostics
  website?: string
}

function browserName(userAgent: string): string {
  const matchers: Array<[RegExp, string]> = [
    [/Edg\/(\S+)/, "Edge"],
    [/OPR\/(\S+)/, "Opera"],
    [/Chrome\/(\S+)/, "Chrome"],
    [/Firefox\/(\S+)/, "Firefox"],
    [/Version\/(\S+).*Safari\//, "Safari"],
  ]
  for (const [pattern, name] of matchers) {
    const match = userAgent.match(pattern)
    if (match?.[1]) return `${name} ${match[1]}`
  }
  return "Unknown browser"
}

function operatingSystem(userAgent: string): string {
  if (/Windows NT 10/.test(userAgent)) return "Windows"
  if (/Android/.test(userAgent)) return "Android"
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS"
  if (/Mac OS X/.test(userAgent)) return "macOS"
  if (/Linux/.test(userAgent)) return "Linux"
  return "Unknown operating system"
}

function deviceClass(userAgent: string): string {
  if (/iPad|Tablet/.test(userAgent)) return "Tablet"
  if (/Android.*Mobile|iPhone|iPod/.test(userAgent)) return "Mobile"
  return "Desktop"
}

export function collectFeedbackPageContext(): FeedbackPageContext {
  return {
    title: document.title.slice(0, 200) || "Watch",
    url: window.location.href.slice(0, 2048),
    locale: (
      document.documentElement.lang ||
      navigator.language ||
      "unknown"
    ).slice(0, 64),
  }
}

export function collectFeedbackDiagnostics(): FeedbackDiagnostics {
  const userAgent = navigator.userAgent
  return {
    browser: browserName(userAgent),
    operatingSystem: operatingSystem(userAgent),
    device: deviceClass(userAgent),
    viewport: `${window.innerWidth} × ${window.innerHeight} @ ${window.devicePixelRatio || 1}x`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown",
    appVersion: process.env.NEXT_PUBLIC_DATADOG_VERSION || "Unknown",
  }
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function feedbackElementLabel(element: HTMLElement): string {
  const accessible =
    element.getAttribute("aria-label") ||
    element.getAttribute("alt") ||
    element.getAttribute("title")
  const text =
    accessible || compactText(element.innerText || element.textContent || "")
  return (text || element.tagName.toLowerCase()).slice(0, 160)
}

export function feedbackElementRole(element: HTMLElement): string {
  return (element.getAttribute("role") || element.tagName.toLowerCase()).slice(
    0,
    50,
  )
}

export function feedbackElementPath(element: HTMLElement): string {
  const segments: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== document.body && segments.length < 6) {
    const tag = current.tagName.toLowerCase()
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (sibling) => sibling.tagName === current?.tagName,
        )
      : []
    const index = Math.max(0, siblings.indexOf(current)) + 1
    segments.unshift(`${tag}:nth-of-type(${index})`)
    current = current.parentElement
  }
  return segments.join(" > ").slice(0, 500)
}

export function isFeedbackElementSelectable(element: HTMLElement): boolean {
  if (element.closest("[data-feedback-ignore]")) return false
  if (element.closest("input, textarea, select, option")) return false
  return element !== document.body && element !== document.documentElement
}

const SEMANTIC_FEEDBACK_TARGETS =
  "a, button, h1, h2, h3, h4, h5, h6, img, video, [role], p, li, section, article, nav, header, footer, main"

export function resolveFeedbackElementTarget(
  target: EventTarget | null,
): HTMLElement | null {
  const element =
    target instanceof HTMLElement
      ? target
      : target instanceof Element
        ? target.parentElement
        : null
  if (!element || !isFeedbackElementSelectable(element)) return null

  const semantic = element.closest<HTMLElement>(SEMANTIC_FEEDBACK_TARGETS)
  if (semantic && isFeedbackElementSelectable(semantic)) return semantic

  let current: HTMLElement | null = element
  while (current && isFeedbackElementSelectable(current)) {
    if (feedbackElementLabel(current) !== current.tagName.toLowerCase()) {
      return current
    }
    current = current.parentElement
  }
  return element
}
