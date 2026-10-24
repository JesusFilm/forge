import "server-only"

import { GoogleAuth } from "google-auth-library"

export async function appendBetaRequest(email: string): Promise<void> {
  const spreadsheet = process.env.BETA_REQUESTS_SPREADSHEET_ID
  const credentials =
    process.env.BETA_REQUESTS_GOOGLE_SERVICE_ACCOUNT_JSON ??
    process.env.FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON
  if (!spreadsheet || !credentials) throw new Error("signup_not_configured")
  const auth = new GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  const client = await auth.getClient()
  await client.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet)}/values/${encodeURIComponent("Sheet1!A:D")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    method: "POST",
    data: {
      values: [[new Date().toISOString(), email, "Android TV", "Pending"]],
    },
    timeout: 10000,
    retry: false,
  })
}
