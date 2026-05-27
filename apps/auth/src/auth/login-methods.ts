export const providerLabels = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
  okta: "Okta",
} as const

export type LoginProviderId = keyof typeof providerLabels
export type LoginMethodId = LoginProviderId | "email"

export function isLoginProviderId(value: string): value is LoginProviderId {
  return (
    value === "facebook" ||
    value === "google" ||
    value === "apple" ||
    value === "okta"
  )
}
