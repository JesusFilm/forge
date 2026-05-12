import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"

import { env } from "@/config/env"

function getFirebaseAdminAuth() {
  if (
    !env.FIREBASE_PROJECT_ID ||
    !env.FIREBASE_CLIENT_EMAIL ||
    !env.FIREBASE_PRIVATE_KEY
  ) {
    return null
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      projectId: env.FIREBASE_PROJECT_ID,
    })
  }

  return getAuth()
}

export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<{ email: string; uid: string } | null> {
  const auth = getFirebaseAdminAuth()
  if (!auth) {
    return null
  }

  try {
    const decoded = await auth.verifyIdToken(idToken, true)
    if (!decoded.uid || !decoded.email || decoded.email_verified !== true) {
      return null
    }
    return { email: decoded.email, uid: decoded.uid }
  } catch {
    return null
  }
}
