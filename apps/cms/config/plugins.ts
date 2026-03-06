import path from "node:path"
import type { Core } from "@strapi/strapi"

const config = ({
  env,
}: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const useS3 = Boolean(env("AWS_BUCKET"))
  const accessKeyId = env("AWS_ACCESS_KEY_ID")
  const secretAccessKey = env("AWS_ACCESS_SECRET")
  const useExplicitCredentials = Boolean(accessKeyId && secretAccessKey)
  return {
    upload: {
      config: useS3
        ? {
            provider: "aws-s3",
            providerOptions: {
              baseUrl: env("CDN_URL"),
              rootPath: env("CDN_ROOT_PATH"),
              s3Options: {
                ...(useExplicitCredentials && {
                  credentials: { accessKeyId, secretAccessKey },
                }),
                region: env("AWS_REGION"),
                params: {
                  ACL: env("AWS_ACL", "private"),
                  signedUrlExpires: Number(
                    env("AWS_SIGNED_URL_EXPIRES", "900"),
                  ),
                  Bucket: env("AWS_BUCKET"),
                },
              },
              providerConfig: {
                checksumAlgorithm: "CRC64NVME",
                preventOverwrite: true,
                storageClass: "INTELLIGENT_TIERING",
                encryption: env("AWS_KMS_KEY_ID")
                  ? { type: "aws:kms", kmsKeyId: env("AWS_KMS_KEY_ID") }
                  : { type: "AES256" },
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
        landingPage: env("NODE_ENV") !== "production",
        generateArtifacts: true,
        artifacts: {
          schema: path.join(process.cwd(), "schema.graphql"),
        },
      },
    },
    i18n: { enabled: true },
  }
}

export default config
