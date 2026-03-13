import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"

interface ProviderOptions {
  region?: string
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

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

export function init(
  providerOptions: ProviderOptions = {},
  settings: Settings = {},
) {
  const client = new SESv2Client({ region: providerOptions.region })

  return {
    async send(options: SendOptions) {
      const from = options.from ?? settings.defaultFrom
      const replyTo = options.replyTo ?? settings.defaultReplyTo

      await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: {
            ToAddresses: toArray(options.to),
            ...(options.cc && { CcAddresses: toArray(options.cc) }),
            ...(options.bcc && { BccAddresses: toArray(options.bcc) }),
          },
          Content: {
            Simple: {
              Subject: { Data: options.subject, Charset: "UTF-8" },
              Body: {
                ...(options.text && {
                  Text: { Data: options.text, Charset: "UTF-8" },
                }),
                ...(options.html && {
                  Html: { Data: options.html, Charset: "UTF-8" },
                }),
              },
            },
          },
          ...(replyTo && { ReplyToAddresses: [replyTo] }),
        }),
      )
    },
  }
}
