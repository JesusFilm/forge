const FORBIDDEN_VALUE_PATTERNS: ReadonlyArray<{
  label: string
  pattern: RegExp
}> = [
  {
    label: "database connection string",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i,
  },
  { label: "credential-bearing URL", pattern: /:\/\/[^\s/:@]+:[^\s/@]+@/ },
  {
    label: "credential or token",
    pattern:
      /\b(?:bearer\s+[a-z0-9._~-]+|(?:api[_-]?key|password|passwd|secret|token|credential)\s*[:=]\s*\S+)/i,
  },
  {
    label: "JWT",
    pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/,
  },
  {
    label: "private filesystem path",
    pattern: /(?:\/(?:Users|home|var\/lib|private|tmp)\/|[A-Z]:\\Users\\)/i,
  },
  {
    label: "internal host",
    pattern:
      /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.(?:internal|local))(?::\d+)?\b/i,
  },
  {
    label: "executable markup",
    pattern: /<\/?(?:script|iframe|object|embed)\b/i,
  },
  {
    label: "bidirectional control",
    pattern: /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/,
  },
]

/** Fail closed before a value can enter a committed public dashboard artifact. */
export function assertPublicDashboardSafe(
  value: unknown,
  root = "dashboard",
  options: { allowDocument?: boolean } = {},
): void {
  const visit = (current: unknown, trail: string[]): void => {
    if (typeof current === "string") {
      if (!options.allowDocument && current.length > 5_000)
        throw new Error(`corpus-like text at ${trail.join(".")}`)
      for (const forbidden of FORBIDDEN_VALUE_PATTERNS)
        if (forbidden.pattern.test(current))
          throw new Error(`${forbidden.label} at ${trail.join(".")}`)
      return
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, [...trail, String(index)]))
      return
    }
    if (current !== null && typeof current === "object")
      for (const [key, entry] of Object.entries(current)) {
        visit(key, [...trail, "<key>"])
        visit(entry, [...trail, key])
      }
  }
  visit(value, [root])
}
