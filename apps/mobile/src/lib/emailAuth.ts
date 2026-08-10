/**
 * Native email/password decisions (F2). The sheet used to hand email off to
 * a browser, which contradicted the native-sheets Key Decision; these are the
 * pure parts of doing it in-app, so the screen stays a thin renderer (KTD11).
 *
 * Auth's own `/api/auth/login-method` is the duplicate-account guard the web
 * login page already uses: an email that belongs to a social account must be
 * sent to that provider's button rather than allowed to create a second
 * account. The check is advisory UX — the server enforces it regardless.
 */

/** Better Auth's default minimum; a shorter one is rejected server-side. */
export const MIN_PASSWORD_LENGTH = 8

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Deliberately permissive: this only decides whether to spend a round trip,
 * and over-strict client validation rejects real addresses. The server is
 * the authority.
 */
export function isPlausibleEmail(raw: string): boolean {
  const email = normalizeEmail(raw)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export type LoginMethod =
  | { kind: "password" }
  | { kind: "provider"; provider: string }

/**
 * Read auth's login-method response. Anything unrecognised falls back to
 * password: the worst case is the server rejecting the attempt, whereas
 * treating an unknown shape as "provider" would strand a legitimate
 * password user with no way in.
 */
export function classifyLoginMethod(payload: unknown): LoginMethod {
  if (typeof payload !== "object" || payload === null)
    return { kind: "password" }
  const { method, provider } = payload as {
    method?: unknown
    provider?: unknown
  }
  if (method === "provider" && typeof provider === "string" && provider) {
    return { kind: "provider", provider }
  }
  return { kind: "password" }
}

export const PROVIDER_LABELS: Record<string, string> = {
  apple: "Apple",
  facebook: "Facebook",
  google: "Google",
  okta: "Okta",
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

export type EmailAuthFailure =
  | "invalid-credentials"
  | "email-taken"
  | "weak-password"
  | "retryable"

/**
 * Classify a rejected email sign-in/sign-up. Typed code first; a narrow
 * message backstop covers responses that carry only text. Unknown failures
 * are retryable — telling someone their password is wrong when the server
 * was merely unreachable sends them to a reset they do not need.
 */
export function classifyEmailAuthFailure(error: {
  code?: string | null
  message?: string | null
}): EmailAuthFailure {
  const code = error.code?.toUpperCase() ?? ""
  if (code.includes("USER_ALREADY_EXISTS") || code.includes("EMAIL_ALREADY")) {
    return "email-taken"
  }
  if (code.includes("PASSWORD_TOO_SHORT") || code.includes("WEAK_PASSWORD")) {
    return "weak-password"
  }
  if (
    code.includes("INVALID_EMAIL_OR_PASSWORD") ||
    code.includes("INVALID_PASSWORD") ||
    code.includes("USER_NOT_FOUND")
  ) {
    return "invalid-credentials"
  }
  const message = error.message ?? ""
  if (/already (exists|registered)|taken/i.test(message)) return "email-taken"
  if (/password.*(short|weak|least)/i.test(message)) return "weak-password"
  if (/invalid (email|password|credentials)/i.test(message)) {
    return "invalid-credentials"
  }
  return "retryable"
}

export const EMAIL_FAILURE_MESSAGES: Record<EmailAuthFailure, string> = {
  "invalid-credentials": "That email and password don't match an account.",
  "email-taken": "An account already uses that email. Try signing in instead.",
  "weak-password": `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  retryable: "Something went wrong. Please try again.",
}

export type EmailFormMode = "sign-in" | "sign-up"

/** Whether the submit button should be live, so the screen holds no rule. */
export function canSubmitEmailForm(input: {
  mode: EmailFormMode
  email: string
  password: string
  busy: boolean
}): boolean {
  if (input.busy) return false
  if (!isPlausibleEmail(input.email)) return false
  // Sign-in accepts any non-empty password: an existing account may predate
  // the current minimum, and the server decides anyway.
  return input.mode === "sign-up"
    ? input.password.length >= MIN_PASSWORD_LENGTH
    : input.password.length > 0
}
