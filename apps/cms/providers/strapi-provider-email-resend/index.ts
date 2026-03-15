interface ProviderOptions {
  apiKey?: string
  baseUrl?: string
}

interface Settings {
  defaultFrom?: string
  defaultReplyTo?: string
}

interface SendOptions {
  from?: string
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  subject: string
  text?: string
  html?: string
}

function toArray(value?: string | string[]): string[] | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value : [value]
}

export function init(
  providerOptions: ProviderOptions = {},
  settings: Settings = {},
) {
  const apiKey = providerOptions.apiKey
  const baseUrl = providerOptions.baseUrl ?? "https://api.resend.com"

  return {
    async send(options: SendOptions) {
      const from = options.from ?? settings.defaultFrom
      const replyTo = options.replyTo ?? settings.defaultReplyTo

      if (!apiKey) throw new Error("Resend provider requires RESEND_API_KEY")
      if (!from) throw new Error("Resend provider requires a sender address")

      const response = await fetch(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: toArray(options.to) ?? [],
          cc: toArray(options.cc),
          bcc: toArray(options.bcc),
          reply_to: replyTo ? [replyTo] : undefined,
          subject: options.subject,
          text: options.text,
          html: options.html,
        }),
      })

      if (!response.ok) {
        const payload = await response.text()
        throw new Error(`Failed to send email via Resend: ${payload}`)
      }
    },
  }
}
