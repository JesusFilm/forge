import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete("strapi-jwt")
  cookieStore.delete("manager-user")
  return NextResponse.json({ success: true })
}
