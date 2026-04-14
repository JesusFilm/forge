import { env } from "@/config/env"

export type FirebaseSignInResult = {
  email: string
  idToken: string
  localId: string
  refreshToken: string
}

type FirebaseSignInResponse = FirebaseSignInResult & {
  registered: boolean
}

export async function signInWithFirebasePassword(
  email: string,
  password: string,
): Promise<FirebaseSignInResult | null> {
  if (!env.FIREBASE_WEB_API_KEY) {
    return null
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
      signal: AbortSignal.timeout(5000),
    },
  ).catch(() => null)

  if (!response?.ok) {
    return null
  }

  const data = (await response.json()) as FirebaseSignInResponse
  if (!data.idToken || !data.localId || !data.email || !data.refreshToken) {
    return null
  }

  return {
    email: data.email,
    idToken: data.idToken,
    localId: data.localId,
    refreshToken: data.refreshToken,
  }
}
