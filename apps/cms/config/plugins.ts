import path from "node:path"
import type { Core } from "@strapi/strapi"

const config = ({
  env,
}: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const useS3 = Boolean(env("RAILWAY_S3_BUCKET"))
  const accessKeyId = env("RAILWAY_S3_ACCESS_KEY_ID")
  const secretAccessKey = env("RAILWAY_S3_SECRET_ACCESS_KEY")
  const useExplicitCredentials = Boolean(accessKeyId && secretAccessKey)
  const emailFrom = env("EMAIL_DEFAULT_FROM")
  const useResend = Boolean(emailFrom && env("RESEND_API_KEY"))
  return {
    upload: {
      config: useS3
        ? {
            provider: "aws-s3",
            providerOptions: {
              s3Options: {
                ...(useExplicitCredentials && {
                  credentials: { accessKeyId, secretAccessKey },
                }),
                endpoint: env("RAILWAY_S3_ENDPOINT"),
                forcePathStyle: env.bool("RAILWAY_S3_FORCE_PATH_STYLE", true),
                region: env("RAILWAY_S3_REGION", "auto"),
                params: {
                  signedUrlExpires: Number(
                    env("RAILWAY_S3_SIGNED_URL_EXPIRES", "900"),
                  ),
                  Bucket: env("RAILWAY_S3_BUCKET"),
                },
              },
            },
            actionOptions: { upload: {}, uploadStream: {}, delete: {} },
          }
        : {},
    },
    "users-permissions": {
      config: {
        jwtSecret: env("JWT_SECRET"),
      },
    },
    graphql: {
      config: {
        endpoint: "/graphql",
        shadowCRUD: true,
        // graphql-depth-limit@1.1.0 crashes on fragment spreads within
        // dynamic-zone unions (reads .kind on undefined nodes). Set high
        // to avoid the crash path in the library's recursive traversal.
        depthLimit: 100,
        landingPage: env("NODE_ENV") !== "production",
        generateArtifacts: true,
        artifacts: {
          schema: path.join(process.cwd(), "schema.graphql"),
        },
      },
    },
    i18n: { enabled: true },
    ...(useResend && {
      email: {
        config: {
          provider: path.join(
            process.cwd(),
            "providers/strapi-provider-email-resend/dist/index.js",
          ),
          providerOptions: {
            apiKey: env("RESEND_API_KEY"),
            ...(env("RESEND_API_BASE_URL") && {
              baseUrl: env("RESEND_API_BASE_URL"),
            }),
          },
          settings: {
            defaultFrom: emailFrom,
            defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO", emailFrom),
          },
        },
      },
    }),
  }
}

export default config
