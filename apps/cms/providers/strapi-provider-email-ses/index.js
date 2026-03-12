"use strict"

const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2")

module.exports = {
  init(providerOptions = {}, settings = {}) {
    const client = new SESv2Client({ region: providerOptions.region })

    return {
      async send(options) {
        const from = options.from || settings.defaultFrom
        const replyTo = options.replyTo || settings.defaultReplyTo
        const to = Array.isArray(options.to) ? options.to : [options.to]

        await client.send(
          new SendEmailCommand({
            FromEmailAddress: from,
            Destination: {
              ToAddresses: to,
              ...(options.cc && {
                CcAddresses: Array.isArray(options.cc)
                  ? options.cc
                  : [options.cc],
              }),
              ...(options.bcc && {
                BccAddresses: Array.isArray(options.bcc)
                  ? options.bcc
                  : [options.bcc],
              }),
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
  },
}
