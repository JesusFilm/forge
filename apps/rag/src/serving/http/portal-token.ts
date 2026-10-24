import { randomBytes } from "node:crypto"

export const randomToken = () => randomBytes(32).toString("base64url")
